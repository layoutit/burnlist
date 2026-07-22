import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFERENTIAL_TESTING_BUNDLE_SCHEMA,
  DIFFERENTIAL_TESTING_FIELD_RECORD_SCHEMA,
  DIFFERENTIAL_TESTING_PAGE_SCHEMA,
  DIFFERENTIAL_TESTING_SCENARIO_SCHEMA,
  assertDifferentialTestingBundle,
  queryDifferentialTestingFieldPage,
} from "burnlist/differential-testing/transport";

import {
  differentialPagedPayload,
} from "../../../dashboard/src/oven/differential-testing-render/differential-testing-renderer.js";

test("the package transport subpath exposes the stable bundle API", () => {
  assert.equal(DIFFERENTIAL_TESTING_BUNDLE_SCHEMA, "burnlist-differential-testing-bundle@1");
  assert.equal(DIFFERENTIAL_TESTING_SCENARIO_SCHEMA, "burnlist-differential-testing-scenario@1");
  assert.equal(DIFFERENTIAL_TESTING_FIELD_RECORD_SCHEMA, "burnlist-differential-testing-field-record@1");
  assert.equal(DIFFERENTIAL_TESTING_PAGE_SCHEMA, "burnlist-differential-testing-page@1");
  assert.equal(typeof assertDifferentialTestingBundle, "function");
  assert.equal(typeof queryDifferentialTestingFieldPage, "function");
});

test("paged transport fields are projected into the existing renderer payload without mutating the compact envelope", () => {
  const compact = {
    fields: [],
    telemetry: {
      status: "comparable",
      authority: "telemetry-only",
      blockers: [],
      summary: {},
    },
  };
  delete compact.fields;
  const field = { id: "sourceCar.speed", samples: [[0, 1, 2, 1]] };
  const telemetry = { id: field.id, transitions: [[0, 0, 1]] };

  const projected = differentialPagedPayload(compact, {
    fields: [field],
    telemetryFields: [telemetry],
  });

  assert.deepEqual(projected.fields, [field]);
  assert.deepEqual(projected.telemetry.fields, [telemetry]);
  assert.equal(Object.hasOwn(compact, "fields"), false);
  assert.equal(Object.hasOwn(compact.telemetry, "fields"), false);
  assert.equal(differentialPagedPayload(projected, null), projected);
});
