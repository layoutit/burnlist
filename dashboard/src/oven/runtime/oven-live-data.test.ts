import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { dtAdapt, ptAdapt } from "../../components/DifferentialTestingOven/DifferentialTestingOven";
import { adaptDifferentialTesting } from "../../lib/differential-testing-adapter";
import { adaptPerformanceTracingReport } from "../../lib/performance-tracing.mjs";
import { createOvenPoller, ovenDataUrl, scenarioSearch } from "./oven-live-data";
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

test("scenario selection rekeys poller requests while retaining the repository key", async () => {
  const urls: string[] = [], actions: OvenAction[] = [];
  const fetchImpl = async (url: string) => { urls.push(url); return response({}); };
  for (const scenario of ["A", "B"]) {
    const poller = createOvenPoller({
      id: "differential-testing",
      dispatch: (action) => actions.push(action),
      fetchImpl,
      search: scenarioSearch("?repoKey=repo-1&scenario=old&ignored=x", scenario),
    });
    poller.refresh();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(urls, [
    "/api/oven-data/differential-testing?repoKey=repo-1&scenario=A",
    "/api/oven-data/differential-testing?repoKey=repo-1&scenario=B",
  ]);
  assert.equal(ovenDataUrl("differential-testing", scenarioSearch("", "X")), "/api/oven-data/differential-testing?scenario=X");
});

test("oven poller adapts DT and PT envelopes while unadapted polls retain raw bodies", async () => {
  const fixture = await import(pathToFileURL(resolve(process.cwd(), "ovens/differential-testing/renderer/golden-harness.mjs")).href);
  const dtReport = fixture.differentialTestingPayload();
  const ptReport = {
    runId: "trace-fixture", generatedAt: "2026-07-15T12:00:00.000Z", status: "pass",
    scenario: { id: "prepared" }, metrics: { p95FrameMs: 20 }, budgets: { p95FrameMs: 25 },
    runs: [{ frameTiming: { series: [{ frame: 0, frameMs: 20 }] } }],
  };
  const envelopes = [
    { ovenId: "differential-testing", path: "/api/oven-data/differential-testing", scenarioId: "fixture", payload: dtReport },
    { ovenId: "performance-tracing", path: "/api/oven-data/performance-tracing", payload: ptReport, validated: true },
  ];
  const expected = [adaptDifferentialTesting(dtReport), adaptDifferentialTesting(adaptPerformanceTracingReport(ptReport))];

  for (const [index, adapt] of [dtAdapt, ptAdapt].entries()) {
    const actions: OvenAction[] = [];
    const poller = createOvenPoller({ id: String(envelopes[index].ovenId), dispatch: (action) => actions.push(action), fetchImpl: async () => response(envelopes[index]), adapt });
    poller.refresh();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(actions.find((action) => action.type === "payloadAccepted"), { type: "payloadAccepted", payload: expected[index], generation: 1 });
  }

  const rawActions: OvenAction[] = [];
  const rawPoller = createOvenPoller({ id: "sample", dispatch: (action) => rawActions.push(action), fetchImpl: async () => response(envelopes[0]) });
  rawPoller.refresh();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(rawActions.find((action) => action.type === "payloadAccepted"), { type: "payloadAccepted", payload: envelopes[0], generation: 1 });
});
