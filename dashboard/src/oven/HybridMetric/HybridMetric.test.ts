import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hybridMetric } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import { assertDomEquivalent } from "../test-support/dom-normalize";
import { HybridMetric, type HybridTelemetry } from "./HybridMetric";

const {
  differentialTestingAllPassingPayload,
  differentialTestingComparableNoChangedPayload,
  differentialTestingComparableTelemetryPayload,
  differentialTestingIncomparableTelemetryPayload,
  differentialTestingPaginatedMidPayload,
  differentialTestingPaginatedPayload,
  differentialTestingPayload,
  performanceTracingPayload,
} = await import(pathToFileURL(resolve(process.cwd(), "ovens/differential-testing/renderer/golden-harness.mjs")).href);

const payloadFactories = [
  ["base", differentialTestingPayload],
  ["comparable telemetry", differentialTestingComparableTelemetryPayload],
  ["comparable no changed", differentialTestingComparableNoChangedPayload],
  ["paginated", differentialTestingPaginatedPayload],
  ["paginated mid", differentialTestingPaginatedMidPayload],
  ["all passing", differentialTestingAllPassingPayload],
  ["incomparable telemetry", differentialTestingIncomparableTelemetryPayload],
  ["performance tracing", performanceTracingPayload],
] as const;

function telemetryMap(payload: { telemetry?: { fields?: Array<{ id: string } & HybridTelemetry> } }) {
  return new Map(payload.telemetry?.fields?.map((entry) => [entry.id, entry]) ?? []);
}

test("HybridMetric matches hybridMetric for every golden field and available telemetry", () => {
  let battery = 0;
  let availableTelemetryCases = 0;
  for (const [payloadName, makePayload] of payloadFactories) {
    const payload = makePayload();
    const telemetryByField = telemetryMap(payload);
    for (const field of payload.fields) {
      const availableTelemetry = telemetryByField.get(field.id);
      const absentActual = renderToStaticMarkup(createElement(HybridMetric, { field, telemetry: undefined }));
      assertDomEquivalent(absentActual, hybridMetric(field, undefined), `${payloadName}/${field.id}/absent`);
      battery += 1;
      if (availableTelemetry) {
        const presentActual = renderToStaticMarkup(createElement(HybridMetric, { field, telemetry: availableTelemetry }));
        assertDomEquivalent(presentActual, hybridMetric(field, availableTelemetry), `${payloadName}/${field.id}/telemetry`);
        availableTelemetryCases += 1;
        battery += 1;
      }
    }
  }
  assert.equal(battery, 190, "101 absent cases plus 89 matching telemetry cases");
  assert.equal(availableTelemetryCases, 89, "available telemetry cases come from matching golden telemetry fields");
});

test("HybridMetric uses comparable telemetry fields for explicit transition oracle cases", () => {
  const payload = differentialTestingComparableTelemetryPayload();
  const telemetryByField = telemetryMap(payload);
  const positionTelemetry = telemetryByField.get("position");
  const activeTelemetry = telemetryByField.get("active");
  assert.ok(positionTelemetry, "comparable telemetry includes position");
  assert.ok(activeTelemetry, "comparable telemetry includes active");

  const cases: Array<[string, string, HybridTelemetry]> = [
    ["up", "position", { ...positionTelemetry, failToPassCount: 3, passToFailCount: 1, stayedPassCount: 4, stayedFailCount: 5, residualCount: 6 }],
    ["down", "active", { ...activeTelemetry, failToPassCount: 1, passToFailCount: 3, stayedPassCount: 4, stayedFailCount: 5, residualCount: 6 }],
    ["zero", "position", { ...positionTelemetry, failToPassCount: 2, passToFailCount: 2, stayedPassCount: 4, stayedFailCount: 5, residualCount: 6 }],
  ];

  for (const [name, fieldId, telemetry] of cases) {
    const field = payload.fields.find((candidate) => candidate.id === fieldId);
    assert.ok(field, `comparable payload includes ${fieldId}`);
    const actual = renderToStaticMarkup(createElement(HybridMetric, { field, telemetry }));
    assertDomEquivalent(actual, hybridMetric(field, telemetry), name);
    if (name === "up") {
      assert.match(actual, /class="hybrid-delta up"/u);
      assert.match(actual, /▼/u);
    } else if (name === "down") {
      assert.match(actual, /class="hybrid-delta down"/u);
      assert.match(actual, /▲/u);
    } else {
      assert.match(actual, /class="hybrid-delta "/u);
      assert.match(actual, /<span class="hybrid-delta-symbol"><\/span>/u);
    }
    assert.match(actual, /title="[0-9]+ fail-to-pass; [0-9]+ pass-to-fail; [0-9]+ stayed-pass; [0-9]+ stayed-fail; residual [0-9]+"/u);
  }
});

test("HybridMetric covers null, zero, up, down, value, and non-finite branches", () => {
  const field = { id: "metric", label: "metric", samples: [], failedSampleCount: 2, missingSampleCount: 0, maxDelta: 0.125 };
  const cases: Array<[string, HybridTelemetry | undefined, number | string | null]> = [
    ["absent", undefined, 0.125],
    ["zero", { failToPassCount: 1, passToFailCount: 1, stayedPassCount: 2, stayedFailCount: 0, residualCount: 0 }, 0.125],
    ["up", { failToPassCount: 2, passToFailCount: 0, stayedPassCount: 0, stayedFailCount: 1, residualCount: 0 }, 0.125],
    ["down", { failToPassCount: 0, passToFailCount: 2000, stayedPassCount: 0, stayedFailCount: 1, residualCount: 0 }, 0.125],
    ["null max", undefined, null],
    ["infinite max", undefined, "Infinity"],
  ];

  for (const [name, telemetry, maxDelta] of cases) {
    const actualField = { ...field, maxDelta };
    const actual = renderToStaticMarkup(createElement(HybridMetric, { field: actualField, telemetry }));
    assertDomEquivalent(actual, hybridMetric(actualField, telemetry), name);
    if (name === "absent") assert.match(actual, /class="hybrid-delta "/u);
    if (name === "up") assert.match(actual, /class="hybrid-delta up"/u);
    if (name === "down") assert.match(actual, /class="hybrid-delta down"/u);
  }
});
