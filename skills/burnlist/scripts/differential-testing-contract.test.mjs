import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFERENTIAL_SAMPLE_STATES,
  DIFFERENTIAL_TESTING_DATA_SCHEMA,
  DIFFERENTIAL_TESTING_EXACT_AUTHORITY,
  DIFFERENTIAL_TESTING_EXACT_COORDINATE_ORDER,
  DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY,
  DifferentialTestingDataValidationError,
  assertDifferentialTestingData,
  buildDifferentialTelemetry,
  differentialStateVectorSha256,
  validateDifferentialTestingData,
} from "burnlist/differential-testing/contract";

test("the package contract subpath exposes the stable project-adapter API", () => {
  assert.equal(DIFFERENTIAL_TESTING_DATA_SCHEMA, "burnlist-differential-testing-data@1");
  assert.equal(DIFFERENTIAL_TESTING_EXACT_AUTHORITY, "adapter-attested");
  assert.equal(DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY, "telemetry-only");
  assert.deepEqual(DIFFERENTIAL_TESTING_EXACT_COORDINATE_ORDER, [
    "frame", "control", "tick", "call", "phaseOrder", "phase", "operationId", "fieldId",
  ]);
  assert.equal(DIFFERENTIAL_SAMPLE_STATES.match, 0);
  assert.equal(DifferentialTestingDataValidationError.name, "DifferentialTestingDataValidationError");
  for (const helper of [
    assertDifferentialTestingData,
    buildDifferentialTelemetry,
    differentialStateVectorSha256,
    validateDifferentialTestingData,
  ]) {
    assert.equal(typeof helper, "function");
  }
});
