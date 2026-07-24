import { parseSseFrames } from "../event-stream";
// @ts-expect-error Canonical console card transport remains JavaScript.
import { applyStreamingDiffCardMessage } from "../../../dashboard/src/hooks/streaming-diff-transport.mjs";

type Selection = Readonly<{ repoKey: string; worktreeKey: string; session: string }>;
type Options = Readonly<{ base: string; selection: Selection; cards: unknown[]; onCards(cards: unknown[]): void; onError(message: string): void; fetchImpl?: typeof fetch; retryMs?: number }>;

/** Mirrors useStreamingDiffCards: exact scoped SSE, canonical reset/card parsing, abortable reconnect. */
export function observeStreamingDiffCards(options: Options): () => void {
  const fetchImpl = options.fetchImpl ?? fetch, retryMs = options.retryMs ?? 1_000;
  let stopped = false, controller: AbortController | null = null, retry: ReturnType<typeof setTimeout> | null = null, cursor = "", cards = [...options.cards];
  const connect = async () => {
    if (stopped) return;
    controller = new AbortController();
    try {
      const query = new URLSearchParams(options.selection);
      const response = await fetchImpl(`${options.base}/api/oven-data/streaming-diff?${query}`, { headers: { accept: "text/event-stream", ...(cursor ? { "last-event-id": cursor } : {}) }, cache: "no-store", signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Streaming Diff stream returned ${response.status}`);
      const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "";
      while (!stopped) {
        const { done, value } = await reader.read(); if (stopped || controller.signal.aborted) break; if (done) break;
        pending += decoder.decode(value, { stream: true }); const parsed = parseSseFrames(pending); pending = parsed.remainder;
        for (const frame of parsed.frames) {
          if (stopped || controller.signal.aborted) break;
          if (frame.event === "reset") { cards = []; options.onCards(cards); continue; }
          try { cards = applyStreamingDiffCardMessage(cards, frame.data); if (frame.id) cursor = frame.id; options.onCards(cards); } catch { options.onError("Received an invalid Streaming Diff card."); }
        }
        const last = response.headers.get("last-event-id"); if (last) cursor = last;
      }
      if (!stopped) throw new Error("The stream disconnected; reconnecting.");
    } catch (cause) {
      if (stopped || (cause instanceof DOMException && cause.name === "AbortError")) return;
      options.onError(cause instanceof Error ? cause.message : "The stream disconnected; reconnecting.");
      retry = setTimeout(() => void connect(), retryMs); retry.unref?.();
    }
  };
  void connect();
  return () => { stopped = true; controller?.abort(); if (retry) clearTimeout(retry); };
}
