import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";

const componentPath = new URL("./DifferentialTestingOven.tsx", import.meta.url).pathname;
const sourcePath = new URL("../..", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
async function ovenIr(id) {
  const path = new URL(`../../../../ovens/${id}/${id}.oven`, import.meta.url);
  const compiled = compileOven(await readFile(path, "utf8"), { file: path.pathname });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.ir;
}

test("live Differential Testing pages retain the scoped shell required by their dashboard CSS", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".differential-testing-oven-test-"));
  try {
    const outputPath = join(outputDir, "DifferentialTestingOven.mjs");
    await build({
      entryPoints: [componentPath],
      bundle: true,
      format: "esm",
      outfile: outputPath,
      platform: "node",
      alias: { "@": sourcePath, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic",
      packages: "external",
      target: "node18",
    });
    const { DifferentialTestingOvenPage, PerformanceTracingOvenPage } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    const differential = renderToStaticMarkup(createElement(DifferentialTestingOvenPage, { ir: await ovenIr("differential-testing") }));
    const performance = renderToStaticMarkup(createElement(PerformanceTracingOvenPage, { ir: await ovenIr("performance-tracing") }));

    assert.match(differential, /^<div class="shell driving-parity-view"><div class="empty">Loading…<\/div><\/div>$/u);
    assert.match(performance, /^<div class="shell driving-parity-view performance-tracing-oven"><div class="empty">Loading…<\/div><\/div>$/u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
