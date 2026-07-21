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
  startDifferentialTestingLiveUpdates,
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

test("live updates preserve field-page metadata and issue server-side view queries", async () => {
  const scenarioId = "0123456789abcdef";
  const oven = { detail: { cells: [] } };
  const requests = [];
  const updates = [];
  let page = {
    search: "",
    filter: "all",
    sort: "changed",
    page: 0,
    pageSize: 25,
    pageCount: 4,
    total: 81,
    fields: [{ id: "initial", samples: [] }],
    telemetryFields: [{ id: "initial" }],
  };
  const compactPayload = () => ({
    publishedAt: "2026-01-01T12:00:00.000Z",
    refresh: { status: "complete", report: {} },
    telemetry: { status: "comparable", authority: "telemetry-only", blockers: [], summary: {} },
  });

  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    locationImpl: { search: `?scenario=${scenarioId}`, href: `http://localhost/ovens/differential-testing/view?scenario=${scenarioId}` },
    historyImpl: { replaceState() {} },
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fixture"' },
        async json() {
          return url === "/api/ovens/differential-testing"
            ? { oven }
            : {
                payload: compactPayload(),
                transport: { schema: "burnlist-differential-testing-page@1" },
                frameDeltaMetrics: { frameDeviationRatios: [0, 1], firstFailingFrame: 1 },
                fieldPage: page,
              };
        },
      };
    },
    setIntervalImpl: () => 17,
    clearIntervalImpl() {},
    mount: (_root, _oven, payload, options) => {
      assert.deepEqual(payload.fields, page.fields);
      assert.deepEqual(payload.telemetry.fields, page.telemetryFields);
      assert.equal(options.fieldPage, page);
      return {
        update: (_nextOven, nextPayload, nextOptions) => updates.push({ nextPayload, nextOptions }),
        setClientRefreshStatus() {},
      };
    },
  });

  await controller.ready;
  page = {
    ...page,
    search: "wheel force",
    filter: "failing",
    sort: "default",
    page: 2,
    pageSize: 50,
    fields: [{ id: "filtered", samples: [] }],
    telemetryFields: [{ id: "filtered" }],
  };
  await controller.selectFieldView(page);

  const viewRequest = requests.at(-1);
  assert.equal(
    viewRequest,
    `/api/oven-data/differential-testing?scenario=${scenarioId}&search=wheel+force&filter=failing&sort=default&page=2&pageSize=50`,
  );
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].nextPayload.fields, page.fields);
  assert.equal(updates[0].nextOptions.fieldPage, page);
  assert.deepEqual(updates[0].nextOptions.frameDeltaMetrics, {
    frameDeviationRatios: [0, 1],
    firstFailingFrame: 1,
  });
  controller.stop();
});
