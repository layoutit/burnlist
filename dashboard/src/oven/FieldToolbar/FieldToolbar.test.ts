import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { differentialTelemetryAvailability } from "../differential-testing-render/differential-testing-renderer.js";
import { assertDomEquivalent, extractById } from "../test-support/dom-normalize";
import { FieldToolbar, type FieldToolbarProps } from "./FieldToolbar";

const goldenDir = resolve("dashboard/src/oven/differential-testing-render/goldens");
const goldenHarnessPath = resolve("dashboard/src/oven/differential-testing-render/golden-harness.mjs");
const CHANGED_REASON = "Changed is unavailable until comparable transition telemetry is published.";

function render(props: FieldToolbarProps): string {
  return renderToStaticMarkup(createElement(FieldToolbar, props));
}

function expectedToolbar({ chart, sortChanged, changedUnavailable, changedReason, filterFailing }: {
  chart: "current" | "delta";
  sortChanged: boolean;
  changedUnavailable: boolean;
  changedReason: string;
  filterFailing: boolean;
}): string {
  return `<div id="driving-parity-controls" class="driving-parity-controls">
    <input id="driving-parity-field-search" type="search" placeholder="Search Fields..." aria-label="Differential Testing search fields">
    <span class="control-sep" aria-hidden="true">|</span>
    <div id="driving-parity-chart-toggle" class="chart-toggle differential-tabs" role="group" aria-label="Differential Testing chart mode">
      <button type="button" data-driving-parity-chart="current" aria-label="Value chart view" title="Value chart view" aria-pressed="${String(chart === "current")}">Value</button>
      <span class="sep" aria-hidden="true">·</span>
      <button type="button" data-driving-parity-chart="delta" aria-label="Delta chart view" title="Delta chart view" aria-pressed="${String(chart === "delta")}">Delta</button>
    </div>
    <span class="control-sep" aria-hidden="true">|</span>
    <div id="driving-parity-sort-toggle" class="chart-toggle sort-toggle differential-tabs" role="group" aria-label="Differential Testing sort">
      <button type="button" data-driving-parity-sort="improved" aria-pressed="${String(sortChanged)}"${changedUnavailable ? ` disabled title="${changedReason}"` : ""}>Changed</button>
    </div>
    <span class="control-sep" aria-hidden="true">|</span>
    <div id="driving-parity-filter-toggle" class="chart-toggle filter-toggle differential-tabs" role="group" aria-label="Differential Testing field filter">
      <button type="button" data-driving-parity-filter="failing" aria-pressed="${String(filterFailing)}">Failed</button>
    </div>
  </div>`;
}

for (const chart of ["current", "delta"] as const) {
  for (const sortChanged of [false, true]) {
    for (const changedUnavailable of [false, true]) {
      for (const filterFailing of [false, true]) {
        test(`FieldToolbar renders chart=${chart}, sortChanged=${sortChanged}, changedUnavailable=${changedUnavailable}, filterFailing=${filterFailing}`, () => {
          const props: FieldToolbarProps = {
            chart,
            sort: sortChanged ? "changed" : "default",
            filter: filterFailing ? "failing" : "all",
            changedUnavailable,
            changedReason: CHANGED_REASON,
            onSearchInput: () => {},
            onSelectChart: () => {},
            onToggleSort: () => {},
            onToggleFilter: () => {},
          };
          const actual = render(props);
          assertDomEquivalent(actual, expectedToolbar({ chart, sortChanged, changedUnavailable, changedReason: CHANGED_REASON, filterFailing }));
          assert.doesNotMatch(actual, /\bvalue=/u, "the search input must not render a value attribute");
        });
      }
    }
  }
}

test("FieldToolbar matches documented DT state in selected frozen goldens", async () => {
  const harness = await import(goldenHarnessPath);
  const states = [
    ["dt-main", harness.differentialTestingPayload, { chart: "delta", filter: "all", sort: "default" }],
    ["dt-comparable-telemetry", harness.differentialTestingComparableTelemetryPayload, { chart: "delta", filter: "all", sort: "changed" }],
    ["dt-no-match", harness.differentialTestingAllPassingPayload, { chart: "delta", filter: "failing", sort: "default" }],
    ["dt-chart-current-failed", harness.differentialTestingPayload, { chart: "current", filter: "all", sort: "default" }],
  ] as const;

  for (const [name, payloadBuilder, state] of states) {
    const payload = payloadBuilder();
    const telemetryAvailability = differentialTelemetryAvailability(payload);
    const props: FieldToolbarProps = {
      chart: state.chart,
      sort: state.sort,
      filter: state.filter,
      changedUnavailable: telemetryAvailability.status !== "comparable",
      changedReason: telemetryAvailability.reason,
    };
    const golden = readFileSync(resolve(goldenDir, `${name}.html`), "utf8");
    assertDomEquivalent(render(props), extractById(golden, "driving-parity-controls"), `${name} toolbar differs`);
  }
});
