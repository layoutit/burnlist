import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fieldRows } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import { assertDomEquivalent, extractById, normalize, parseHtml, serializeCanonical, type ElementNode } from "../test-support/dom-normalize";
import { HybridFieldList, type HybridFieldData, type TelemetryAvailability } from "./HybridFieldList";
import type { HybridTelemetry } from "../HybridMetric";

const {
  differentialTestingAllPassingPayload,
  differentialTestingComparableNoChangedPayload,
  differentialTestingComparableTelemetryPayload,
  differentialTestingIncomparableTelemetryPayload,
  differentialTestingPaginatedMidPayload,
  differentialTestingPaginatedPayload,
  differentialTestingPayload,
} = await import(pathToFileURL(resolve(process.cwd(), "ovens/differential-testing/renderer/golden-harness.mjs")).href);

const payloadFactories = [
  ["base", differentialTestingPayload],
  ["comparable telemetry", differentialTestingComparableTelemetryPayload],
  ["comparable no changed", differentialTestingComparableNoChangedPayload],
  ["paginated", differentialTestingPaginatedPayload],
  ["paginated mid", differentialTestingPaginatedMidPayload],
  ["all passing", differentialTestingAllPassingPayload],
  ["incomparable telemetry", differentialTestingIncomparableTelemetryPayload],
] as const;

function telemetryMap(payload: { telemetry?: { fields?: Array<{ id: string }> } }) {
  return new Map(payload.telemetry?.fields?.map((entry) => [entry.id, entry]) ?? []);
}

function availability(payload: { telemetry?: { status?: string } }): TelemetryAvailability {
  return { status: payload.telemetry?.status === "comparable" ? "comparable" : "blocked", reason: "Transition telemetry unavailable." };
}

function rowsOracle(fields: HybridFieldData[], expanded: ReadonlySet<string>, telemetryByField: Map<string, object>, chartMode: string, sort = "default", telemetryAvailabilityValue = availability({})): string {
  return fieldRows(fields, { state: { expanded, sort, telemetryAvailability: telemetryAvailabilityValue }, telemetryByField, chartMode });
}

function wrapperChild(html: string): string {
  const [node] = normalize(parseHtml(html));
  assert.equal(node?.type, "element");
  return serializeCanonical((node as ElementNode).children);
}

test("HybridFieldList matches fieldRows for representative golden-harness lists and both chart modes", () => {
  let battery = 0;
  for (const [payloadName, makePayload] of payloadFactories) {
    const payload = makePayload();
    const telemetryByField = telemetryMap(payload);
    for (const chartMode of ["value", "delta"]) {
      const expanded = new Set(payload.fields.length ? [payload.fields[0].id] : []);
      const props = { fields: payload.fields, expanded, telemetryByField, chartMode, sort: "default", telemetryAvailability: availability(payload) };
      const actual = renderToStaticMarkup(createElement(HybridFieldList, props));
      assertDomEquivalent(actual, rowsOracle(payload.fields, expanded, telemetryByField, chartMode, "default", availability(payload)), `${payloadName}/${chartMode}`);
      battery += 1;
    }
  }
  assert.equal(battery, 14, "all non-empty golden payloads cover both chart branches");
});

test("HybridFieldList renders all three empty-list messages", () => {
  const noMatch = differentialTestingAllPassingPayload();
  const comparable = differentialTestingComparableNoChangedPayload();
  const cases = [
    ["default", noMatch, "default", { status: "blocked", reason: "Transition telemetry unavailable." }, "No fields match the current view."],
    ["comparable changed", comparable, "changed", { status: "comparable", reason: "ignored" }, "No changed fields in this telemetry."],
    ["blocked changed", noMatch, "changed", { status: "blocked", reason: "Transition telemetry unavailable." }, "Transition telemetry unavailable."],
  ] as const;

  for (const [name, payload, sort, telemetryAvailabilityValue, message] of cases) {
    const actual = renderToStaticMarkup(createElement(HybridFieldList, { fields: [], chartMode: "delta", sort, telemetryAvailability: telemetryAvailabilityValue }));
    const expected = fieldRows([], { state: { expanded: new Set(), sort, telemetryAvailability: telemetryAvailabilityValue }, telemetryByField: new Map(), chartMode: "delta" });
    assertDomEquivalent(actual, expected, name);
    assert.match(actual, new RegExp(`<div class="empty">${message.replaceAll(".", "\\.")}</div>`, "u"));
  }
});

test("HybridFieldList matches the child of the frozen server-page and paginated-mid goldens", () => {
  const goldenDir = resolve(process.cwd(), "ovens/differential-testing/renderer/goldens");
  const cases = [
    ["dt-server-paged", differentialTestingPayload()],
    ["dt-paginated-mid", differentialTestingPaginatedMidPayload()],
  ] as const;

  for (const [goldenName, payload] of cases) {
    const golden = readFileSync(resolve(goldenDir, `${goldenName}.html`), "utf8");
    const actual = renderToStaticMarkup(createElement(HybridFieldList, {
      fields: payload.fields,
      expanded: new Set(),
      telemetryByField: telemetryMap(payload),
      chartMode: "delta",
      sort: "default",
      telemetryAvailability: availability(payload),
    }));
    assertDomEquivalent(actual, wrapperChild(extractById(golden, "hybrid-rows")), goldenName);
  }
});

test("HybridFieldList matches the empty-list children of the frozen empty goldens", () => {
  const goldenDir = resolve(process.cwd(), "ovens/differential-testing/renderer/goldens");
  const cases = [
    ["dt-no-match", "default", { status: "blocked", reason: "Transition telemetry unavailable." }],
    ["dt-comparable-no-changed", "changed", { status: "comparable", reason: "ignored" }],
  ] as const;
  for (const [goldenName, sort, telemetryAvailabilityValue] of cases) {
    const golden = readFileSync(resolve(goldenDir, `${goldenName}.html`), "utf8");
    const actual = renderToStaticMarkup(createElement(HybridFieldList, { fields: [], chartMode: "delta", sort, telemetryAvailability: telemetryAvailabilityValue }));
    assertDomEquivalent(actual, wrapperChild(extractById(golden, "hybrid-rows")), goldenName);
  }
});

test("HybridFieldList reads telemetry from a cross-realm Map", () => {
  const payload = differentialTestingComparableTelemetryPayload();
  const field = payload.fields[0];
  const telemetry = payload.telemetry.fields[0] as HybridTelemetry;
  const crossRealmTelemetryByField = runInNewContext("new Map([[fieldId, telemetry]])", {
    fieldId: field.id,
    telemetry,
  }) as ReadonlyMap<string, HybridTelemetry>;
  const actual = renderToStaticMarkup(createElement(HybridFieldList, {
    fields: [field],
    telemetryByField: crossRealmTelemetryByField,
    chartMode: "delta",
  }));
  const expected = fieldRows([field], {
    state: { expanded: new Set(), sort: "default", telemetryAvailability: availability(payload) },
    telemetryByField: new Map([[field.id, telemetry]]),
    chartMode: "delta",
  });
  assertDomEquivalent(actual, expected, "cross-realm Map");
});
