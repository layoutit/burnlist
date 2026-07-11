import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPayload } from "../examples/compare/adapter.mjs";
import { COMPARE_REFRESH_MS, startCompareDashboardLiveUpdates } from "../dashboard/fallback-compare-oven.js";
import { assertCompareData, validateCompareData } from "./compare-data-contract.mjs";

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), "../examples/compare");

function emptyCaptures() {
  return ["reference.json", "candidate.json"].map((name) => JSON.parse(readFileSync(resolve(exampleDir, name), "utf8")));
}

function populatedCaptures() {
  return [
    {
      captureId: "reference-fixture",
      generatedAt: "2026-01-01T12:00:00.000Z",
      fields: [
        { id: "position", label: "Position", sourceOwner: "engine/state", meaning: "One-dimensional position after the update", unit: "units", tolerance: 0.01 },
        { id: "active", label: "Active", sourceOwner: "engine/state", meaning: "Whether the object is active after the update", unit: null, tolerance: 0 },
      ],
      samples: [
        { tick: 0, values: { position: 0, active: false } },
        { tick: 1, values: { position: 1, active: true } },
        { tick: 2, values: { position: 2, active: true } },
      ],
    },
    {
      captureId: "candidate-fixture",
      generatedAt: "2026-01-01T12:00:00.000Z",
      samples: [
        { tick: 0, values: { position: 0, active: false } },
        { tick: 1, values: { position: 1.005, active: true } },
        { tick: 2, values: { position: 2.1, active: true } },
      ],
    },
  ];
}

test("accepts the empty shipped example without inventing a run", () => {
  const payload = buildPayload(...emptyCaptures());
  assert.equal(payload.summary.runs.total, 0);
  assert.equal(payload.summary.fields.total, 0);
  assert.equal(payload.summary.frames.total, 0);
  assert.deepEqual(payload.progress, []);
  assert.deepEqual(payload.log, []);
  assert.deepEqual(payload.fields, []);
  assert.doesNotThrow(() => assertCompareData(payload));
});

test("accepts populated data and reconciles its mismatch", () => {
  const payload = buildPayload(...populatedCaptures());
  assert.equal(payload.summary.fields.failed, 1);
  assert.equal(payload.summary.frames.failed, 1);
  assert.equal(payload.fields[0].firstFailingTick, 2);
  assert.doesNotThrow(() => assertCompareData(payload));
});

test("rejects a sample state that disagrees with values and tolerance", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.fields[0].samples[2][3] = 0;
  const result = validateCompareData(payload);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /disagrees with the values and tolerance/u);
});

test("rejects field tick identities that are merely positionally similar", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.fields[1].samples[1][0] = 1.5;
  const result = validateCompareData(payload);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /tick identities must match/u);
});

test("keeps present null distinct from a missing sample", () => {
  const [reference, candidate] = populatedCaptures();
  reference.samples[1].values.active = null;
  candidate.samples[1].values.active = null;
  delete candidate.samples[2].values.active;
  const payload = buildPayload(reference, candidate);
  const active = payload.fields.find((field) => field.id === "active");
  assert.deepEqual(active.samples[1], [1, null, null, 0]);
  assert.deepEqual(active.samples[2], [2, true, null, 3]);
  assert.equal(active.failedSampleCount, 0);
  assert.equal(active.missingSampleCount, 1);
  assert.equal(active.trustStatus, "blocked");
  assert.equal(payload.trust.status, "blocked");
  assert.doesNotThrow(() => assertCompareData(payload));
});

test("rejects summary totals that do not reconcile with raw samples", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.summary.frames.failed = 0;
  payload.summary.frames.passed += 1;
  assert.throws(() => assertCompareData(payload), /summary\.frames/u);
});

test("rejects an unexplained blocked payload", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.trust.status = "blocked";
  payload.trust.blockers = [];
  assert.throws(() => assertCompareData(payload), /must explain why trust is blocked/u);
});

test("accepts an unavailable payload that declares expected fields as blocked", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.trust = { status: "blocked", reportStatus: "blocked", blockers: ["The source capture failed validation."] };
  payload.fields = [];
  payload.progress = [];
  payload.log = [{ timestamp: payload.generatedAt, result: "blocked", value: 0, delta: null, failedFieldCount: 2, firstFailingTick: null, firstFailingLabel: "The source capture failed validation." }];
  payload.summary.runs = { label: "Runs", total: 1, passed: 0, failed: 0, blocked: 1 };
  payload.summary.fields = { label: "Fields", total: 2, passed: 0, failed: 0, blocked: 2 };
  payload.summary.frames = { label: "Samples", total: 0, passed: 0, failed: 0, blocked: 0, uniqueTicks: 0 };
  assert.doesNotThrow(() => assertCompareData(payload));
});

test("live Compare dashboard polls and updates only when the payload revision changes", async () => {
  const oven = { detail: { cells: [] } };
  let payload = { generatedAt: "2026-01-01T12:00:00.000Z" };
  const requests = [];
  let intervalCallback = null;
  let intervalMs = null;
  let clearedTimer = null;
  const mountedPayloads = [];
  const updatedPayloads = [];
  const controller = startCompareDashboardLiveUpdates({ innerHTML: "" }, {
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return {
        ok: true,
        async json() {
          return url === "/api/ovens/compare" ? { oven } : { payload };
        },
      };
    },
    setIntervalImpl: (callback, delay) => {
      intervalCallback = callback;
      intervalMs = delay;
      return 17;
    },
    clearIntervalImpl: (timer) => { clearedTimer = timer; },
    mount: (_root, _oven, initialPayload) => {
      mountedPayloads.push(initialPayload);
      return { update: (_nextOven, nextPayload) => updatedPayloads.push(nextPayload) };
    },
  });

  await controller.ready;
  assert.equal(intervalMs, COMPARE_REFRESH_MS);
  assert.equal(COMPARE_REFRESH_MS, 2000);
  assert.deepEqual(mountedPayloads, [payload]);
  assert.equal(requests.filter(([url]) => url === "/api/ovens/compare").length, 1);

  await intervalCallback();
  assert.equal(updatedPayloads.length, 0);
  payload = { generatedAt: "2026-01-01T12:00:02.000Z" };
  await intervalCallback();
  assert.deepEqual(updatedPayloads, [payload]);
  assert.equal(requests.filter(([url]) => url === "/api/ovens/compare").length, 1);
  assert.ok(requests.every(([, options]) => options.cache === "no-store"));

  controller.stop();
  assert.equal(clearedTimer, 17);
});
