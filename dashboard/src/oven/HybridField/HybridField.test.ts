import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hybridField } from "../differential-testing-render/differential-testing-render.js";
import { assertDomEquivalent } from "../test-support/dom-normalize";
import { HybridField, type HybridFieldData } from "./HybridField";

const {
  differentialTestingAllPassingPayload,
  differentialTestingComparableNoChangedPayload,
  differentialTestingComparableTelemetryPayload,
  differentialTestingEmptyPayload,
  differentialTestingIncomparableTelemetryPayload,
  differentialTestingPaginatedMidPayload,
  differentialTestingPaginatedPayload,
  differentialTestingPayload,
  performanceTracingPayload,
} = await import(pathToFileURL(resolve(process.cwd(), "dashboard/src/oven/differential-testing-render/golden-harness.mjs")).href);

const payloadFactories = [
  ["base", differentialTestingPayload],
  ["comparable telemetry", differentialTestingComparableTelemetryPayload],
  ["comparable no changed", differentialTestingComparableNoChangedPayload],
  ["paginated", differentialTestingPaginatedPayload],
  ["paginated mid", differentialTestingPaginatedMidPayload],
  ["all passing", differentialTestingAllPassingPayload],
  ["incomparable telemetry", differentialTestingIncomparableTelemetryPayload],
  ["empty", differentialTestingEmptyPayload],
  ["performance tracing", performanceTracingPayload],
] as const;

const syntheticCases: Array<[string, HybridFieldData]> = [
  ["single segment pass", { id: "pass", label: "status", samples: [], failedSampleCount: 0, missingSampleCount: 0, trustStatus: "pass", semantics: { meaning: "meaning" } }],
  ["dotted fail", { id: "fail", label: "frame.p95", samples: [], failedSampleCount: 1, missingSampleCount: 0, trustStatus: "pass", driftReason: "drift" }],
  ["deep blocked", { id: "blocked", label: "a.b.c", samples: [], failedSampleCount: 0, missingSampleCount: 1, trustStatus: "blocked", sourceOwner: "owner" }],
  ["description fallback", { id: "fallback", label: "fallback", samples: [], failedSampleCount: 0, missingSampleCount: 0, sourceOwner: "source" }],
  ["escaped text", { id: "escaped", label: "a<&.tail", samples: [], failedSampleCount: 1, missingSampleCount: 0, semantics: { meaning: "meaning & <" } }],
];

test("HybridField matches hybridField for every golden-harness field", () => {
  let battery = 0;
  for (const [payloadName, makePayload] of payloadFactories) {
    for (const field of makePayload().fields) {
      const actual = renderToStaticMarkup(createElement(HybridField, { field }));
      assertDomEquivalent(actual, hybridField(field), `${payloadName}/${field.id}`);
      battery += 1;
    }
  }
  assert.equal(battery, 101, "all golden-harness fields are covered");
});

test("HybridField covers result, description, dotted opacity, and exact style serialization", () => {
  for (const [name, field] of syntheticCases) {
    const actual = renderToStaticMarkup(createElement(HybridField, { field }));
    assertDomEquivalent(actual, hybridField(field), name);
  }

  const oneSegment = renderToStaticMarkup(createElement(HybridField, { field: syntheticCases[0][1] }));
  const dotted = renderToStaticMarkup(createElement(HybridField, { field: syntheticCases[2][1] }));
  assert.match(oneSegment, /style="opacity:1\.00"/u);
  assert.match(dotted, /style="opacity:0\.45"/u);
  assert.match(dotted, /style="opacity:1\.00"/u);
});
