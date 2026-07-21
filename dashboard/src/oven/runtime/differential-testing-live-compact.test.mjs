import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
const ovenComponentPath = new URL("../../components/DifferentialTestingOven/DifferentialTestingOven.tsx", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
const generatedIrPlugin = {
  name: "generated-oven-ir",
  setup(esbuild) {
    esbuild.onResolve({ filter: /\.ir\.json$/ }, (args) => ({ path: args.path, namespace: "generated-oven-ir" }));
    esbuild.onLoad({ filter: /.*/, namespace: "generated-oven-ir" }, () => ({ contents: "export default {};", loader: "js" }));
  },
};

test("DT live compact envelope preserves field rows and server paging", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".dt-live-compact-test-"));
  try {
    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    const ovenComponentOutput = join(outputDir, "DifferentialTestingOven.mjs");
    await Promise.all([
      build({ entryPoints: [runtimePath], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [ovenComponentPath], bundle: true, format: "esm", outfile: ovenComponentOutput, platform: "node", alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", plugins: [generatedIrPlugin], target: "node18" }),
    ]);
    const cacheKey = `?test=${Date.now()}`;
    const [{ OvenRuntime }, { dtAdapt }] = await Promise.all([
      import(`${pathToFileURL(runtimeOutput).href}${cacheKey}`),
      import(`${pathToFileURL(ovenComponentOutput).href}${cacheKey}`),
    ]);

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
    const firstTwentyFive = fixture.fields.slice(0, 25);
    const fieldPage = {
      search: "",
      filter: "all",
      sort: "changed",
      page: 0,
      pageSize: 25,
      pageCount: 3,
      total: 60,
      fields: firstTwentyFive,
      telemetryFields: fixture.telemetry?.fields ?? [],
    };
    const envelope = {
      ovenId: "differential-testing",
      path: "/api/oven-data/differential-testing",
      scenarioId: "fixture",
      transport: {
        schema: "burnlist-differential-testing-page@1",
        bundleSha256: "a".repeat(64),
        scenarioSha256: "b".repeat(64),
      },
      fieldPage,
      frameDeltaMetrics: {
        frameDeviationRatios: [0, 0.5],
        firstFailingFrame: 1,
      },
      payload: compactPayload,
    };

    const source = await readFile("ovens/differential-testing/differential-testing.oven", "utf8");
    const compiled = compileOven(source, { file: "ovens/differential-testing/differential-testing.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const markup = withDeterministicTime(() => renderToStaticMarkup(createElement(OvenRuntime, {
      ir: compiled.ir,
      initialAction: { type: "payloadAccepted", payload: dtAdapt(envelope) },
    })));
    const fieldRows = markup.match(/<section class="hybrid-row\b/gu) ?? [];
    assert.equal(fieldRows.length, 25, "live compact envelopes must render all 25 fields from fieldPage");
    assert.doesNotMatch(markup, /No fields/u);
    assert.match(markup, /1-25 \/ 60/u, "live compact envelopes must preserve the server page total");
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
