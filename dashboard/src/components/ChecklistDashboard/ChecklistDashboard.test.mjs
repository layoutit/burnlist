import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { checklistFixture as data } from "./ChecklistDashboard.fixture.mjs";

const componentPath = new URL("./ChecklistDashboard.tsx", import.meta.url).pathname;
const stylesheetPath = new URL("./ChecklistDashboard.css", import.meta.url).pathname;
const indexStylesheetPath = new URL("../../index.css", import.meta.url).pathname;
const appPath = new URL("../../App.tsx", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;

test("checklist progress owns its workspace height instead of inheriting the differential default", async () => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  assert.match(stylesheet, /body\.checklist-detail-view \.shell\.checklist-detail-shell #burnlist-detail \.checklist-overview:not\(\[hidden\]\) \+ \.checklist-progress-workspace \{\s+height: 232px;\s+min-height: 232px;\s+max-height: 232px;/u);
});

test("checklist progress stacks into one full-width column at narrow widths", async () => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  const responsiveBlock = stylesheet.slice(stylesheet.indexOf("@media (max-width: 1100px)"), stylesheet.indexOf("@media (max-width: 640px)"));
  assert.match(responsiveBlock, /\.checklist-overview:not\(\[hidden\]\) \+ \.checklist-progress-workspace,/u);
  assert.match(responsiveBlock, /min-height: 0;/u);
  assert.match(responsiveBlock, /flex: none;/u);
  assert.match(responsiveBlock, /grid-template-columns: minmax\(0, 1fr\);/u);
  assert.match(responsiveBlock, /grid-template-rows: auto 200px;/u);
  assert.match(responsiveBlock, /\.event-ledger-panel \{\s+grid-column: 1;\s+grid-row: 1;/u);
  assert.match(responsiveBlock, /\.progress-panel \{\s+height: 200px;\s+min-height: 200px;\s+grid-column: 1;\s+grid-row: 2;/u);
  assert.doesNotMatch(stylesheet, /min-height: 612px;/u);
});

test("checklist ledger typography stays 14px at every responsive breakpoint", async () => {
  const stylesheet = await readFile(indexStylesheetPath, "utf8");
  const rules = [...stylesheet.matchAll(/\.checklist-detail-shell \.event-ledger-panel \.log-row\.log-table-row \{ font-size: (\d+)px; \}/gu)];
  assert.deepEqual(rules.map((match) => match[1]), ["14", "14"]);
});

test("routine retained-data refreshes do not insert layout-shifting banners", async () => {
  const source = await readFile(appPath, "utf8");
  assert.doesNotMatch(source, /Showing the last canonical Burnlist (?:snapshot|index) while fresh data loads\./u);
  assert.match(source, /\{error && <DashboardError message=\{error\} \/>\}<LensSwitcher \/>/u);
});

test("checklist detail renders the split progress surface and event card list", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-dashboard-test-"));
  try {
    const outputPath = join(outputDir, "ChecklistDashboard.mjs");
    await build({
      entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
      alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18",
    });
    const { ChecklistDashboard, checklistEventDetailFields } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
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
    assert.match(markup, /aria-label="Remaining work over time"/u);
    assert.doesNotMatch(markup, /burn-chart-label|>Completion<\/span>/u);
    assert.doesNotMatch(markup, /aria-label="Burnlist progress chart view"/u);
    assert.match(markup, /<span>Age<\/span><span>Event<\/span><span>Result<\/span><span>Delta<\/span><span>Done<\/span>/u);
    assert.match(markup, /class="event-card-list"/u);
    assert.equal((markup.match(/data-event-card="true"/gu) ?? []).length, 2);
    assert.equal(markup.indexOf("Second event") < markup.indexOf("First event"), true);
    assert.match(markup, /First proof\./u);
    assert.match(markup, /Second proof\./u);
    assert.doesNotMatch(markup, /class="event-card-field-label">Outcome|>Outcome</u);
    assert.equal((markup.match(/class="event-card-field event-card-field-outcome"/gu) ?? []).length, 2);
    assert.equal((markup.match(/class="event-card-summary"/gu) ?? []).length, 2);
    assert.equal((markup.match(/class="event-card-description"/gu) ?? []).length, 2);
    assert.match(markup, /<details class="event-card-field event-card-field-collapsible"><summary><span>Changed<\/span><span class="event-card-field-count">1<\/span><\/summary>/u);
    assert.match(markup, /<details class="event-card-field event-card-field-collapsible"><summary><span>Proof<\/span><span class="event-card-field-count">1<\/span><\/summary>/u);
    assert.match(markup, /src\/second\.mjs/u);
    assert.match(markup, /node --test second\.test\.mjs/u);
    assert.match(markup, /class="event-card-field-label">Follow-up/u);
    assert.doesNotMatch(markup, /event-card-cell|event-card-content|event-card-expand/u);
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
