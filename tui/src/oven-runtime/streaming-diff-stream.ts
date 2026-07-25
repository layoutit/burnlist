import { parseSseFrames } from "../event-stream";
import { TERMINAL_RESOURCE_LIMITS } from "./resource-limits";
// @ts-expect-error Canonical console card transport remains JavaScript.
import { applyStreamingDiffCardMessage } from "../../../dashboard/src/hooks/streaming-diff-transport.mjs";

type Selection = Readonly<{ repoKey: string; worktreeKey: string; session: string }>;
type Options = Readonly<{ base: string; selection: Selection; cards: unknown[]; onCards(cards: unknown[]): void; onError(message: string): void; fetchImpl?: typeof fetch; retryMs?: number; coalesceMs?: number }>;

function utf8Bytes(value: string) { return new TextEncoder().encode(value).byteLength; }

/** Keep the terminal's retained card transport bounded even after canonical parsing. */
export function boundStreamingDiffCards(cards: unknown[]): unknown[] {
  return cards.slice(-TERMINAL_RESOURCE_LIMITS.streamingCards).map((card) => {
    if (!card || typeof card !== "object" || Array.isArray(card)) return card;
    const record = card as Record<string, unknown>;
    const files = Array.isArray(record.files) ? record.files.map((file) => {
      if (!file || typeof file !== "object" || Array.isArray(file)) return file;
      const entry = file as Record<string, unknown>;
      if (typeof entry.diff !== "string" || utf8Bytes(entry.diff) <= TERMINAL_RESOURCE_LIMITS.streamingCardTextBytes) return entry;
      // Do not truncate a diff and imply that it is complete. It becomes a
      // canonical withheld file, matching the console's safe display mode.
      const { diff: _diff, ...rest } = entry;
      return { ...rest, kind: "truncated", meta: { ...(entry.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta) ? entry.meta : {}), bytes: utf8Bytes(entry.diff), reason: "Terminal card text limit exceeded." } };
    }) : record.files;
    return { ...record, ...(files ? { files } : {}) };
  });
}

/** Mirrors useStreamingDiffCards: exact scoped SSE, canonical reset/card parsing, abortable reconnect. */
export function observeStreamingDiffCards(options: Options): () => void {
  const fetchImpl = options.fetchImpl ?? fetch, retryMs = options.retryMs ?? 1_000, coalesceMs = options.coalesceMs ?? 0;
  let stopped = false, connecting = false, controller: AbortController | null = null, reader: ReadableStreamDefaultReader<Uint8Array> | null = null, retry: ReturnType<typeof setTimeout> | null = null, coalesce: ReturnType<typeof setTimeout> | null = null, cardsDirty = false, cursor = "", cards = boundStreamingDiffCards(options.cards);
  const flushCards = () => {
    if (coalesce) clearTimeout(coalesce);
    coalesce = null;
    if (!stopped && cardsDirty) { cardsDirty = false; options.onCards(cards); }
  };
  const publish = () => {
    cardsDirty = true;
    if (coalesce || stopped) return;
    coalesce = setTimeout(flushCards, coalesceMs);
    coalesce.unref?.();
  };
  const connect = async () => {
    if (stopped || connecting) return;
    connecting = true;
    controller = new AbortController();
    try {
      const query = new URLSearchParams(options.selection);
      const response = await fetchImpl(`${options.base}/api/oven-data/streaming-diff?${query}`, { headers: { accept: "text/event-stream", ...(cursor ? { "last-event-id": cursor } : {}) }, cache: "no-store", signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Streaming Diff stream returned ${response.status}`);
      reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = "";
      while (!stopped) {
        const { done, value } = await reader.read(); if (stopped || controller.signal.aborted) break; if (done) break;
        pending += decoder.decode(value, { stream: true });
        if (utf8Bytes(pending) > TERMINAL_RESOURCE_LIMITS.sseRemainderBytes) {
          // A partial record over the ceiling is untrustworthy; fail closed to
          // a reset rather than retain it or parse a partial card.
          pending = ""; cards = []; publish(); options.onError("Streaming Diff frame exceeded the terminal limit; reconciling."); continue;
        }
        const parsed = parseSseFrames(pending); pending = parsed.remainder;
        for (const frame of parsed.frames) {
          if (stopped || controller.signal.aborted) break;
          if (frame.event === "reset") { cards = []; publish(); continue; }
          if (utf8Bytes(frame.data) > TERMINAL_RESOURCE_LIMITS.streamingCardTextBytes) { cards = []; publish(); options.onError("Streaming Diff card exceeded the terminal limit; reconciling."); continue; }
          try { cards = boundStreamingDiffCards(applyStreamingDiffCardMessage(cards, frame.data)); if (frame.id) cursor = frame.id; publish(); } catch { options.onError("Received an invalid Streaming Diff card."); }
        }
        const last = response.headers.get("last-event-id"); if (last) cursor = last;
      }
      // The reader may have closed before the coalesce turn. Preserve the
      // latest canonical state before the reconnect is scheduled.
      flushCards();
      if (!stopped) throw new Error("The stream disconnected; reconnecting.");
    } catch (cause) {
      if (stopped || (cause instanceof DOMException && cause.name === "AbortError")) return;
      options.onError(cause instanceof Error ? cause.message : "The stream disconnected; reconnecting.");
      if (!retry) retry = setTimeout(() => { retry = null; void connect(); }, retryMs); retry.unref?.();
    } finally {
      connecting = false;
      reader = null;
    }
  };
  void connect();
  return () => { stopped = true; controller?.abort(); void reader?.cancel().catch(() => {}); if (retry) clearTimeout(retry); if (coalesce) clearTimeout(coalesce); retry = null; coalesce = null; cardsDirty = false; };
}
