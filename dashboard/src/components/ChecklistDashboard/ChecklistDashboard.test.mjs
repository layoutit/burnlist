import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./ChecklistDashboard.tsx", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;

test("checklist detail renders the split progress surface and event card list", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-dashboard-test-"));
  try {
    const outputPath = join(outputDir, "ChecklistDashboard.mjs");
    await build({
      entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
      alias: { "@lib": libPath }, jsx: "automatic", packages: "external", target: "node18",
    });
    const { ChecklistDashboard, checklistEventDetailFields } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    const data = {
      generatedAt: "2026-07-15T12:00:00Z", repoKey: "fixture", repo: "fixture", planLabel: "active.md", title: "Fixture Burnlist",
      total: 2, done: 2, remaining: 0, percent: 100, warnings: [], active: [],
      completed: [
        { id: "B1", title: "First event", completedAt: "2026-07-15T11:40:00Z", detail: "First proof." },
        { id: "B2", title: "Second event", completedAt: "2026-07-15T11:50:00Z", detail: "Completed: 2026-07-15T11:50:00Z\nChanged:\n- src/second.mjs\nProof:\n- node --test second.test.mjs\nOutcome:\n- Second proof.\nFollow-up:\n- None." },
      ],
      history: [
        { time: "2026-07-15T11:40:00Z", done: 1, remaining: 1, total: 2, percent: 50 },
        { time: "2026-07-15T11:50:00Z", done: 2, remaining: 0, total: 2, percent: 100 },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ChecklistDashboard, { data }));

    assert.match(markup, /aria-label="Burnlist progress KPIs"/u);
    assert.match(markup, /class="driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current"/u);
    assert.match(markup, /<div class="driving-parity-kpi-heading">Current<\/div><div class="driving-parity-kpi-ratio">Complete<\/div>/u);
    assert.match(markup, /class="driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress"/u);
    assert.match(markup, /<div class="driving-parity-kpi-ratio"><span class="pass">2<\/span><span class="separator">·<\/span><span class="total">2<\/span> <span class="pass">\(100%\)<\/span><\/div>/u);
    assert.match(markup, /<div class="driving-parity-kpi-heading">Elapsed<\/div>/u);
    assert.match(markup, /<div class="driving-parity-kpi-heading">Avg pace<\/div>/u);
    assert.match(markup, /<div class="driving-parity-kpi-heading">Time left<\/div>/u);
    assert.match(markup, /class="driving-parity-kpi-gauge driving-parity-kpi-progress-donut" viewBox="0 0 58 58"/u);
    assert.match(markup, /class="driving-parity-kpi-progress-donut-segment"[^>]+stroke-dasharray="100\.000 0\.000"/u);
    assert.match(markup, /aria-label="Remaining items over time"/u);
    assert.doesNotMatch(markup, /aria-label="Burnlist progress chart view"/u);
    assert.match(markup, /<span>Age<\/span><span>Event<\/span><span>Result<\/span><span>Delta<\/span><span>Done<\/span>/u);
    assert.match(markup, /class="event-card-list"/u);
    assert.equal((markup.match(/data-event-card="true"/gu) ?? []).length, 2);
    assert.equal(markup.indexOf("Second event") < markup.indexOf("First event"), true);
    assert.match(markup, /First proof\./u);
    assert.match(markup, /Second proof\./u);
    assert.equal((markup.match(/class="event-card-field-label">Outcome/gu) ?? []).length, 2);
    assert.match(markup, /aria-expanded="false"/u);
    assert.doesNotMatch(markup, /src\/second\.mjs/u);
    assert.doesNotMatch(markup, /node --test second\.test\.mjs/u);
    assert.doesNotMatch(markup, /Follow-up/u);
    assert.deepEqual(checklistEventDetailFields(data.completed[1].detail), [
      { label: "Completed", values: ["2026-07-15T11:50:00Z"] },
      { label: "Changed", values: ["src/second.mjs"] },
      { label: "Proof", values: ["node --test second.test.mjs"] },
      { label: "Outcome", values: ["Second proof."] },
      { label: "Follow-up", values: ["None."] },
    ]);
    assert.doesNotMatch(markup, /Completed: 2026/u);
    assert.doesNotMatch(markup, />DONE</u);
    assert.doesNotMatch(markup, /<button[^>]*>Changes<\/button>/u);
    assert.doesNotMatch(markup, /Burnlist detail view/u);
    assert.doesNotMatch(markup, /Repo Graph/u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
