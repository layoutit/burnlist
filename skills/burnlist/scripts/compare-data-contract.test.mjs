import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPayload } from "../examples/compare/adapter.mjs";
import { assertCompareData, validateCompareData } from "./compare-data-contract.mjs";

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), "../examples/compare");

function captures() {
  return ["reference.json", "candidate.json"].map((name) => JSON.parse(readFileSync(resolve(exampleDir, name), "utf8")));
}

test("accepts the neutral example and reconciles its mismatch", () => {
  const payload = buildPayload(...captures());
  assert.equal(payload.summary.fields.failed, 1);
  assert.equal(payload.summary.frames.failed, 1);
  assert.equal(payload.fields[0].firstFailingTick, 2);
  assert.doesNotThrow(() => assertCompareData(payload));
});

test("rejects a sample state that disagrees with values and tolerance", () => {
  const payload = buildPayload(...captures());
  payload.fields[0].samples[2][3] = 0;
  const result = validateCompareData(payload);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /disagrees with the values and tolerance/u);
});

test("rejects field tick identities that are merely positionally similar", () => {
  const payload = buildPayload(...captures());
  payload.fields[1].samples[1][0] = 1.5;
  const result = validateCompareData(payload);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /tick identities must match/u);
});

test("keeps present null distinct from a missing sample", () => {
  const [reference, candidate] = captures();
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
  const payload = buildPayload(...captures());
  payload.summary.frames.failed = 0;
  payload.summary.frames.passed += 1;
  assert.throws(() => assertCompareData(payload), /summary\.frames/u);
});

test("rejects an unexplained blocked payload", () => {
  const payload = buildPayload(...captures());
  payload.trust.status = "blocked";
  payload.trust.blockers = [];
  assert.throws(() => assertCompareData(payload), /must explain why trust is blocked/u);
});

test("accepts an unavailable payload that declares expected fields as blocked", () => {
  const payload = buildPayload(...captures());
  payload.trust = { status: "blocked", reportStatus: "blocked", blockers: ["The source capture failed validation."] };
  payload.fields = [];
  payload.progress = [];
  payload.log = [{ timestamp: payload.generatedAt, result: "blocked", value: 0, delta: null, failedFieldCount: 2, firstFailingTick: null, firstFailingLabel: "The source capture failed validation." }];
  payload.summary.runs = { label: "Runs", total: 1, passed: 0, failed: 0, blocked: 1 };
  payload.summary.fields = { label: "Fields", total: 2, passed: 0, failed: 0, blocked: 2 };
  payload.summary.frames = { label: "Samples", total: 0, passed: 0, failed: 0, blocked: 0, uniqueTicks: 0 };
  assert.doesNotThrow(() => assertCompareData(payload));
});
