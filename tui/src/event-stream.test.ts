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
    await new Promise((resolve) => setTimeout(resolve, 10));
    stop();
    expect(invalidations).toBe(1);
  });
});
