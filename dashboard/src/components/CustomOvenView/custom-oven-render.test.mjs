import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  <loop-graph source="/loopRun"/>
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
    const { burnlistOvenPayload, CustomOvenRuntime } = await import(`${new URL(`file://${runtimeOutput}`).href}?test=${Date.now()}`);
    const compiled = compileOven(ovenSource, { file: "widget-oven.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const payload = {
      widget: { name: "Sprockets", count: 42 },
      loopRun: {
        loopId: "review", state: "running", currentNode: "verify", attempt: 1, cycle: 0,
        graph: { entry: "implement", nodes: [{ id: "implement", kind: "agent" }, { id: "verify", kind: "check" }], edges: [{ from: "implement", on: "complete", to: "verify" }] },
        transitions: [{ sequence: 1, from: "implement", outcome: "complete", to: "verify" }],
      },
    };
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
    assert.match(renderToStaticMarkup(burnlist), /aria-current="step"/u);
    assert.match(renderToStaticMarkup(burnlist), /VERIFY/u);

    const loopProgressSource = await readFile(new URL("../../../../ovens/loop-progress/loop-progress.oven", import.meta.url), "utf8");
    const loopProgress = compileOven(loopProgressSource, { file: "loop-progress.oven" });
    assert.equal(loopProgress.ok, true, loopProgress.ok ? "" : JSON.stringify(loopProgress.diagnostics));
    if (!loopProgress.ok) return;
    const progress = {
      generatedAt: "2026-07-24T20:00:00Z", repoKey: "028543435173", title: "Host Loop",
      repo: "burnlist", planLabel: "inprogress", selectedItemId: "O0",
      total: 1, done: 0, remaining: 1, percent: 0, warnings: [], completed: [], history: [],
      active: [{ id: "O0", title: "Seed the Loop Progress Oven", fields: {
        Action: "Show the current work simply.",
        "Files/search": "ovens/ dashboard/src/oven/",
      }, loop: null }],
      loopRun: null,
    };
    const canonicalPayload = burnlistOvenPayload(progress);
    const page = CustomOvenRuntime({ burnlistId: "260724-002", ir: loopProgress.ir, payload: canonicalPayload });
    const pageRuntime = page.props.children[1];
    assert.equal(pageRuntime.props.payload.raw, progress);
    assert.equal(pageRuntime.props.ir.refreshSeconds, undefined);
    const pageMarkup = renderToStaticMarkup(page);
    assert.match(pageMarkup, /Seed the Loop Progress Oven/u);
    assert.match(pageMarkup, /Makes truthful progress easy to see/u);
    assert.match(pageMarkup, /SYSTEM FLOW/u);
    assert.match(pageMarkup, /Plan/u);
    assert.match(pageMarkup, /Loop control/u);
    assert.match(pageMarkup, /Agent \+ workspace/u);
    assert.match(pageMarkup, /Validate \+ review/u);
    assert.match(pageMarkup, /ovens\/ dashboard\/src\/oven\//u);
    assert.match(pageMarkup, /HOOKS/u);
    assert.match(pageMarkup, /Unavailable/u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
