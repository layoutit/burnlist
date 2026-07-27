import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { dtAdapt, ptAdapt } from "../../components/DifferentialTestingOven/DifferentialTestingOven";
import { adaptDifferentialTesting } from "../../lib/differential-testing-adapter";
import { adaptPerformanceTracingReport } from "../../lib/performance-tracing.mjs";
import {
  ovenDataUrl,
  ovenRuntimeSnapshotDescriptor,
  scenarioSearch,
  subscribeOvenRuntimeSnapshot,
} from "./oven-live-data";
import { initOvenState, ovenReducer, type OvenAction } from "./oven-reducer";

type Snapshot = {
  data: unknown;
  error: string;
  generation: number;
  stale?: boolean;
  outcome: "initial" | "loading" | "accepted" | "unchanged" | "rejected" | "missing";
};

function fakeClient() {
  let descriptor: any;
  let listener: ((state: Snapshot) => void) | undefined;
  let unsubscribed = false;
  return {
    subscribe(nextDescriptor: any, nextListener: (state: Snapshot) => void) {
      descriptor = nextDescriptor;
      listener = nextListener;
      return { refresh() {}, unsubscribe() { unsubscribed = true; } };
    },
    emit(state: Snapshot) { listener!(state); },
    descriptor: () => descriptor,
    unsubscribed: () => unsubscribed,
  };
}

function loading(generation: number): Snapshot {
  return { data: null, error: "", generation, outcome: "loading" };
}

test("runtime subscriptions key canonical snapshots by repository, scenario, and query", () => {
  const client = fakeClient();
  const actions: OvenAction[] = [];
  const search = scenarioSearch("?repoKey=repo-1&scenario=old&ignored=x", "case-a");
  const subscription = subscribeOvenRuntimeSnapshot({
    client,
    id: "differential-testing",
    search,
    dispatch: (action) => actions.push(action),
  });

  assert.deepEqual(client.descriptor(), {
    repoKey: "repo-1",
    ovenId: "differential-testing",
    subjectId: "case-a",
    query: "repoKey=repo-1&scenario=case-a",
    url: "/api/oven-data/differential-testing?repoKey=repo-1&scenario=case-a",
    fallbackMs: 30_000,
    fallbackError: "Could not load Oven differential-testing.",
    receive: client.descriptor().receive,
  });
  assert.equal(ovenDataUrl("differential-testing", scenarioSearch("", "X")), "/api/oven-data/differential-testing?scenario=X");
  subscription.unsubscribe();
  assert.equal(client.unsubscribed(), true);
  assert.deepEqual(actions, []);
});

test("shared snapshot outcomes retain reducer generations and unchanged payloads", () => {
  const client = fakeClient();
  const actions: OvenAction[] = [];
  subscribeOvenRuntimeSnapshot({
    client,
    id: "sample",
    search: "",
    dispatch: (action) => actions.push(action),
  });
  client.emit(loading(41));
  client.emit({ data: { version: 1 }, error: "", generation: 41, outcome: "accepted" });
  client.emit(loading(42));
  client.emit({ data: { version: 1 }, error: "", generation: 42, outcome: "unchanged" });

  assert.deepEqual(actions, [
    { type: "payloadRequested", generation: 41 },
    { type: "payloadAccepted", payload: { version: 1 }, generation: 41 },
    { type: "payloadRequested", generation: 42 },
    { type: "payloadUnchanged", generation: 42 },
  ]);
});

test("a reactivated cached query accepts its keyed payload after a 304", () => {
  const client = fakeClient();
  const actions: OvenAction[] = [];
  subscribeOvenRuntimeSnapshot({
    client,
    id: "sample",
    search: "?scenario=returning",
    dispatch: (action) => actions.push(action),
  });
  client.emit(loading(75));
  client.emit({ data: { scenario: "returning" }, error: "", generation: 75, outcome: "unchanged" });
  assert.deepEqual(actions.at(-1), {
    type: "payloadAccepted",
    payload: { scenario: "returning" },
    generation: 75,
  });
});

test("runtime snapshot failures preserve the reducer's last good payload", () => {
  const ir = { contract: "fixture", controls: [], collections: [], root: [] };
  const retained = { version: 1 };
  let state = initOvenState(ir, retained);
  const client = fakeClient();
  subscribeOvenRuntimeSnapshot({
    client,
    id: "sample",
    search: "",
    dispatch(action) { state = ovenReducer(state, action, ir); },
  });
  client.emit(loading(9));
  client.emit({ data: null, error: "offline", generation: 9, outcome: "rejected" });
  assert.equal(state.payload, retained);
  assert.deepEqual(state.refresh, { phase: "failed", error: "offline", generation: 9, stale: true });
});

test("runtime snapshot missing outcomes clear a formerly valid payload", () => {
  const ir = { contract: "fixture", controls: [], collections: [], root: [] };
  let state = initOvenState(ir, { version: 1 });
  const client = fakeClient();
  subscribeOvenRuntimeSnapshot({
    client,
    id: "sample",
    search: "",
    dispatch(action) { state = ovenReducer(state, action, ir); },
  });
  client.emit(loading(10));
  client.emit({ data: null, error: "Oven is unbound.", generation: 10, outcome: "missing" });
  assert.equal(state.payload, undefined);
  assert.deepEqual(state.refresh, { phase: "failed", error: "Oven is unbound.", generation: 10, stale: false });
});

test("runtime snapshot descriptors adapt DT and PT envelopes", async () => {
  const fixture = await import(pathToFileURL(resolve(process.cwd(), "dashboard/src/oven/differential-testing-render/golden-harness.mjs")).href);
  const dtReport = fixture.differentialTestingPayload();
  const ptReport = fixture.performanceTracingReport();
  const envelopes = [
    { ovenId: "differential-testing", payload: dtReport },
    { ovenId: "performance-tracing", payload: ptReport, validated: true },
  ];
  const expected = [adaptDifferentialTesting(dtReport), adaptDifferentialTesting(adaptPerformanceTracingReport(ptReport))];
  const response = { ok: true, status: 200 } as Response;

  for (const [index, adapt] of [dtAdapt, ptAdapt].entries()) {
    const descriptor = ovenRuntimeSnapshotDescriptor({ id: String(envelopes[index].ovenId), search: "", adapt });
    assert.deepEqual(descriptor.receive(response, envelopes[index]), expected[index]);
  }
  const failing = ovenRuntimeSnapshotDescriptor({ id: "sample", search: "" });
  assert.throws(() => failing.receive({ ok: false, status: 422 } as Response, { error: "invalid fixture" }), /invalid fixture/u);
});

test("oven data API calls inject the path-scoped repository key", () => {
  const target = globalThis as { window?: { location: { pathname: string; search: string } } };
  const original = target.window;
  target.window = { location: { pathname: "/r/repo%2Fkey/o/differential-testing", search: "?scenario=case-1" } };
  try {
    assert.equal(ovenDataUrl("differential-testing"), "/api/oven-data/differential-testing?repoKey=repo%2Fkey&scenario=case-1");
  } finally {
    if (original) target.window = original;
    else delete target.window;
  }
});
