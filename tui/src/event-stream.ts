import { TERMINAL_RESOURCE_LIMITS } from "./oven-runtime/resource-limits";

export type StreamStatus = "connecting" | "live" | "fallback";

export interface OvenEvent {
  ovenId?: string;
  repoKey?: string | null;
  subjectId?: string | null;
  kind?: string;
  phase?: string;
}

/** A scoped event can refresh only the matching rendered Oven; unscoped events reconcile all views. */
export function eventInvalidatesScope(event: OvenEvent | undefined, scope: { ovenId: string; repoKey: string | null; subjectId?: string | null } | null): boolean {
  if (event === undefined || scope === null) return true;
  if (event.ovenId !== undefined && event.ovenId !== scope.ovenId) return false;
  // Match dashboard/src/lib/oven-snapshot-contract.mjs: official (null) scopes
  // observe all repositories, while scoped Ovens only observe their own events.
  if (scope.repoKey !== null && event.repoKey !== undefined && (event.repoKey ?? null) !== scope.repoKey) return false;
  const ovenWide = event.kind === "data-published" || event.kind === "binding-changed" || event.kind === "definition-changed";
  return ovenWide || scope.subjectId === undefined || scope.subjectId === null
    || event.subjectId === undefined || (event.subjectId ?? null) === scope.subjectId;
}

interface ObserverOptions {
  onInvalidate(event?: OvenEvent): void;
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

/**
 * Splits complete SSE records without handing an over-limit record to a JSON
 * parser.  Callers still bound the incomplete remainder: a peer can otherwise
 * omit the terminating blank line forever.
 */
export function parseSseFrames(buffer: string, maxFrameBytes = TERMINAL_RESOURCE_LIMITS.sseFrameBytes): {
  frames: Array<{ event: string; data: string; id?: string }>;
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/gu, "\n");
  const chunks = normalized.split("\n\n");
  const remainder = chunks.pop() ?? "";
  const frames = chunks.flatMap((chunk) => {
    if (new TextEncoder().encode(chunk).byteLength > maxFrameBytes) return [];
    let event = "message", id: string | undefined;
    const data: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trimStart();
      if (line.startsWith("id:")) id = line.slice(3).trimStart();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return data.length ? [{ event, data: data.join("\n"), ...(id ? { id } : {}) }] : [];
  });
  return { frames, remainder };
}

export function observeDashboardEvents(base: string, options: ObserverOptions): () => void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryMs = options.retryMs ?? 1_000;
  const coalesceMs = options.coalesceMs ?? 25;
  let stopped = false;
  let controller: AbortController | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let coalesce: ReturnType<typeof setTimeout> | null = null;
  let connecting = false;
  let pendingInvalidations: Array<OvenEvent | undefined> = [];
  const resetCovers = (reset: OvenEvent, event: OvenEvent) => (reset.ovenId === undefined || reset.ovenId === event.ovenId) && (reset.repoKey === undefined || (reset.repoKey ?? null) === (event.repoKey ?? null));

  const invalidate = (event?: OvenEvent) => {
    if (stopped) return;
    if (event === undefined) pendingInvalidations = [undefined];
    else if (event.kind === "__reset") {
      if (!pendingInvalidations.some((entry) => entry === undefined || entry?.kind === "__reset" && resetCovers(entry, event))) pendingInvalidations = [...pendingInvalidations.filter((entry) => !entry || entry.kind === "__reset" || !resetCovers(event, entry)), event];
    } else if (pendingInvalidations.some((entry) => entry === undefined || entry?.kind === "__reset" && resetCovers(entry, event))) {
      // A reset is a global reconciliation barrier for this complete burst.
    }
    else if (!pendingInvalidations.some((entry) => entry && entry.ovenId === event.ovenId && (entry.repoKey ?? null) === (event.repoKey ?? null) && entry.kind === event.kind && entry.phase === event.phase)) {
      // Losing event granularity is safe only when it becomes a complete
      // reconciliation. Never retain an attacker-controlled event backlog.
      pendingInvalidations = pendingInvalidations.length >= TERMINAL_RESOURCE_LIMITS.pendingInvalidations
        ? [undefined]
        : [...pendingInvalidations, event];
    }
    if (coalesce) return;
    coalesce = setTimeout(() => {
      coalesce = null;
      const events = pendingInvalidations;
      pendingInvalidations = [];
      if (!stopped) events.forEach((pending) => options.onInvalidate(pending?.kind === "__reset" ? { ovenId: pending.ovenId, repoKey: pending.repoKey } : pending));
    }, coalesceMs);
    coalesce.unref?.();
  };

  const connect = async () => {
    if (stopped || connecting) return;
    connecting = true;
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
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        if (new TextEncoder().encode(pending).byteLength > TERMINAL_RESOURCE_LIMITS.sseRemainderBytes) {
          // A malformed/infinite record cannot safely be completed. Reconcile
          // all views and discard it rather than retaining arbitrary text.
          pending = "";
          invalidate();
          continue;
        }
        const parsed = parseSseFrames(pending);
        pending = parsed.remainder;
        for (const frame of parsed.frames) {
          if (frame.event === "oven-reset") {
            try {
              const reset = JSON.parse(frame.data) as Record<string, unknown>;
              if (!reset || typeof reset !== "object" || Array.isArray(reset)
                || (reset.repoKey !== undefined && reset.repoKey !== null && typeof reset.repoKey !== "string")
                || (reset.ovenId !== undefined && reset.ovenId !== null && typeof reset.ovenId !== "string")) continue;
              const scoped = typeof reset.ovenId === "string" || typeof reset.repoKey === "string";
              invalidate(scoped ? { ...(typeof reset.ovenId === "string" ? { ovenId: reset.ovenId } : {}), ...(typeof reset.repoKey === "string" ? { repoKey: reset.repoKey } : {}), kind: "__reset" } : undefined);
            } catch { /* Malformed reset is observational noise; reconnect reconciliation recovers. */ }
          }
          if (frame.event === "oven-event") {
            try {
              const event = JSON.parse(frame.data) as OvenEvent;
              if (isDashboardInvalidation(event)) invalidate(event);
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
      if (!retry) retry = setTimeout(() => { retry = null; void connect(); }, retryMs);
      retry.unref?.();
    } finally {
      connecting = false;
      reader = null;
    }
  };

  void connect();
  return () => {
    stopped = true;
    controller?.abort();
    void reader?.cancel().catch(() => {});
    if (retry) clearTimeout(retry);
    if (coalesce) clearTimeout(coalesce);
    pendingInvalidations = [];
  };
}
