import { expect, test } from "bun:test";
import { observeStreamingDiffCards } from "./streaming-diff-stream";

const card = (id: string, path = "a.ts", kind = "modified") => ({ toolUseId: `tool-${id}`, revId: id, ts: "2026-07-24", status: "captured", files: [{ path, kind, ...(kind === "modified" ? { diff: `+${id}` } : { meta: { redacted: true } }) }] });
function stream(parts: string[]) { const encoder = new TextEncoder(); return new ReadableStream<Uint8Array>({ start(controller) { parts.forEach((part) => controller.enqueue(encoder.encode(part))); controller.close(); } }); }

test("selected-session stream consumes fragmented canonical frames, reset, replacement, cursor, and abort", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [], seen: unknown[][] = [];
  let calls = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    requests.push({ url, headers: new Headers(init?.headers) }); calls += 1;
    return new Response(stream(calls === 1 ? [`id: cursor-1\nda`, `ta: ${JSON.stringify(card("r1"))}\n\n`, `event: reset\ndata: {"type":"reset"}\n\n`, `id: cursor-2\ndata: ${JSON.stringify(card("r2", "secret", "redacted"))}\n\n`] : []), { headers: { "content-type": "text/event-stream" } });
  };
  const stop = observeStreamingDiffCards({ base: "http://t", selection: { repoKey: "repo", worktreeKey: "work", session: "one" }, cards: [], fetchImpl: fetchImpl as typeof fetch, retryMs: 1, onCards: (cards) => seen.push(cards), onError: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 20)); const beforeStop = requests.length; stop();
  expect(requests[0]?.url).toContain("repoKey=repo"); expect(requests[0]?.url).toContain("worktreeKey=work"); expect(requests[0]?.headers.get("accept")).toBe("text/event-stream");
  expect(seen.at(-1)?.[0]).toMatchObject({ revId: "r2", files: [{ kind: "redacted" }] });
  expect(requests[1]?.headers.get("last-event-id")).toBe("cursor-2");
  await new Promise((resolve) => setTimeout(resolve, 8)); expect(requests.length).toBe(beforeStop);
});

test("stopping during a pending read ignores late reset/card bytes", async () => {
  let writer!: ReadableStreamDefaultController<Uint8Array>, cards = 0, errors = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  const stop = observeStreamingDiffCards({ base: "http://t", selection: { repoKey: "repo", worktreeKey: "work", session: "late" }, cards: [], fetchImpl: (async () => new Response(body)) as unknown as typeof fetch, onCards: () => { cards += 1; }, onError: () => { errors += 1; }, retryMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0)); stop();
  // stop cancels the reader, so a late producer cannot retain or deliver bytes.
  expect(() => writer.enqueue(new TextEncoder().encode(`event: reset\ndata: {"type":"reset"}\n\nid: x\ndata: ${JSON.stringify(card("late"))}\n\n`))).toThrow();
  await new Promise((resolve) => setTimeout(resolve, 5)); expect([cards, errors]).toEqual([0, 0]);
});
