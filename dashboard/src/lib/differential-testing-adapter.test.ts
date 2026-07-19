import assert from "node:assert/strict";
import test from "node:test";
import {
  differentialTestingEmptyPayload,
  differentialTestingPayload,
} from "../../../ovens/differential-testing/renderer/golden-harness.mjs";
import { adaptDifferentialTesting } from "./differential-testing-adapter";

test("adapter exposes the contract pointers and selects the detail page", () => {
  const data = differentialTestingPayload();
  const payload = adaptDifferentialTesting(data);
  assert.equal(payload.pageMode, "detail");
  assert.equal(payload.scenarioCatalog, data.scenarioCatalog);
  assert.equal(payload.progress, data.progress);
  assert.equal(payload.log, data.log);
  assert.equal(payload.summary.fields, data.summary.fields);
  assert.equal(payload.summary.frames, data.summary.frames);
  assert.equal(payload.fields, data.fields);
  assert.equal(payload.telemetry, data.telemetry);
  assert.equal(payload.refresh, data.refresh);
});

test("adapter selects the empty page without mutating the contract", () => {
  const data = differentialTestingEmptyPayload();
  const before = structuredClone(data);
  const payload = adaptDifferentialTesting(data);
  assert.equal(payload.pageMode, "empty");
  assert.deepEqual(data, before);
});
