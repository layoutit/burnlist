export type StreamStatus = "connecting" | "live" | "fallback";

interface OvenEvent {
  ovenId?: string;
  kind?: string;
  phase?: string;
}

interface ObserverOptions {
  onInvalidate(): void;
  onStatus?(status: StreamStatus): void;
  fetchImpl?: typeof fetch;
  retryMs?: number;
  coalesceMs?: number;
}

export function isDashboardInvalidation(event: OvenEvent): boolean {
  if (event.kind === "data-published" && event.phase === "complete") return true;
  if (event.kind === "binding-changed" && event.phase === "complete") return true;
  if (event.kind === "definition-changed" && event.phase === "complete") return true;
  return event.ovenId === "checklist"
    && ((event.kind === "item-burned" && event.phase === "completed")
      || (event.kind === "lifecycle-changed" && event.phase === "complete"));
}

export function parseSseFrames(buffer: string): {
  frames: Array<{ event: string; data: string }>;
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/gu, "\n");
  const chunks = normalized.split("\n\n");
  const remainder = chunks.pop() ?? "";
  const frames = chunks.flatMap((chunk) => {
    let event = "message";
    const data: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trimStart();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return data.length ? [{ event, data: data.join("\n") }] : [];
  });
  return { frames, remainder };
}

export function observeDashboardEvents(base: string, options: ObserverOptions): () => void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryMs = options.retryMs ?? 1_000;
  const coalesceMs = options.coalesceMs ?? 25;
  let stopped = false;
  let controller: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let coalesce: ReturnType<typeof setTimeout> | null = null;

  const invalidate = () => {
    if (coalesce || stopped) return;
    coalesce = setTimeout(() => {
      coalesce = null;
      if (!stopped) options.onInvalidate();
    }, coalesceMs);
    coalesce.unref?.();
  };

  const connect = async () => {
    if (stopped) return;
    options.onStatus?.("connecting");
    controller = new AbortController();
    try {
      const response = await fetchImpl(`${base}/api/events?stream=1&tail=1`, {
        headers: { accept: "text/event-stream" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Event stream returned ${response.status}`);
      options.onStatus?.("live");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const parsed = parseSseFrames(pending);
        pending = parsed.remainder;
        for (const frame of parsed.frames) {
          if (frame.event === "oven-reset") invalidate();
          if (frame.event === "oven-event") {
            try {
              if (isDashboardInvalidation(JSON.parse(frame.data))) invalidate();
            } catch {
              // A malformed event is not canonical state; the next valid event or
              // reconciliation refresh will recover the snapshot.
            }
          }
        }
      }
      if (!stopped) throw new Error("Event stream closed");
    } catch {
      if (stopped) return;
      options.onStatus?.("fallback");
      retry = setTimeout(() => void connect(), retryMs);
      retry.unref?.();
    }
  };

  void connect();
  return () => {
    stopped = true;
    controller?.abort();
    if (retry) clearTimeout(retry);
    if (coalesce) clearTimeout(coalesce);
  };
}
