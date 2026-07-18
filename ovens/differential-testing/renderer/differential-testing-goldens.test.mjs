import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  captureDashboardHtml,
  differentialTestingPayload,
  differentialTestingEmptyPayload,
  differentialTestingIncomparableTelemetryPayload,
  ovenLayout,
  performanceTracingPayload,
} from "./golden-harness.mjs";
import { assertDifferentialTestingData } from "../engine/differential-testing-data-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const goldens = resolve(here, "goldens");
const dtOven = ovenLayout();
const ptOven = {
  id: "performance-tracing",
  name: "Performance Tracing",
  detail: { cells: JSON.parse(readFileSync(resolve(here, "../../performance-tracing/detail.json"), "utf8")).cells },
};

const base = differentialTestingPayload();
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

const states = [
  ["dt-main", dtOven, base, {}],
  ["dt-empty", dtOven, differentialTestingEmptyPayload(), {}],
  ["dt-server-paged", dtOven, base, { fieldPage: serverPage }],
  ["dt-sorted-filtered-paged", dtOven, base, { fieldPage: sortedFilteredPage }],
  ["dt-telemetry-incomparable", dtOven, differentialTestingIncomparableTelemetryPayload(), {}],
  ["dt-chart-current-failed", dtOven, base, { initialChart: "current", initialProgressChart: "failed" }],
  ["dt-progress-mode", dtOven, base, { initialProgressChart: "progress" }],
  ["pt-main", ptOven, performanceTracingPayload(), { initialChart: "current", initialProgressChart: "delta" }],
];

function liveState([name, oven, payload, options]) {
  return { name, html: captureDashboardHtml(oven, payload, options) };
}

test("DOM goldens remain exact for the captured dashboard states", () => {
  mkdirSync(goldens, { recursive: true });
  for (const state of states.map(liveState)) {
    const path = resolve(goldens, `${state.name}.html`);
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
    if (name.startsWith("dt-")) assert.doesNotThrow(() => assertDifferentialTestingData(payload), name);
  }
});

test("DOM goldens contain the expected structural markers", () => {
  const captured = new Map(states.map((state) => {
    const live = liveState(state);
    return [live.name, live];
  }));
  for (const [name, state] of captured) assert.ok(state.html.length > 100, `${name} capture is unexpectedly small`);
  const dtMain = captured.get("dt-main").html;
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
});
