import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  captureDashboardLoadError,
  captureDashboardRoot,
  differentialTestingAllPassingPayload,
  differentialTestingComparableNoChangedPayload,
  differentialTestingComparableTelemetryPayload,
  differentialTestingPayload,
  differentialTestingEmptyPayload,
  differentialTestingIncomparableTelemetryPayload,
  differentialTestingPaginatedMidPayload,
  differentialTestingPaginatedPayload,
  ovenLayout,
  performanceTracingPayload,
} from "./golden-harness.mjs";
import { assertDifferentialTestingData } from "../engine/differential-testing-data-contract.mjs";
import { differentialTelemetryAvailability } from "./differential-testing-renderer.js";

const here = dirname(fileURLToPath(import.meta.url));
const goldens = resolve(here, "goldens");
const dtOven = ovenLayout();
const ptOven = {
  id: "performance-tracing",
  name: "Performance Tracing",
  detail: { cells: JSON.parse(readFileSync(resolve(here, "../../performance-tracing/detail.json"), "utf8")).cells },
};

const base = differentialTestingPayload();
const comparableTelemetry = differentialTestingComparableTelemetryPayload();
const comparableNoChanged = differentialTestingComparableNoChangedPayload();
const paginated = differentialTestingPaginatedPayload();
const paginatedMid = differentialTestingPaginatedMidPayload();
const allPassing = differentialTestingAllPassingPayload();
const failingFields = base.fields.filter((field) => field.failedSampleCount > 0 || field.missingSampleCount > 0);
const serverPage = {
  search: "",
  filter: "all",
  sort: "changed",
  page: 0,
  pageSize: 25,
  pageCount: Math.max(1, Math.ceil(base.fields.length / 25)),
  total: base.fields.length,
  fields: base.fields,
  telemetryFields: base.telemetry?.fields ?? [],
};
const sortedFilteredPage = {
  search: "",
  filter: "failing",
  sort: "default",
  page: 0,
  pageSize: 25,
  pageCount: Math.max(1, Math.ceil(failingFields.length / 25)),
  total: failingFields.length,
  fields: failingFields,
  telemetryFields: base.telemetry?.fields ?? [],
};
const paginatedMidPage = {
  search: "",
  filter: "all",
  sort: "changed",
  page: 1,
  pageSize: 25,
  pageCount: 3,
  total: 60,
  fields: paginatedMid.fields,
  telemetryFields: paginatedMid.telemetry?.fields ?? [],
};

function dispatchFailedFilter(root) {
  const click = root._handlers?.click;
  assert.ok(click, "capture root must retain its click handler");
  click({
    target: {
      closest(selector) {
        return selector === "[data-driving-parity-filter]"
          ? { dataset: { drivingParityFilter: "failing" } }
          : null;
      },
    },
  });
}

const states = [
  ["dt-main", dtOven, base, {}],
  ["dt-empty", dtOven, differentialTestingEmptyPayload(), {}],
  ["dt-server-paged", dtOven, base, { fieldPage: serverPage }],
  ["dt-sorted-filtered-paged", dtOven, base, { fieldPage: sortedFilteredPage }],
  ["dt-telemetry-incomparable", dtOven, differentialTestingIncomparableTelemetryPayload(), {}],
  ["dt-comparable-telemetry", dtOven, comparableTelemetry, {}],
  ["dt-comparable-no-changed", dtOven, comparableNoChanged, {}],
  ["dt-paginated", dtOven, paginated, {}],
  ["dt-paginated-mid", dtOven, paginatedMid, { fieldPage: paginatedMidPage }],
  ["dt-no-match", dtOven, allPassing, {}, dispatchFailedFilter],
  ["dt-chart-current-failed", dtOven, base, { initialChart: "current", initialProgressChart: "failed" }],
  ["dt-progress-mode", dtOven, base, { initialProgressChart: "progress" }],
  ["pt-main", ptOven, performanceTracingPayload(), { initialChart: "current", initialProgressChart: "delta" }],
  ["pt-progress", ptOven, performanceTracingPayload(), { initialChart: "current", initialProgressChart: "progress" }],
  ["pt-failed", ptOven, performanceTracingPayload(), { initialChart: "current", initialProgressChart: "failed" }],
  ["dt-load-error"],
];

async function liveState([name, oven, payload, options, afterCapture]) {
  if (name === "dt-load-error") {
    const root = await captureDashboardLoadError(new Error("network unreachable"));
    return { name, html: root.innerHTML, className: root.className };
  }
  const root = captureDashboardRoot(oven, payload, options, afterCapture);
  return { name, html: root.innerHTML, className: root.className };
}

async function capturedStates() {
  const captured = [];
  for (const state of states) captured.push(await liveState(state));
  return captured;
}

test("DOM goldens remain exact for the captured dashboard states", async () => {
  mkdirSync(goldens, { recursive: true });
  for (const state of await capturedStates()) {
    const path = resolve(goldens, `${state.name}.html`);
    // WRITE_DT_GOLDENS must NEVER be set in CI/verify: it regenerates goldens instead of asserting them.
    if (process.env.WRITE_DT_GOLDENS === "1") {
      const temporaryPath = `${path}.tmp-${process.pid}`;
      writeFileSync(temporaryPath, state.html);
      renameSync(temporaryPath, path);
    }
    else assert.equal(state.html, readFileSync(path, "utf8"), `${state.name} golden differs`);
  }
});

