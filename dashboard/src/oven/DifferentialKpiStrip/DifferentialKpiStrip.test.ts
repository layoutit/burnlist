import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { escapeHtml, kpiItem } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import { assertDomEquivalent, extractById, extractFirstByClass } from "../test-support/dom-normalize";
import { buildDifferentialKpiData, DifferentialKpiStrip, type DifferentialPayload } from "./DifferentialKpiStrip";

const goldenDir = resolve("ovens/differential-testing/renderer/goldens");
const goldenHarnessPath = resolve("ovens/differential-testing/renderer/golden-harness.mjs");
const FIXED_NOW = Date.parse("2026-01-01T12:30:00.000Z");
const scenarioVisual = '<svg class="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>';

function withGoldenEnvironment<T>(callback: () => T): T {
  const previousTz = process.env.TZ;
  const previousDateNow = Date.now;
  const OriginalDTF = Intl.DateTimeFormat;
  const Shim = function DateTimeFormat(locales: string | string[] | undefined, options?: Intl.DateTimeFormatOptions) {
    return new OriginalDTF(locales == null ? "en-US" : locales, { timeZone: "UTC", ...(options || {}) });
  } as unknown as typeof Intl.DateTimeFormat;
  Shim.prototype = OriginalDTF.prototype;
  Object.setPrototypeOf(Shim, OriginalDTF);
  process.env.TZ = "UTC";
  Date.now = () => FIXED_NOW;
  globalThis.Intl.DateTimeFormat = Shim;
  try {
    return callback();
  } finally {
    globalThis.Intl.DateTimeFormat = OriginalDTF;
    Date.now = previousDateNow;
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
}

function scenarioSelectorMarkup(scenarios: { id: string }[], selectedScenarioId: string | null | undefined): string {
  const selected = selectedScenarioId || "";
  const options = scenarios.map((scenario) => `<option value="${escapeHtml(scenario.id)}"${scenario.id === selected ? " selected" : ""}>${escapeHtml(scenario.id)}</option>`).join("");
  return `<span class="differential-scenario-control"><select id="differential-scenario-selector" aria-label="Differential Testing scenario"${scenarios.length < 2 ? " disabled" : ""}>${options}</select></span>`;
}

function scenarioControlMarkup(payload: DifferentialPayload): string {
  return extractFirstByClass(renderToStaticMarkup(createElement(DifferentialKpiStrip, { payload })), "differential-scenario-control");
}

test("DifferentialKpiStrip matches every non-empty DT/PT KPI golden", async () => {
  const harness = await import(goldenHarnessPath);
  const states = [
    ["dt-main", harness.differentialTestingPayload],
    ["dt-server-paged", harness.differentialTestingPayload],
    ["dt-sorted-filtered-paged", harness.differentialTestingPayload],
    ["dt-telemetry-incomparable", harness.differentialTestingIncomparableTelemetryPayload],
    ["dt-comparable-telemetry", harness.differentialTestingComparableTelemetryPayload],
    ["dt-comparable-no-changed", harness.differentialTestingComparableNoChangedPayload],
    ["dt-paginated", harness.differentialTestingPaginatedPayload],
    ["dt-paginated-mid", harness.differentialTestingPaginatedMidPayload],
    ["dt-no-match", harness.differentialTestingAllPassingPayload],
    ["dt-chart-current-failed", harness.differentialTestingPayload],
    ["dt-progress-mode", harness.differentialTestingPayload],
    ["pt-main", harness.performanceTracingPayload],
  ] as const;
  withGoldenEnvironment(() => {
    for (const [name, payloadBuilder] of states) {
      const payload = payloadBuilder();
      const actual = extractById(renderToStaticMarkup(createElement(DifferentialKpiStrip, { payload })), "driving-parity-kpi-strip");
      const golden = readFileSync(resolve(goldenDir, `${name}.html`), "utf8");
      assertDomEquivalent(actual, extractById(golden, "driving-parity-kpi-strip"), `${name} KPI strip differs`);
    }
  });
});

test("DifferentialKpiStrip forwards scenario changes and disables a singleton catalog", async () => {
  const { differentialTestingPayload } = await import(goldenHarnessPath);
  const payload = differentialTestingPayload();
  let selected = "";
  const markup = renderToStaticMarkup(createElement(DifferentialKpiStrip, { payload, onScenarioChange: (id) => { selected = id; } }));
  assert.match(markup, /id="differential-scenario-selector"/u);
  assert.match(markup, /disabled=""/u);
  assert.equal(selected, "");
});

test("DifferentialKpiStrip matches the vanilla scenario selector for a selected multi-scenario catalog", () => {
  const payload: DifferentialPayload = {
    scenarioCatalog: { selectedScenarioId: "beta", scenarios: [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }] },
  };
  assertDomEquivalent(scenarioControlMarkup(payload), scenarioSelectorMarkup(payload.scenarioCatalog?.scenarios ?? [], "beta"));
});

test("DifferentialKpiStrip leaves every option unselected when the catalog selection is missing", () => {
  const payload: DifferentialPayload = {
    scenarioCatalog: { selectedScenarioId: "missing", scenarios: [{ id: "alpha" }, { id: "beta" }] },
  };
  assertDomEquivalent(scenarioControlMarkup(payload), scenarioSelectorMarkup(payload.scenarioCatalog?.scenarios ?? [], "missing"));
});

test("DifferentialKpiStrip disables the selector for singleton and empty catalogs", () => {
  for (const scenarioCatalog of [
    { selectedScenarioId: "alpha", scenarios: [{ id: "alpha" }] },
    { selectedScenarioId: null, scenarios: [] },
  ]) {
    const payload: DifferentialPayload = { scenarioCatalog };
    assertDomEquivalent(scenarioControlMarkup(payload), scenarioSelectorMarkup(scenarioCatalog.scenarios, scenarioCatalog.selectedScenarioId));
  }
});

test("DifferentialKpiStrip keeps an apostrophe-bearing scenario title equivalent to the vanilla KPI oracle", () => {
  const payload: DifferentialPayload = {
    subtitle: 'Owner\'s <b> & "run"',
    scenarioCatalog: { selectedScenarioId: "alpha", scenarios: [{ id: "alpha" }, { id: "beta" }] },
  };
  const actual = extractFirstByClass(renderToStaticMarkup(createElement(DifferentialKpiStrip, { payload })), "driving-parity-kpi-scenario");
  const data = buildDifferentialKpiData(payload);
  const expected = kpiItem({
    className: "driving-parity-kpi-scenario",
    title: data.scenario.title,
    visual: scenarioVisual,
    heading: "Scenario",
    headingClass: "differential-scenario-heading",
    value: scenarioSelectorMarkup(payload.scenarioCatalog?.scenarios ?? [], payload.scenarioCatalog?.selectedScenarioId),
  });
  assertDomEquivalent(actual, expected);
});
