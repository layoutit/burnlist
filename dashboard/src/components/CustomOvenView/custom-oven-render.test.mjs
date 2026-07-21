import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";

const runtimePath = new URL("../../oven/runtime/OvenRuntime.tsx", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const ovenSource = `<oven id="widget-oven" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <kpi-strip>
    <kpi-item variant="current" heading="Widget" title="/widget/name" value="/widget/count"/>
  </kpi-strip>
</oven>`;

test("a custom Oven runtime renders author-shaped data values", { timeout: 20_000 }, async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".custom-oven-render-test-"));
  try {
    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    await build({
      entryPoints: [runtimePath],
      bundle: true,
      format: "esm",
      outfile: runtimeOutput,
      platform: "node",
      alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic",
      packages: "external",
      target: "node18",
    });
    const { OvenRuntime } = await import(`${new URL(`file://${runtimeOutput}`).href}?test=${Date.now()}`);
    const compiled = compileOven(ovenSource, { file: "widget-oven.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const markup = renderToStaticMarkup(createElement(OvenRuntime, {
      ir: compiled.ir,
      payload: { widget: { name: "Sprockets", count: 42 } },
    }));
    assert.match(markup, /Sprockets/u);
    assert.match(markup, />42</u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
