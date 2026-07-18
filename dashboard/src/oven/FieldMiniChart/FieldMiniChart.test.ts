import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chart } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import { assertDomEquivalent } from "../test-support/dom-normalize";
import type { FieldMiniChartField, FieldMiniChartSample } from "./field-mini-chart-geometry";
import { FieldMiniChart } from "./FieldMiniChart";

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

function syntheticField(samples: FieldMiniChartSample[], sampleLabels?: (string | number)[]): FieldMiniChartField {
  return { samples, sampleLabels };
}

const syntheticCases: Array<[string, FieldMiniChartField]> = [
  ["single sample", syntheticField([[7, 1, 2, 1]], ["first"])],
  ["all-null values", syntheticField([[0, null, null, 2], [1, null, null, 2], [2, null, null, 2]])],
  ["categorical strings", syntheticField([[0, "idle", "busy", 1], [1, "busy", "busy", 0], [2, "idle", "idle", 0], [3, "busy", "idle", 1]])],
  ["boolean values", syntheticField([[0, false, false, 0], [1, true, false, 1], [2, true, true, 0], [3, false, true, 1]])],
  ["all-match values", syntheticField([[0, 0, 0, 0], [1, 1.5, 1.5, 0], [2, 3, 3, 0], [3, 2, 2, 0]])],
  ["all-fail values", syntheticField([[0, 0, 1, 1], [1, 1, 3, 1], [2, 2, 5, 1], [3, 3, 7, 1]])],
  ["multiple separated reference-failing runs", syntheticField([[0, 0, 0, 1], [1, 10, 11, 0], [2, -3, -2, 0], [3, 8, 7, 0], [4, 1, 2, 1]])],
  ["all-match reference fallback", syntheticField([[0, 1, null, 0], [1, 2, null, 0]])],
  ["internal null path split", syntheticField([[0, 1, 1, 0], [1, null, null, 0], [2, 3, 3, 0]])],
  ["alternating failure intervals", syntheticField([
    [0, 0, 0, 0], [1, 1, 2, 1], [2, 2, 2, 0], [3, 3, 5, 1], [4, 4, 4, 0], [5, 5, 8, 1], [6, 6, 6, 0],
  ], ["zero", 1, "two", 3, "four", 5, "six"])],
];

test("FieldMiniChart is DOM-equivalent to the DT chart oracle", () => {
  let datapoints = 0;
  for (const [payloadName, makePayload] of payloadFactories) {
    const payload = makePayload();
    for (const field of payload.fields) {
      for (const showFrameLabels of [true, false]) {
        for (const chartMode of ["value", "delta"]) {
          const actual = renderToStaticMarkup(createElement(FieldMiniChart, { field, showFrameLabels, chartMode }));
          const expected = chart(field, showFrameLabels, chartMode);
          assertDomEquivalent(actual, expected, `${payloadName}/${field.id}/${chartMode}/${showFrameLabels}`);
          datapoints += 1;
        }
      }
    }
  }

  for (const [caseName, field] of syntheticCases) {
    for (const showFrameLabels of [true, false]) {
      for (const chartMode of ["value", "delta"]) {
        const actual = renderToStaticMarkup(createElement(FieldMiniChart, { field, showFrameLabels, chartMode }));
        const expected = chart(field, showFrameLabels, chartMode);
        assertDomEquivalent(actual, expected, `${caseName}/${chartMode}/${showFrameLabels}`);
        if (caseName === "multiple separated reference-failing runs" && chartMode === "value") {
          const referenceFailingOffsets = [...expected.matchAll(/stroke="#61d394" stroke-width="1\.25" stroke-dasharray="5 4" stroke-dashoffset="([^"]+)"/g)]
            .map((match) => match[1]);
          assert.deepEqual(referenceFailingOffsets, ["0.00", "-2.18"], `${caseName}/${showFrameLabels} should have two dashed reference runs`);
          assert.ok(referenceFailingOffsets.some((offset) => Number(offset) !== 0), `${caseName}/${showFrameLabels} should have a nonzero dash offset`);
        }
        datapoints += 1;
      }
    }
  }

  assert.equal(datapoints, 444, "oracle battery size");
});
