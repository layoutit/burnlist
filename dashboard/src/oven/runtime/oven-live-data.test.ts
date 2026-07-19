import assert from "node:assert/strict";
import { test } from "node:test";
import { createOvenPoller, ovenDataUrl } from "./oven-live-data";
import type { OvenAction } from "./oven-reducer";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const response = (payload: unknown, etag = "v1") => ({ ok: true, status: 200, headers: { get: (name: string) => name === "etag" ? etag : null }, json: async () => payload });

test("oven poller keeps one request active, queues one retry, and retains ETags", async () => {
  const first = deferred<any>(), second = deferred<any>(), calls: RequestInit[] = [], actions: OvenAction[] = [];
  const poller = createOvenPoller({ id: "sample", dispatch: (action) => actions.push(action), fetchImpl: async (_url, init) => { calls.push(init); return calls.length === 1 ? first.promise : second.promise; }, search: "?repoKey=abc&ignored=x" });
  poller.refresh(); poller.refresh(); poller.refresh();
  assert.equal(calls.length, 1);
  first.resolve(response({ version: 1 })); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  second.resolve(response({ version: 2 }, "v2")); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls[1].headers, { "If-None-Match": "v1" });
  assert.equal(actions.filter((action) => action.type === "payloadAccepted").length, 2);
  assert.equal(ovenDataUrl("sample", "?repoKey=abc&bad=no"), "/api/oven-data/sample?repoKey=abc");
});

test("oven poller reports failures without inventing an accepted replacement", async () => {
  const actions: OvenAction[] = [];
  const poller = createOvenPoller({ id: "sample", dispatch: (action) => actions.push(action), fetchImpl: async () => { throw new Error("offline"); }, search: "" });
  poller.refresh(); await Promise.resolve(); await Promise.resolve();
  assert.equal(actions.some((action) => action.type === "payloadAccepted"), false);
  assert.equal(actions.some((action) => action.type === "payloadRejected"), true);
});
