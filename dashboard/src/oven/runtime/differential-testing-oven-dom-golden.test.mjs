import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import {
  differentialTestingAllPassingPayload,
  differentialTestingComparableNoChangedPayload,
  differentialTestingComparableTelemetryPayload,
  differentialTestingEmptyPayload,
  differentialTestingIncomparableTelemetryPayload,
  differentialTestingMultiScenarioPayload,
  differentialTestingPaginatedMidPayload,
  differentialTestingPaginatedPayload,
  differentialTestingPayload,
} from "../../../../ovens/differential-testing/renderer/golden-harness.mjs";
import { differentialPagedPayload } from "../../../../ovens/differential-testing/renderer/differential-testing-renderer.js";

const runtimePath = new URL("./OvenRuntime.tsx", import.meta.url).pathname;
const adapterPath = new URL("../../lib/differential-testing-adapter.ts", import.meta.url).pathname;
const normalizerPath = new URL("../test-support/dom-normalize.ts", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
const FIXED_NOW = Date.parse("2026-01-01T12:30:00.000Z");

const base = differentialTestingPayload();
const failingFields = base.fields.filter((field) => field.failedSampleCount > 0 || field.missingSampleCount > 0);
const paginatedMid = differentialTestingPaginatedMidPayload();
const serverPage = {
  search: "", filter: "all", sort: "changed", page: 0, pageSize: 25,
  pageCount: Math.max(1, Math.ceil(base.fields.length / 25)), total: base.fields.length,
  fields: base.fields, telemetryFields: base.telemetry?.fields ?? [],
};
const sortedFilteredPage = {
  search: "", filter: "failing", sort: "default", page: 0, pageSize: 25,
  pageCount: Math.max(1, Math.ceil(failingFields.length / 25)), total: failingFields.length,
  fields: failingFields, telemetryFields: base.telemetry?.fields ?? [],
};
const paginatedMidPage = {
  search: "", filter: "all", sort: "changed", page: 1, pageSize: 25, pageCount: 3, total: 60,
  fields: paginatedMid.fields, telemetryFields: paginatedMid.telemetry?.fields ?? [],
};
const pageSeed = (page) => ({ "field-view": {
  page: page.page, pageSize: page.pageSize, pageCount: page.pageCount, total: page.total,
} });
const loadError = new Error("network unreachable");

const states = [
  { name: "dt-load-error", initialAction: { type: "payloadRejected", error: loadError, generation: 0 } },
  { name: "dt-empty", payload: differentialTestingEmptyPayload },
  { name: "dt-main", payload: differentialTestingPayload },
  { name: "dt-scenario-multi", payload: differentialTestingMultiScenarioPayload },
  { name: "dt-row-expanded", payload: differentialTestingPayload, initialAction: { type: "toggleExpanded", key: "position" } },
  { name: "dt-progress-mode", payload: differentialTestingPayload, controls: { "progress-mode": "progress" } },
  { name: "dt-chart-current-failed", payload: differentialTestingPayload, controls: { "value-mode": "current", "progress-mode": "failed" } },
  { name: "dt-no-match", payload: differentialTestingAllPassingPayload, controls: { "failed-filter": true } },
  { name: "dt-paginated", payload: differentialTestingPaginatedPayload },
  { name: "dt-telemetry-incomparable", payload: differentialTestingIncomparableTelemetryPayload },
  { name: "dt-comparable-telemetry", payload: differentialTestingComparableTelemetryPayload },
  { name: "dt-comparable-no-changed", payload: differentialTestingComparableNoChangedPayload },
  {
    name: "dt-server-paged",
    payload: () => differentialPagedPayload(base, serverPage),
    controls: { "failed-filter": false, "changed-sort": true },
    pages: pageSeed(serverPage),
  },
  {
    name: "dt-sorted-filtered-paged",
    payload: () => differentialPagedPayload(base, { ...sortedFilteredPage, fields: base.fields }),
    controls: { "failed-filter": true, "changed-sort": false },
    pages: pageSeed(sortedFilteredPage),
  },
  {
    name: "dt-paginated-mid",
    payload: () => differentialPagedPayload(paginatedMid, paginatedMidPage),
    controls: { "failed-filter": false, "changed-sort": true },
    pages: pageSeed(paginatedMidPage),
  },
];

function deterministicRender(render) {
  const previousTz = process.env.TZ;
  const previousDateNow = Date.now;
  const OriginalDTF = Intl.DateTimeFormat;
  const Shim = function DateTimeFormat(locales, options) {
    return new OriginalDTF(locales == null ? "en-US" : locales, { timeZone: "UTC", ...(options || {}) });
  };
  Shim.prototype = OriginalDTF.prototype;
  Object.setPrototypeOf(Shim, OriginalDTF);
  process.env.TZ = "UTC";
  Date.now = () => FIXED_NOW;
  globalThis.Intl.DateTimeFormat = Shim;
  try {
    return render();
  } finally {
    globalThis.Intl.DateTimeFormat = OriginalDTF;
    Date.now = previousDateNow;
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
}

test("DT oven equals the frozen normalized DOM states", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".dt-oven-dom-golden-test-"));
  try {
    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    const adapterOutput = join(outputDir, "differential-testing-adapter.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [runtimePath], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [adapterPath], bundle: true, format: "esm", outfile: adapterOutput, platform: "node", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const cacheKey = `?test=${Date.now()}`;
    const [{ OvenRuntime }, { adaptDifferentialTesting }, { domEquivalent, normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${pathToFileURL(runtimeOutput).href}${cacheKey}`),
      import(`${pathToFileURL(adapterOutput).href}${cacheKey}`),
      import(`${pathToFileURL(normalizerOutput).href}${cacheKey}`),
    ]);
    const source = await readFile("ovens/differential-testing/differential-testing.oven", "utf8");
    const compiled = compileOven(source, { file: "ovens/differential-testing/differential-testing.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;
    const committedIr = JSON.parse(await readFile("ovens/differential-testing/differential-testing.ir.json", "utf8"));
    assert.deepEqual(committedIr, compiled.ir);

    for (const state of states) {
      const markup = deterministicRender(() => renderToStaticMarkup(createElement(OvenRuntime, {
        ir: compiled.ir,
        payload: state.payload ? adaptDifferentialTesting(state.payload()) : undefined,
        controls: state.controls,
        pages: state.pages,
        initialAction: state.initialAction,
      })));
      const actual = serializeCanonical(normalize(parseHtml(markup)));
      const golden = await readFile(`ovens/differential-testing/renderer/goldens/${state.name}.html`, "utf8");
      const expected = serializeCanonical(normalize(parseHtml(golden)));
      const comparison = domEquivalent(markup, golden);
      assert.equal(comparison.equal, true, `${state.name}: ${comparison.message}`);
      assert.equal(actual, expected, `${state.name} differs`);
    }
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
