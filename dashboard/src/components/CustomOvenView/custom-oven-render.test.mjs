import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";

const componentPath = new URL("./CustomOvenView.tsx", import.meta.url).pathname;
const appHeaderPath = new URL("../AppHeader/AppHeader.tsx", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const ovenSource = `<oven id="deploy-status" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <section-header title="Deploy status"/>
  <kpi-strip>
    <kpi-item heading="Service" source="/service"/>
    <kpi-item heading="Healthy" source="/healthyPct" format="percent"/>
    <kpi-item heading="Last deploy" source="/deployedAt" format="relative-age"/>
  </kpi-strip>
  <log-table source="/events"><column label="Event" source="@item"/></log-table>
  <loop-graph source="/loopRun"/>
</oven>`;

test("custom Oven runtime modes use canonical live snapshots and controlled Burnlist data", { timeout: 20_000 }, async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".custom-oven-render-test-"));
  try {
    const runtimeOutput = join(outputDir, "CustomOvenView.mjs");
    const headerOutput = join(outputDir, "AppHeader.mjs");
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
    await build({
      entryPoints: [appHeaderPath],
      bundle: true,
      format: "esm",
      outfile: headerOutput,
      platform: "node",
      alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic",
      packages: "external",
      target: "node18",
    });
    const { burnlistOvenPayload, CustomOvenRuntime, CustomOvenView } = await import(`${new URL(`file://${runtimeOutput}`).href}?test=${Date.now()}`);
    const { AppHeader } = await import(`${new URL(`file://${headerOutput}`).href}?test=${Date.now()}`);
    const compiled = compileOven(ovenSource, { file: "deploy-status.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const payload = {
      service: "checkout-api",
      healthyPct: 0.96,
      deployedAt: "2026-07-20T09:00:00Z",
      events: ["Deploy started", "Health checks passed", "Traffic shifted"],
      widget: { name: "Sprockets", count: 42 },
      loopRun: {
        loopId: "review", state: "running", currentNode: "verify", attempt: 1, cycle: 0,
        graph: { entry: "implement", nodes: [{ id: "implement", kind: "agent" }, { id: "verify", kind: "check" }], edges: [{ from: "implement", on: "complete", to: "verify" }] },
        transitions: [{ sequence: 1, from: "implement", outcome: "complete", to: "verify" }],
      },
    };
    const ir = { ...compiled.ir, refreshSeconds: 7 };
    const standalone = CustomOvenRuntime({ ir });
    const standaloneRuntime = standalone.props.children[1];
    assert.equal(standalone.props.className, "custom-oven-view");
    assert.equal(standalone.props["data-oven-id"], "deploy-status");
    assert.equal(standaloneRuntime.props.ir, ir);
    assert.equal("initialPayload" in standaloneRuntime.props, false);
    assert.equal("payload" in standaloneRuntime.props, false);
    assert.equal(standaloneRuntime.props.ir.refreshSeconds, 7);
    assert.equal(typeof standaloneRuntime.props.adapt, "function");

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
    assert.match(pageMarkup, /No agent is working on this item yet/u);
    assert.match(pageMarkup, /ASSIGNED LOOP/u);
    assert.match(pageMarkup, /Direct work/u);
    assert.doesNotMatch(pageMarkup, /RIGHT NOW/u);
    assert.doesNotMatch(pageMarkup, /More details/u);
    assert.doesNotMatch(pageMarkup, /ovens\/ dashboard\/src\/oven\//u);
    assert.doesNotMatch(pageMarkup, /HOOKS|Unavailable/u);

    const previousWindow = globalThis.window;
    globalThis.window = { location: { pathname: "/r/repo/260722-001/o/deploy-status", search: "" } };
    const loadingView = CustomOvenView({ error: "", loading: true, progress: null, stale: false });
    assert.equal(loadingView.props.className, "custom-oven-view");
    assert.match(renderToStaticMarkup(loadingView), /Loading Oven/u);
    const errorView = CustomOvenView({ error: "Canonical Burnlist unavailable.", loading: false, progress: null, stale: false });
    assert.equal(errorView.props.className, "custom-oven-view");
    assert.match(renderToStaticMarkup(errorView), /Canonical Burnlist unavailable\./u);

    const staleView = CustomOvenView({ error: "", loading: true, progress: { raw: {} }, stale: true });
    assert.match(renderToStaticMarkup(staleView), /Showing the last canonical Burnlist snapshot/u);

    globalThis.window = { location: { pathname: "/r/repo/o/deploy-status", search: "" } };
    const definitionView = CustomOvenView({ error: "", loading: false, progress: null, stale: false });
    assert.equal(definitionView.props.className, "custom-oven-view");
    assert.equal(definitionView.props["data-oven-id"], "deploy-status");

    globalThis.window = { location: { pathname: "/r/repo/260722-001/o/deploy-status", search: "" } };
    let settledMarkup;
    try {
      settledMarkup = renderToStaticMarkup(burnlist);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
    assert.match(settledMarkup, /class="custom-oven-view"/u);
    assert.match(settledMarkup, /<h2>Deploy status<\/h2>/u);
    assert.doesNotMatch(settledMarkup, /Deploy status \(\)/u);
    assert.equal((settledMarkup.match(/is-visual-free/gu) ?? []).length, 3);
    assert.match(settledMarkup, /checkout-api/u);
    assert.match(settledMarkup, /96\.00%/u);
    assert.match(settledMarkup, /Health checks passed/u);

    globalThis.window = { location: { pathname: "/r/repo/260722-001/o/deploy-status", search: "" } };
    let emptyMarkup;
    try {
      emptyMarkup = renderToStaticMarkup(CustomOvenRuntime({
        burnlistId: "260722-001",
        ir,
        payload: { service: null, healthyPct: null, deployedAt: null, events: [] },
      }));
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
    assert.equal((emptyMarkup.match(/aria-label="No value"/gu) ?? []).length, 3);
    assert.match(emptyMarkup, /class="oven-log-empty" role="status">No entries yet\./u);

    const headerMarkup = renderToStaticMarkup(AppHeader({ detail: null, ovenId: "deploy-status", section: "custom-oven" }));
    assert.match(headerMarkup, /dashboard-oven-title[^>]*title="deploy-status"[^>]*>deploy-status</u);
    assert.doesNotMatch(headerMarkup, /New Oven/u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