test("every DT golden payload satisfies the data contract", () => {
  for (const [name, oven, payload] of states) {
    if (name.startsWith("dt-") && payload) assert.doesNotThrow(() => assertDifferentialTestingData(payload), name);
  }
});

test("DOM goldens contain the expected structural markers", async () => {
  const captured = new Map((await capturedStates()).map((state) => [state.name, state]));
  for (const [name, state] of captured) {
    if (name !== "dt-load-error") assert.ok(state.html.length > 100, `${name} capture is unexpectedly small`);
  }
  assert.equal(captured.get("dt-load-error").html, '<div class="empty">network unreachable</div>');
  const dtMain = captured.get("dt-main").html;
  assert.equal(captured.get("dt-main").className, "shell driving-parity-view");
  assert.equal(captured.get("dt-comparable-telemetry").className, "shell driving-parity-view");
  assert.equal(captured.get("pt-main").className, "shell driving-parity-view");
  assert.match(dtMain, /driving-parity-kpi-strip has-burns/u);
  assert.match(dtMain, /<div class="rows-view" id="hybrid-rows">/u);
  assert.match(dtMain, /checklist-log-list/u);
  assert.match(dtMain, /driving-parity-pagination/u);
  assert.match(dtMain, /data-row-expand-key="position"/u);
  assert.match(dtMain, /<span class="total">[1-9][0-9]*<\/span>/u);
  const realLogRows = dtMain.match(/<article class="log-row[^>]*>/gu)?.filter((row) => !row.includes("log-placeholder-row")) ?? [];
  assert.ok(realLogRows.length > 0, "dt-main must contain a real log row");
  assert.match(captured.get("dt-empty").html, /No Differential Testing scenarios/u);
  const serverHtml = captured.get("dt-server-paged").html;
  const serverStatus = serverHtml.match(/<span class="page-status" id="driving-parity-page-status">([^<]+)<\/span>/u)?.[1] ?? "";
  assert.doesNotMatch(serverStatus, /1-0 \/|\/ 0/u);
  assert.match(serverStatus, new RegExp(`1-${base.fields.length} \/ ${base.fields.length}`, "u"));
  assert.match(captured.get("pt-main").html, /id="progress-chart"[^>]*Frame timing/u);

  const comparableHtml = captured.get("dt-comparable-telemetry").html;
  assert.match(comparableHtml, /[0-9]+ F→P · [0-9]+ P→F · reconciled telemetry only/u);
  assert.match(comparableHtml, /<button type="button" data-driving-parity-sort="improved" aria-pressed="true">Changed<\/button>/u);
  assert.doesNotMatch(comparableHtml, /data-driving-parity-sort="improved"[^>]* disabled/u);
  assert.match(comparableHtml, /title="[0-9]+ fail-to-pass; [0-9]+ pass-to-fail; [0-9]+ stayed-pass; [0-9]+ stayed-fail; residual [0-9]+"/u);
  assert.match(comparableHtml, /class="hybrid-delta up"/u);
  assert.match(comparableHtml, /class="hybrid-delta down"/u);
  assert.ok(
    comparableHtml.indexOf('data-row-expand-key="active"') < comparableHtml.indexOf('data-row-expand-key="position"'),
    "changed sort must order the improved field before the worsened field",
  );
  assert.equal(differentialTelemetryAvailability(comparableTelemetry).status, "comparable");

  assert.match(captured.get("dt-comparable-no-changed").html, /No changed fields in this telemetry\./u);

  const paginatedHtml = captured.get("dt-paginated").html;
  assert.match(paginatedHtml, /<div id="driving-parity-pagination" class="driving-parity-controls driving-parity-pagination">/u);
  assert.match(paginatedHtml, /<button type="button" id="driving-parity-page-prev"[^>]* disabled[^>]*>Prev<\/button>/u);
  assert.match(paginatedHtml, /<span class="page-status" id="driving-parity-page-status">1-25 \/ 60<\/span>/u);
  assert.match(paginatedHtml, /<button type="button" id="driving-parity-page-next"[^>]*>Next<\/button>/u);
  assert.doesNotMatch(paginatedHtml, /id="driving-parity-page-next"[^>]* disabled/u);

  const paginatedMidHtml = captured.get("dt-paginated-mid").html;
  assert.equal(paginated.fields.length, 60);
  assert.equal(paginatedMid.fields.length, 25);
  assert.match(paginatedMidHtml, /<span class="page-status" id="driving-parity-page-status">26-50 \/ 60<\/span>/u);
  assert.match(paginatedMidHtml, /<button type="button" id="driving-parity-page-prev"[^>]*>Prev<\/button>/u);
  assert.match(paginatedMidHtml, /<button type="button" id="driving-parity-page-next"[^>]*>Next<\/button>/u);
  assert.doesNotMatch(paginatedMidHtml, /id="driving-parity-page-prev"[^>]* disabled/u);
  assert.doesNotMatch(paginatedMidHtml, /id="driving-parity-page-next"[^>]* disabled/u);

  assert.match(captured.get("dt-no-match").html, /No fields match the current view\./u);
});
