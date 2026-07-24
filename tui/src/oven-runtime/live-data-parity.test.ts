import { afterEach, describe, expect, mock, test } from "bun:test";
import { createDataClient } from "../data-client";
import { eventInvalidatesScope, isDashboardInvalidation } from "../event-stream";
import { initialLiveSnapshot, reduceLiveSnapshot, terminalServerQuery } from "./live-snapshot";
import { initTerminalRuntime, reduceTerminalRuntime } from "./state-runtime";
import type { TerminalOvenIR } from "./terminal-contract";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("console/TUI live-data transport correspondence", () => {
  test("retains a canonical snapshot across ETag 304 and keys pages by scoped query", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = mock(async (request: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(request instanceof Request ? request.headers : init?.headers);
      requests.push({ url: String(request), headers });
      if (headers.has("if-none-match")) return new Response(null, { status: 304, headers: { etag: 'W/"page-1"' } });
      return Response.json({ ovenId: "differential-testing", payload: { page: 1 }, validated: true }, { headers: { etag: 'W/"page-1"' } });
    }) as unknown as typeof fetch;
    const client = createDataClient("http://127.0.0.1:4815");
    const first = await client.ovenDataResult("differential-testing", "repo-a", undefined, { page: 1, pageSize: 25, search: "red" });
    const unchanged = await client.ovenDataResult("differential-testing", "repo-a", undefined, { page: 1, pageSize: 25, search: "red" });
    await client.ovenData("differential-testing", "repo-a", undefined, { page: 2, pageSize: 25, search: "red" });
    expect(unchanged.data).toEqual(first.data);
    expect([first.outcome, unchanged.outcome]).toEqual(["accepted", "unchanged"]);
    expect(requests[1]?.headers.get("if-none-match")).toBe('W/"page-1"');
    expect(requests[2]?.headers.get("if-none-match")).toBeNull();
    expect(requests[0]?.url).toContain("repoKey=repo-a");
    expect(requests[0]?.url).toContain("page=1");
    expect(requests[2]?.url).toContain("page=2");
  });

  test("rejects malformed snapshots and preserves abort behavior", async () => {
    globalThis.fetch = mock(async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    await expect(createDataClient("http://127.0.0.1:4815").ovenData("checklist", null)).rejects.toThrow("malformed JSON");
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = mock(async (_request, init) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return Response.json({ generatedAt: "now", projects: [] });
    }) as unknown as typeof fetch;
    await expect(createDataClient("http://127.0.0.1:4815").landing(controller.signal)).rejects.toThrow("aborted");
  });

  test("models console outcomes: load, accepted, 304, transient failure, and canonical missing", () => {
    const states = [];
    let current = initialLiveSnapshot<{ revision: number }>();
    states.push(current);
    current = reduceLiveSnapshot(current, "loading"); states.push(current);
    current = reduceLiveSnapshot(current, "accepted", { revision: 1 }); states.push(current);
    current = reduceLiveSnapshot(current, "loading"); states.push(current);
    current = reduceLiveSnapshot(current, "unchanged"); states.push(current);
    current = reduceLiveSnapshot(current, "loading"); states.push(current);
    current = reduceLiveSnapshot(current, "rejected", null, "500 unavailable"); states.push(current);
    current = reduceLiveSnapshot(current, "loading"); states.push(current);
    current = reduceLiveSnapshot(current, "missing", null, "404 gone"); states.push(current);
    expect(states.map((state) => [state.outcome, state.data?.revision ?? null, state.loading, state.stale, state.error])).toEqual([
      ["initial", null, false, false, ""], ["loading", null, true, false, ""], ["accepted", 1, false, false, ""],
      ["loading", 1, true, true, ""], ["unchanged", 1, false, false, ""], ["loading", 1, true, true, ""],
      ["rejected", 1, false, true, "500 unavailable"], ["loading", 1, true, true, ""], ["missing", null, false, false, "404 gone"],
    ]);
  });

  test("distinguishes 404/410 missing from rejected server errors", async () => {
    for (const status of [404, 410, 500]) {
      globalThis.fetch = mock(async () => Response.json({ error: `status ${status}` }, { status })) as unknown as typeof fetch;
      await expect(createDataClient("http://127.0.0.1:4815").ovenData("checklist", null)).rejects.toMatchObject({ status });
    }
  });

  test("evicts a missing representation so a replacement never sends its stale ETag", async () => {
    const headers: string[] = [];
    let call = 0;
    globalThis.fetch = mock(async (_request, init) => {
      headers.push(new Headers(init?.headers).get("if-none-match") ?? "");
      call += 1;
      if (call === 1) return Response.json({ ovenId: "checklist", payload: {} }, { headers: { etag: 'W/"old"' } });
      if (call === 2) return Response.json({ error: "gone" }, { status: 410 });
      return Response.json({ ovenId: "checklist", payload: {} });
    }) as unknown as typeof fetch;
    const client = createDataClient("http://127.0.0.1:4815");
    await client.ovenData("checklist", null);
    await expect(client.ovenData("checklist", null)).rejects.toMatchObject({ status: 410 });
    await client.ovenData("checklist", null);
    expect(headers).toEqual(["", 'W/"old"', ""]);
  });

  test("filters invalidations by Oven/repository while retaining global reset reconciliation", () => {
    const scope = { ovenId: "shared", repoKey: "repo-a" };
    const publish = { ovenId: "shared", repoKey: "repo-a", kind: "data-published", phase: "complete" };
    expect(isDashboardInvalidation(publish)).toBe(true);
    expect(isDashboardInvalidation({ ...publish, kind: "binding-changed" })).toBe(true);
    expect(isDashboardInvalidation({ ...publish, kind: "definition-changed" })).toBe(true);
    expect(eventInvalidatesScope(publish, scope)).toBe(true);
    expect(eventInvalidatesScope({ ...publish, repoKey: "repo-b" }, scope)).toBe(false);
    expect(eventInvalidatesScope({ ...publish, ovenId: "other" }, scope)).toBe(false);
    expect(eventInvalidatesScope(undefined, scope)).toBe(true);
    expect(eventInvalidatesScope({ ovenId: "shared", repoKey: "repo-a", subjectId: "b", kind: "item-burned", phase: "completed" }, { ...scope, subjectId: "a" })).toBe(false);
    expect(eventInvalidatesScope({ ovenId: "shared", repoKey: "repo-a", subjectId: "b", kind: "data-published", phase: "complete" }, { ...scope, subjectId: "a" })).toBe(true);
  });

  test("retains server controls and changes the canonical next-page request", () => {
    const ir = { schema: "burnlist-oven-ir@1", id: "dt", version: "1", contract: "x", theme: "default", root: [{ kind: "collection", attributes: { id: "rows", source: "/rows", paging: "server", pageSize: 25, searchFrom: "query", filterFrom: "failed", sortFrom: "changed" }, bindings: {}, children: [] }], requirements: { components: [], formats: [], icons: [], selectors: [] }, controls: [{ id: "query", kind: "search" }, { id: "failed", kind: "filter-toggle", key: "non-pass" }, { id: "changed", kind: "sort-toggle", key: "changed" }], collections: [{ id: "rows", source: "/rows", paging: "server", pageSize: 25 }] } as unknown as TerminalOvenIR;
    let state = initTerminalRuntime(ir, { rows: [], __burnlistOvenRuntime: { collectionPages: { "/rows": { page: 0, pageSize: 25, pageCount: 3, total: 60 } } } });
    state = reduceTerminalRuntime(state, { type: "queryChanged", id: "query", value: "needle" }, ir);
    state = reduceTerminalRuntime(state, { type: "toggleChanged", id: "failed", active: true }, ir);
    state = reduceTerminalRuntime(state, { type: "pageNext", collectionId: "rows" }, ir);
    expect(terminalServerQuery(ir, state)).toEqual({ search: "needle", filter: "failing", sort: "default", page: 1, pageSize: 25 });
  });
});
