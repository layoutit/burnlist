import { describe, expect, test } from "bun:test";
import { isDashboardInvalidation, observeDashboardEvents, parseSseFrames } from "./event-stream";

describe("dashboard event stream", () => {
  test("parses fragmented CRLF frames and preserves a remainder", () => {
    const parsed = parseSseFrames("event: oven-event\r\ndata: {\"kind\":\"data-published\",\r\ndata: \"phase\":\"complete\"}\r\n\r\nevent: oven");
    expect(parsed.frames).toEqual([{ event: "oven-event", data: "{\"kind\":\"data-published\",\n\"phase\":\"complete\"}" }]);
    expect(parsed.remainder).toBe("event: oven");
  });

  test("matches the web dashboard invalidation selectors", () => {
    expect(isDashboardInvalidation({ ovenId: "visual-parity", kind: "data-published", phase: "complete" })).toBe(true);
    expect(isDashboardInvalidation({ ovenId: "checklist", kind: "item-burned", phase: "completed" })).toBe(true);
    expect(isDashboardInvalidation({ ovenId: "visual-parity", kind: "item-burned", phase: "completed" })).toBe(false);
    expect(isDashboardInvalidation({ ovenId: "checklist", kind: "data-published", phase: "started" })).toBe(false);
  });

  test("coalesces matching events into one canonical refresh", async () => {
    const payload = [
      "event: oven-event\ndata: {\"ovenId\":\"checklist\",\"kind\":\"item-burned\",\"phase\":\"completed\"}\n\n",
      "event: oven-reset\ndata: {}\n\n",
    ].join("");
    let invalidations = 0;
    const stop = observeDashboardEvents("http://example.test", {
      fetchImpl: (async () => new Response(payload, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch,
      onInvalidate: () => { invalidations += 1; },
      retryMs: 10_000,
      coalesceMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    expect(invalidations).toBe(1);
  });

  test("a reset dominates later scoped events in the same coalesce window", async () => {
    const payload = [
      "event: oven-reset\ndata: {}\n\n",
      "event: oven-event\ndata: {\"ovenId\":\"checklist\",\"kind\":\"data-published\",\"phase\":\"complete\"}\n\n",
    ].join("");
    const invalidations: Array<unknown> = [];
    const stop = observeDashboardEvents("http://example.test", {
      fetchImpl: (async () => new Response(payload, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch,
      onInvalidate: (event) => invalidations.push(event), retryMs: 10_000, coalesceMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    expect(invalidations).toEqual([undefined]);
  });

  test("keeps scoped resets scoped and ignores malformed resets", async () => {
    const payload = ["event: oven-reset\ndata: {\"ovenId\":\"shared\",\"repoKey\":\"repo-a\"}\n\n", "event: oven-event\ndata: {\"ovenId\":\"other\",\"repoKey\":\"repo-b\",\"kind\":\"data-published\",\"phase\":\"complete\"}\n\n", "event: oven-reset\ndata: nope\n\n"].join("");
    const invalidations: Array<unknown> = [];
    const stop = observeDashboardEvents("http://example.test", { fetchImpl: (async () => new Response(payload)) as unknown as typeof fetch, onInvalidate: (event) => invalidations.push(event), retryMs: 10_000, coalesceMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30)); stop();
    expect(invalidations).toEqual([{ ovenId: "shared", repoKey: "repo-a" }, { ovenId: "other", repoKey: "repo-b", kind: "data-published", phase: "complete" }]);
  });

  test("a later scoped reset replaces its matching earlier event", async () => {
    const payload = ["event: oven-event\ndata: {\"ovenId\":\"shared\",\"repoKey\":\"repo-a\",\"kind\":\"data-published\",\"phase\":\"complete\"}\n\n", "event: oven-reset\ndata: {\"ovenId\":\"shared\",\"repoKey\":\"repo-a\"}\n\n"].join("");
    const got: unknown[] = [], stop = observeDashboardEvents("http://example.test", { fetchImpl: (async () => new Response(payload)) as unknown as typeof fetch, onInvalidate: (event) => got.push(event), retryMs: 10_000, coalesceMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30)); stop();
    expect(got).toEqual([{ ovenId: "shared", repoKey: "repo-a" }]);
  });

  test("delivers every scoped definition change in a coalesced burst", async () => {
    const payload = [
      "event: oven-event\ndata: {\"ovenId\":\"shared\",\"repoKey\":\"repo-a\",\"kind\":\"definition-changed\",\"phase\":\"complete\"}\n\n",
      "event: oven-event\ndata: {\"ovenId\":\"shared\",\"repoKey\":\"repo-b\",\"kind\":\"definition-changed\",\"phase\":\"complete\"}\n\n",
    ].join("");
    const delivered: Array<{ repoKey?: string | null }> = [];
    const stop = observeDashboardEvents("http://example.test", {
      fetchImpl: (async () => new Response(payload, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch,
      onInvalidate: (event) => { if (event) delivered.push(event); }, retryMs: 10_000, coalesceMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    stop();
    expect(delivered.map((event) => event.repoKey)).toEqual(["repo-a", "repo-b"]);
  });

  test("falls back after a disconnect and reconnects without emitting a false invalidation", async () => {
    let calls = 0;
    const statuses: string[] = [];
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const stop = observeDashboardEvents("http://example.test", {
      fetchImpl: (async () => {
        calls += 1;
        return calls === 1 ? new Response("") : new Response(stream);
      }) as unknown as typeof fetch,
      onInvalidate: () => { throw new Error("disconnect must not invalidate canonical data"); },
      onStatus: (status) => statuses.push(status), retryMs: 1, coalesceMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    stop();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(statuses).toEqual(["connecting", "live", "fallback", "connecting", "live"]);
  });
});
