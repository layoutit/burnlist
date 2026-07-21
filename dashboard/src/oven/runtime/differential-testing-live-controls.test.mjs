import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { differentialTestingPaginatedPayload } from "../differential-testing-render/golden-harness.mjs";
import { withDeterministicTime } from "../test-support/deterministic-time.mjs";

const runtimePath = new URL("./OvenRuntime.tsx", import.meta.url).pathname;
const reducerPath = new URL("./oven-reducer.ts", import.meta.url).pathname;
const selectorsPath = new URL("./oven-selectors.ts", import.meta.url).pathname;
const liveDataPath = new URL("./oven-live-data.ts", import.meta.url).pathname;
const pointerPath = new URL("../utils/json-pointer.ts", import.meta.url).pathname;
const ovenComponentPath = new URL("../../components/DifferentialTestingOven/DifferentialTestingOven.tsx", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const generatedIrPlugin = {
  name: "generated-oven-ir",
  setup(esbuild) {
    esbuild.onResolve({ filter: /\.ir\.json$/ }, (args) => ({ path: args.path, namespace: "generated-oven-ir" }));
    esbuild.onLoad({ filter: /.*/, namespace: "generated-oven-ir" }, () => ({ contents: "export default {};", loader: "js" }));
  },
};

function markupFor(OvenRuntime, ir, dtAdapt, envelope) {
  return withDeterministicTime(() => renderToStaticMarkup(createElement(OvenRuntime, {
    ir,
    initialAction: { type: "payloadAccepted", payload: dtAdapt(envelope) },
  })));
}

function assertRenderedPage(markup, rows, status) {
  assert.equal(markup.match(/<section class="hybrid-row\b/gu)?.length ?? 0, rows);
  assert.match(markup, new RegExp(status.replace("/", "\\/"), "u"));
}

test("DT compact live controls derive server queries and replace field pages", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".dt-live-controls-test-"));
  try {
    const seamEntry = join(outputDir, "runtime-seam.ts");
    const seamEntryTemp = `${seamEntry}.tmp`;
    await writeFile(seamEntryTemp, [
      `export { initOvenState, ovenReducer } from ${JSON.stringify(reducerPath)};`,
      `export { selectCollection } from ${JSON.stringify(selectorsPath)};`,
      `export { createOvenPoller } from ${JSON.stringify(liveDataPath)};`,
      `export * from ${JSON.stringify(liveDataPath)};`,
      `export { resolvePointer } from ${JSON.stringify(pointerPath)};`,
    ].join("\n"));
    await rename(seamEntryTemp, seamEntry);

    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    const ovenComponentOutput = join(outputDir, "DifferentialTestingOven.mjs");
    const seamOutput = join(outputDir, "runtime-seam.mjs");
    const aliases = { "@": sourceDir, "@lib": libPath, "@oven": ovenPath };
    await Promise.all([
      build({ entryPoints: [runtimePath], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: aliases, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [ovenComponentPath], bundle: true, format: "esm", outfile: ovenComponentOutput, platform: "node", alias: aliases, jsx: "automatic", packages: "external", plugins: [generatedIrPlugin], target: "node18" }),
      build({ entryPoints: [seamEntry], bundle: true, format: "esm", outfile: seamOutput, platform: "node", alias: aliases, packages: "external", target: "node18" }),
    ]);
    const cacheKey = `?test=${Date.now()}`;
    const [{ OvenRuntime }, { dtAdapt }, seam] = await Promise.all([
      import(`${pathToFileURL(runtimeOutput).href}${cacheKey}`),
      import(`${pathToFileURL(ovenComponentOutput).href}${cacheKey}`),
      import(`${pathToFileURL(seamOutput).href}${cacheKey}`),
    ]);
    const { createOvenPoller, initOvenState, ovenPollSearch, ovenReducer, resolvePointer, selectCollection } = seam;

    const source = await readFile("ovens/differential-testing/differential-testing.oven", "utf8");
    const compiled = compileOven(source, { file: "ovens/differential-testing/differential-testing.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;
    const ir = compiled.ir;

    const fixture = differentialTestingPaginatedPayload();
    const compactPayload = structuredClone(fixture);
    delete compactPayload.fields;
    if (compactPayload.telemetry?.fields) delete compactPayload.telemetry.fields;
    compactPayload.summary.fields = {
      label: compactPayload.summary.fields.label,
      total: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
    };
    const telemetryById = new Map((fixture.telemetry?.fields ?? []).map((entry) => [entry.id, entry]));
    const ordinalById = new Map(fixture.fields.map((field, index) => [field.id, index]));
    const nonPass = (field) => Number(field.failedSampleCount ?? 0) + Number(field.missingSampleCount ?? 0) > 0;
    const change = (field) => {
      const telemetry = telemetryById.get(field.id);
      return Number(telemetry?.failToPassCount ?? 0) + Number(telemetry?.passToFailCount ?? 0);
    };
    const improvement = (field) => {
      const telemetry = telemetryById.get(field.id);
      return Number(telemetry?.failToPassCount ?? 0) - Number(telemetry?.passToFailCount ?? 0);
    };
    const requests = [];
    const serverQueries = [];

    function server(query) {
      serverQueries.push({ ...query });
      const { search, filter, sort, page, pageSize } = query;
      const needle = search.trim().toLowerCase();
      let fields = fixture.fields.filter((field) => {
        if (filter === "failing" && !nonPass(field)) return false;
        return !needle || [field.label, field.sourceOwner, field.driftClass, field.semantics?.kind]
          .some((value) => String(value ?? "").toLowerCase().includes(needle));
      });
      if (sort === "changed") {
        fields = fields.slice().sort((left, right) => improvement(right) - improvement(left)
          || change(right) - change(left)
          || ordinalById.get(left.id) - ordinalById.get(right.id));
      }
      const total = fields.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const normalizedPage = Math.min(page, pageCount - 1);
      const selected = fields.slice(normalizedPage * pageSize, normalizedPage * pageSize + pageSize);
      return {
        payload: compactPayload,
        transport: {
          schema: "burnlist-differential-testing-page@1",
          bundleSha256: "a".repeat(64),
          scenarioSha256: "b".repeat(64),
        },
        fieldPage: {
          search,
          filter,
          sort,
          page: normalizedPage,
          pageSize,
          pageCount,
          total,
          fields: selected,
          telemetryFields: selected.map((field) => telemetryById.get(field.id)).filter(Boolean),
        },
        frameDeltaMetrics: { frameDeviationRatios: [0, 0.5], firstFailingFrame: 1 },
      };
    }

    const initialEnvelope = server({ search: "", filter: "all", sort: "changed", page: 0, pageSize: 25 });
    const initialPayload = dtAdapt(initialEnvelope);
    let initialState = initOvenState(ir, undefined);
    initialState = ovenReducer(initialState, { type: "payloadAccepted", payload: initialPayload }, ir);
    const initialMarkup = markupFor(OvenRuntime, ir, dtAdapt, initialEnvelope);
    assertRenderedPage(initialMarkup, 25, "1-25 / 60");
    const initialPage = selectCollection(initialState, ir, "field-view", resolvePointer);
    assert.equal(initialPage.pageItems[0].id, "active");

    const initialSearch = ovenPollSearch({ ir, state: initialState, scenario: undefined });
    const initialParams = new URLSearchParams(initialSearch);
    assert.deepEqual(Object.fromEntries(initialParams), {
      search: "",
      filter: "all",
      sort: "changed",
      page: "0",
      pageSize: "25",
    });

    async function drive(action, fromState = initialState, generationRef = { current: fromState.refresh.generation }) {
      let state = ovenReducer(fromState, action, ir);
      let responseEnvelope;
      const search = ovenPollSearch({ ir, state, scenario: undefined });
      const poller = createOvenPoller({
        id: "differential-testing",
        search,
        adapt: dtAdapt,
        generationRef,
        dispatch(nextAction) { state = ovenReducer(state, nextAction, ir); },
        async fetchImpl(input) {
          requests.push(input);
          const params = new URL(input, "http://localhost").searchParams;
          responseEnvelope = server({
            search: params.get("search") ?? "",
            filter: params.get("filter") ?? "all",
            sort: params.get("sort") ?? "default",
            page: Number(params.get("page") ?? 0),
            pageSize: Number(params.get("pageSize") ?? 25),
          });
          return { ok: true, status: 200, headers: { get: () => 'W/"x"' }, json: async () => responseEnvelope };
        },
      });
      poller.refresh();
      await settle();
      poller.stop();
      assert.ok(responseEnvelope);
      return { state, envelope: responseEnvelope, url: requests.at(-1) };
    }

    function assertParam(url, name, value) {
      assert.equal(new URL(url, "http://localhost").searchParams.get(name), String(value), `${name} must reach the poll URL`);
      assert.equal(serverQueries.at(-1)[name], value, `${name} must reach the fake server`);
    }

    const next = await drive({ type: "pageNext", collectionId: "field-view" });
    assertParam(next.url, "page", 1);
    assertRenderedPage(markupFor(OvenRuntime, ir, dtAdapt, next.envelope), 25, "26-50 / 60");
    assert.equal(selectCollection(next.state, ir, "field-view", resolvePointer).pageIndex, 1);

    const chainedNext = await drive({ type: "pageNext", collectionId: "field-view" }, next.state);
    assertParam(chainedNext.url, "page", 2);
    assertRenderedPage(markupFor(OvenRuntime, ir, dtAdapt, chainedNext.envelope), 10, "51-60 / 60");
    assert.equal(chainedNext.state.refresh.phase, 'idle');
    const chainedPage = selectCollection(chainedNext.state, ir, 'field-view', resolvePointer);
    assert.equal(chainedPage.pageIndex, 2);
    assert.equal(chainedPage.pageItems.length, 10);
    assert.equal(chainedPage.totalCount, 60);

    const resized = await drive({ type: "pageSizeChanged", collectionId: "field-view", pageSize: 50 });
    assertParam(resized.url, "pageSize", 50);
    assertRenderedPage(markupFor(OvenRuntime, ir, dtAdapt, resized.envelope), 50, "1-50 / 60");
    assert.equal(selectCollection(resized.state, ir, "field-view", resolvePointer).pageSize, 50);

    const searched = await drive({ type: "queryChanged", id: "field-search", query: "Field 30" });
    assertParam(searched.url, "search", "Field 30");
    assertRenderedPage(markupFor(OvenRuntime, ir, dtAdapt, searched.envelope), 1, "1-1 / 1");
    const searchPage = selectCollection(searched.state, ir, "field-view", resolvePointer);
    assert.equal(searchPage.pageItems[0].id, "field-30");
    assert.notEqual(searchPage.pageItems[0].id, initialPage.pageItems[0].id);

    const filtered = await drive({ type: "toggleChanged", id: "failed-filter", active: true });
    assertParam(filtered.url, "filter", "failing");
    assertRenderedPage(markupFor(OvenRuntime, ir, dtAdapt, filtered.envelope), 25, "1-25 / 59");
    const filterPage = selectCollection(filtered.state, ir, "field-view", resolvePointer);
    assert.equal(filterPage.pageItems[0].id, "position");
    assert.notEqual(filterPage.pageItems[0].id, initialPage.pageItems[0].id);

    const sorted = await drive({ type: "toggleChanged", id: "changed-sort", active: false });
    assertParam(sorted.url, "sort", "default");
    assertRenderedPage(markupFor(OvenRuntime, ir, dtAdapt, sorted.envelope), 25, "1-25 / 60");
    const sortPage = selectCollection(sorted.state, ir, "field-view", resolvePointer);
    assert.equal(sortPage.pageItems[0].id, "position");
    assert.notEqual(sortPage.pageItems[0].id, initialPage.pageItems[0].id);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
