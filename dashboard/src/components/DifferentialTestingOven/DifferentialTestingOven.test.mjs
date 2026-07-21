import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";

const componentPath = new URL("./DifferentialTestingOven.tsx", import.meta.url).pathname;
const sourcePath = new URL("../..", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const ovenIrPlugin = {
  name: "test-oven-ir",
  setup(context) {
    context.onResolve({ filter: /\.ir\.json$/ }, (args) => ({ namespace: "test-oven-ir", path: resolve(dirname(args.importer), args.path) }));
    context.onLoad({ filter: /\.ir\.json$/, namespace: "test-oven-ir" }, async (args) => {
      const sourcePath = args.path.replace(/\.ir\.json$/u, ".oven");
      const compiled = compileOven(await readFile(sourcePath, "utf8"), { file: sourcePath });
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      return { contents: JSON.stringify(compiled.ir), loader: "json" };
    });
  },
};

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
      plugins: [ovenIrPlugin],
      target: "node18",
    });
    const { DifferentialTestingOvenPage, PerformanceTracingOvenPage } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    const differential = renderToStaticMarkup(createElement(DifferentialTestingOvenPage));
    const performance = renderToStaticMarkup(createElement(PerformanceTracingOvenPage));

    assert.match(differential, /^<div class="shell driving-parity-view"><div class="empty">Loading…<\/div><\/div>$/u);
    assert.match(performance, /^<div class="shell driving-parity-view performance-tracing-oven"><div class="empty">Loading…<\/div><\/div>$/u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
