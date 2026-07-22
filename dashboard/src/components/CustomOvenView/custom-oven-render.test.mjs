import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";

const componentPath = new URL("./CustomOvenView.tsx", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const ovenSource = `<oven id="widget-oven" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <kpi-strip>
    <kpi-item variant="current" heading="Widget" title="/widget/name" value="/widget/count"/>
  </kpi-strip>
</oven>`;

test("custom Oven runtime modes use canonical live snapshots and controlled Burnlist data", { timeout: 20_000 }, async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".custom-oven-render-test-"));
  try {
    const runtimeOutput = join(outputDir, "CustomOvenView.mjs");
    await build({
      entryPoints: [componentPath],
      bundle: true,
      format: "esm",
      outfile: runtimeOutput,
      platform: "node",
      alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic",
      packages: "external",
      target: "node18",
    });
    const { CustomOvenRuntime } = await import(`${new URL(`file://${runtimeOutput}`).href}?test=${Date.now()}`);
    const compiled = compileOven(ovenSource, { file: "widget-oven.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const payload = { widget: { name: "Sprockets", count: 42 } };
    const ir = { ...compiled.ir, refreshSeconds: 7 };
    const standalone = CustomOvenRuntime({ ir });
    assert.equal(standalone.props.ir, ir);
    assert.equal("initialPayload" in standalone.props, false);
    assert.equal("payload" in standalone.props, false);
    assert.equal(standalone.props.ir.refreshSeconds, 7);
    assert.equal(typeof standalone.props.adapt, "function");

    assert.match(renderToStaticMarkup(standalone), /Loading Oven data/u);

    const burnlist = CustomOvenRuntime({ burnlistId: "260722-001", ir, payload });
    const controlled = burnlist.props.children[1];
    assert.equal(controlled.props.payload, payload);
    assert.equal("initialPayload" in controlled.props, false);
    assert.equal(controlled.props.ir.refreshSeconds, undefined);
    assert.equal(controlled.props.adapt, undefined);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
