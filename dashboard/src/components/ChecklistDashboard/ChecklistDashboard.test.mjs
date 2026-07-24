import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { checklistFixture as data } from "./ChecklistDashboard.fixture.mjs";
import { runM4ProgressFixture } from "../../../../src/loops/run/run-test-fixtures.mjs";

const componentPath = new URL("./ChecklistDashboard.tsx", import.meta.url).pathname;
const stylesheetPath = new URL("./ChecklistDashboard.css", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;

test("checklist progress owns its workspace height instead of inheriting the differential default", async () => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  assert.match(stylesheet, /body\.checklist-detail-view \.shell\.checklist-detail-shell #burnlist-detail \.checklist-overview:not\(\[hidden\]\) \+ \.checklist-progress-workspace \{\s+height: 232px;\s+min-height: 232px;\s+max-height: 232px;/u);
});

test("checklist detail renders the split progress surface and event card list", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-dashboard-test-"));
  let repoRoot;
  try {
    repoRoot = await mkdtemp(join(process.cwd(), ".m5-loop-ui-"));
    const outputPath = join(outputDir, "ChecklistDashboard.mjs");
    await build({
      entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
      alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18",
    });
    const { ChecklistDashboard, LoopRunPanel } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    const markup = renderToStaticMarkup(createElement(ChecklistDashboard, { data }));
    assert.equal(markup, renderToStaticMarkup(createElement(ChecklistDashboard, { data: { ...data, loopRun: null } })));

    assert.match(markup, /aria-label="Burnlist progress KPIs"/u);
    assert.doesNotMatch(markup, /class="panel checklist-current"/u);
    assert.match(markup, /class="driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress"/u);
    assert.match(markup, /<div class="driving-parity-kpi-ratio"><span class="pass">2<\/span><span class="separator">·<\/span><span class="total">2<\/span> <span class="pass">\(100%\)<\/span><\/div>/u);
    assert.match(markup, /<div class="driving-parity-kpi-heading">Elapsed<\/div>/u);
    assert.match(markup, /<div class="driving-parity-kpi-heading">Avg pace<\/div>/u);
    assert.match(markup, /<div class="driving-parity-kpi-heading">Time left<\/div>/u);
    assert.match(markup, /class="driving-parity-kpi-gauge driving-parity-kpi-progress-donut" viewBox="0 0 58 58"/u);
    assert.match(markup, /class="driving-parity-kpi-progress-donut-segment"[^>]+stroke-dasharray="100\.000 0\.000"/u);
    assert.match(markup, /aria-label="Completion percentage over time"/u);
    assert.match(markup, /<span class="burn-chart-label">Completion<\/span>/u);
    assert.doesNotMatch(markup, /aria-label="Burnlist progress chart view"/u);
    assert.match(markup, /<span>Age<\/span><span>Event<\/span><span>Result<\/span><span>Delta<\/span><span>Done<\/span>/u);
    assert.match(markup, /class="checklist-workspace"/u);
    assert.match(markup, /aria-label="Completed events"/u);
    assert.match(markup, /aria-label="Remaining items"/u);
    assert.match(markup, /class="checklist-workspace__empty">No active item/u);
    assert.equal((markup.match(/class="checklist-workspace__event"/gu) ?? []).length, 2);
    assert.equal(markup.indexOf("Second event") < markup.indexOf("First event"), true);
    assert.doesNotMatch(markup, /data-event-card="true"/u);
    assert.doesNotMatch(markup, /Completed: 2026/u);
    assert.doesNotMatch(markup, />DONE</u);
    assert.doesNotMatch(markup, /<button[^>]*>Changes<\/button>/u);
    assert.doesNotMatch(markup, /Burnlist detail view/u);
    assert.doesNotMatch(markup, /Repo Graph/u);

    const { snapshots } = await runM4ProgressFixture({
      repoRoot,
      outcomes: ["complete", "pass", "reject", "complete", "pass", "approve"],
    });
    for (const projection of snapshots) {
      const stage = renderToStaticMarkup(createElement(LoopRunPanel, { data: { ...data, loopRun: projection } }));
      assert.match(stage, new RegExp(`ACTIVE: ${projection.currentNode.toUpperCase()}`, "u"));
      assert.match(stage, /IMPLEMENT/u);
      assert.match(stage, /VERIFY/u);
      assert.match(stage, /aria-current="step"/u);
      if (projection.currentNode === "implement" && projection.attempt === 2) assert.match(stage, /reject/u);
      if (projection.currentNode === "converged") assert.match(stage, /approve/u);
      if (projection.currentNode === "completed") assert.match(stage, /COMPLETED/u);
    }
    const evidence = renderToStaticMarkup(createElement(LoopRunPanel, { data: {
      ...data,
      loopRun: {
        ...snapshots.at(-1),
        latestMaker: { summary: "candidate prepared", at: Date.parse("2026-07-15T11:40:00Z"), candidateId: "candidate-1" },
        latestCheck: { summary: "verify passed", at: Date.parse("2026-07-15T11:45:00Z"), candidateId: "candidate-1" },
        latestReviewer: { summary: "approved", at: Date.parse("2026-07-15T11:50:00Z"), candidateId: "candidate-1" },
      },
    } }));
    assert.match(evidence, /ACTIVE: COMPLETED/u);
    assert.match(evidence, /aria-label="Loop state: Converged"/u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
    if (repoRoot) await rm(repoRoot, { force: true, recursive: true });
  }
});

test("Loop panel exposes every terminal and observer diagnostic state accessibly", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".m7-loop-state-ui-"));
  const repoRoot = await mkdtemp(join(process.cwd(), ".m7-loop-state-run-"));
  try {
    const outputPath = join(outputDir, "ChecklistDashboard.mjs");
    await build({ entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node", alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" });
    const { LoopRunPanel } = await import(`${new URL(`file://${outputPath}`).href}?states=${Date.now()}`);
    const { final } = await runM4ProgressFixture({ repoRoot, outcomes: ["complete", "pass", "reject", "complete", "pass", "approve"] });
    const labels = { paused: "Paused", failed: "Failed", stopped: "Stopped", "needs-human": "Needs human review", "budget-exhausted": "Budget exhausted", converged: "Converged", completed: "Completed", corrupt: "Corrupt projection", stale: "Stale projection" };
    for (const [state, label] of Object.entries(labels)) {
      const projection = { ...final, state };
      const markup = renderToStaticMarkup(createElement(LoopRunPanel, { data: { ...data, loopRun: state === "stale" ? { ...projection, diagnostic: "stale" } : projection } }));
      assert.match(markup, new RegExp(`aria-label="Loop state: ${label}"`, "u"));
    }
  } finally {
    await rm(outputDir, { force: true, recursive: true });
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("Loop panel exposes a real unreachable-projection diagnostic without fabricating a Run", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".m12-loop-diagnostic-"));
  try {
    const outputPath = join(outputDir, "ChecklistDashboard.mjs");
    await build({ entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node", alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" });
    const { LoopRunPanel } = await import(`${new URL(`file://${outputPath}`).href}?diagnostic=${Date.now()}`);
    const markup = renderToStaticMarkup(createElement(LoopRunPanel, { data: {
      ...data, loopProjectionDiagnostic: "corrupt", loopProjectionMessage: "Loop projection is unavailable; retaining the last verified projection.", loopRun: null,
    } }));
    assert.match(markup, /aria-label="Loop run diagnostic"/u);
    assert.match(markup, /role="alert"/u);
    assert.match(markup, /Corrupt projection/u);
    assert.doesNotMatch(markup, /Current<\/strong>/u);
  } finally { await rm(outputDir, { force: true, recursive: true }); }
});
