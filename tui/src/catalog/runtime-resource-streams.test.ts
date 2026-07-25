import { expect, test } from "bun:test";
import { observeDashboardEvents, parseSseFrames } from "../event-stream";
import { TERMINAL_RESOURCE_LIMITS } from "../oven-runtime/resource-limits";
import { boundStreamingDiffCards, observeStreamingDiffCards } from "../oven-runtime/streaming-diff-stream";

const wait = (ms = 12) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (value: string) => new TextEncoder().encode(value);

test("stream parsers reject oversized complete frames before a JSON parse", () => {
  const oversized = `event: oven-event\ndata: ${"x".repeat(TERMINAL_RESOURCE_LIMITS.sseFrameBytes)}\n\n`;
  expect(parseSseFrames(oversized).frames).toEqual([]);
});

test("dashboard event bursts collapse bounded pending invalidations to global reconciliation", async () => {
  const events = Array.from({ length: TERMINAL_RESOURCE_LIMITS.pendingInvalidations + 4 }, (_, index) => `event: oven-event\ndata: {"ovenId":"oven-${index}","repoKey":"repo-${index}","kind":"data-published","phase":"complete"}\n\n`).join("");
  const calls: unknown[] = [];
  const stop = observeDashboardEvents("http://test", { fetchImpl: (async () => new Response(events)) as unknown as typeof fetch, coalesceMs: 1, retryMs: 10_000, onInvalidate: (event) => calls.push(event) });
  await wait(); stop();
  expect(calls).toEqual([undefined]);
});

test("Streaming Diff bounds retained cards and converts oversized rendered diffs to withheld metadata", () => {
  const cards = Array.from({ length: TERMINAL_RESOURCE_LIMITS.streamingCards + 2 }, (_, index) => ({ revId: String(index), files: [{ path: "huge.ts", kind: "modified", diff: "x".repeat(TERMINAL_RESOURCE_LIMITS.streamingCardTextBytes + 1) }] }));
  const bounded = boundStreamingDiffCards(cards) as Array<{ revId: string; files: Array<{ kind: string; diff?: string; meta?: { bytes?: number } }> }>;
  expect(bounded).toHaveLength(TERMINAL_RESOURCE_LIMITS.streamingCards);
  expect(bounded[0]?.revId).toBe("2");
  expect(bounded[0]?.files[0]).toMatchObject({ kind: "truncated", meta: { bytes: TERMINAL_RESOURCE_LIMITS.streamingCardTextBytes + 1 } });
  expect(bounded[0]?.files[0]?.diff).toBeUndefined();
});

test("Streaming Diff clears an unterminated over-limit remainder rather than retaining it", async () => {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  const cards: unknown[][] = [], errors: string[] = [];
  const stop = observeStreamingDiffCards({ base: "http://test", selection: { repoKey: "r", worktreeKey: "w", session: "s" }, cards: [{ retained: true }], fetchImpl: (async () => new Response(body)) as unknown as typeof fetch, retryMs: 10_000, onCards: (next) => cards.push(next), onError: (message) => errors.push(message) });
  await wait(0);
  writer.enqueue(bytes(`data: ${"x".repeat(TERMINAL_RESOURCE_LIMITS.sseRemainderBytes + 1)}`));
  await wait(); stop();
  expect(cards).toContainEqual([]);
  expect(errors.at(-1)).toContain("exceeded");
});

test("Streaming Diff coalesces a hostile reset burst to its latest state and cancels delivery on stop", async () => {
  const card = JSON.stringify({ toolUseId: "tool-last", revId: "last", ts: "2026-07-24", status: "captured", files: [] });
  const payload = `${"event: reset\ndata: {}\n\n".repeat(999)}id: last\ndata: ${card}\n\n`;
  const seen: unknown[][] = [];
  const stop = observeStreamingDiffCards({ base: "http://test", selection: { repoKey: "r", worktreeKey: "w", session: "s" }, cards: [], fetchImpl: (async () => new Response(payload)) as unknown as typeof fetch, retryMs: 10_000, onCards: (next) => seen.push(next), onError: () => {} });
  await wait();
  expect(seen).toHaveLength(1);
  expect(seen[0]).toHaveLength(1);
  expect(seen[0]?.[0]).toMatchObject({ revId: "last" });
  expect(seen[0]?.length).toBeLessThanOrEqual(TERMINAL_RESOURCE_LIMITS.streamingCards);
  stop();
  const delivered = seen.length;
  await wait();
  expect(seen).toHaveLength(delivered);
});
