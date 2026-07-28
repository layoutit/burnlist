import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { ChecklistTabs, EventCardList, ProgressLedger, ProgressPanel } from "@/components/ChecklistDashboard/ChecklistDashboard";
import { checklistFixture } from "@/components/ChecklistDashboard/ChecklistDashboard.fixture.mjs";
import { ChecklistWorkspace } from "../ChecklistWorkspace";
import { assertDomEquivalent } from "../test-support/dom-normalize";
import { OvenNode } from "../runtime/OvenNode";
import { initOvenState, type OvenIr } from "../runtime/oven-reducer";

const ir: OvenIr = { contract: "checklist-progress@1", controls: [], collections: [], root: [] };

function renderWidget(kind: string) {
  const node = { kind, attributes: { source: "/raw" }, children: [] };
  return renderToStaticMarkup(createElement(OvenNode, { node, ir, state: initOvenState(ir, { raw: checklistFixture }), dispatch: () => {} }));
}

test("checklist widget adapters preserve the exported dashboard subregions", () => {
  assertDomEquivalent(renderWidget("checklist-burn-panel"), renderToStaticMarkup(createElement(ProgressPanel, { data: checklistFixture })));
  assertDomEquivalent(renderWidget("checklist-ledger"), renderToStaticMarkup(createElement(ProgressLedger, { data: checklistFixture })));
  assertDomEquivalent(renderWidget("checklist-event-cards"), renderToStaticMarkup(createElement(EventCardList, { data: checklistFixture })));
  assertDomEquivalent(renderWidget("checklist-tabs"), renderToStaticMarkup(createElement(ChecklistTabs, { data: checklistFixture })));
});

test("workspace exposes live execution identity, evidence, and observed paths", () => {
  const data = structuredClone(checklistFixture);
  const graph = {
    entry: "implement",
    nodes: [
      { id: "implement", kind: "agent", role: "implementer", authority: "write", execution: { profileId: "maker", model: "gpt-5.3-codex-spark", effort: "low", authority: "write" } },
      { id: "burn", kind: "terminal", terminalState: "converged" },
    ],
    edges: [{ from: "implement", on: "complete", to: "burn" }],
  };
  data.active = [{
    id: "U3",
    title: "Observe the run",
    fields: { Action: "Observe", "Done/delete when": "Visible", Validate: "test", "Files/search": "src/example.mjs" },
    loop: { selector: "loop:project:test", assignmentId: "assignment:test", executionRevision: "execution:test", packageRevision: "package:test", graph },
  }];
  data.total = 3;
  data.remaining = 1;
  data.selectedItemId = "U3";
  data.loopRun = {
    schema: "burnlist-loop-read-projection@1",
    runId: "run:test",
    itemRef: "item:test#U3",
    loopId: "loop:project:test",
    loopRevision: "revision:test",
    createdAt: 1,
    updatedAt: 2,
    state: "running",
    currentNode: "implement",
    attempt: 2,
    cycle: 1,
    hostTask: "claimed",
    revision: "run-revision:test",
    execution: { mode: "host-reported", started: true, usage: "unavailable" },
    budget: {
      limits: { maxRounds: 2, maxMinutes: 10, maxAgentRuns: 2, maxCheckRuns: 1, maxTransitions: 4, maxOutputBytes: 1000 },
      counters: { rounds: 1, agentRuns: 1, checkRuns: 0, transitions: 1, outputBytes: 10 },
      elapsedMilliseconds: 65_000,
      journal: { maximum: 100, used: 5, remaining: 95 },
    },
    latestResult: { kind: "completed", summary: "Candidate ready" },
    latestMaker: { summary: "Candidate ready", at: 1, candidateId: "candidate:test" },
    graph,
    transitions: [],
    activity: {
      hooks: "available",
      records: [{ at: Date.parse(data.generatedAt) - 1_000, origin: "host-hook", provider: "codex", mode: "host-reported", kind: "tool", nodeId: "implement", attempt: 2, observedPath: "src/example.mjs", truncated: true }],
    },
  };
  const html = renderToStaticMarkup(createElement(ChecklistWorkspace, { data }));
  assert.match(html, /ACTIVE · progressing/);
  assert.match(html, /Canonical Run has a live host claim/);
  assert.match(html, /Current Loop execution/);
  assert.match(html, /host-reported/);
  assert.match(html, /1m 5s/);
  assert.match(html, /Candidate ready/);
  assert.match(html, /codex/);
  assert.match(html, /truncated/);
  assert.match(html, /src\/example\.mjs/);
});

test("box lowering preserves element, class, id, text, and children", () => {
const result = compileOven('<oven id="box-test" version="0.1.0" contract="checklist-progress@1" theme="checklist"><box element="section" class="outer" id="box-id" text="Before"><box element="span" class="inner" text="After" /></box></oven>');
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.diagnostics));
  const state = initOvenState(ir, {});
  const html = renderToStaticMarkup(createElement(OvenNode, { node: result.ir.root[0], ir, state, dispatch: () => {} }));
  assertDomEquivalent(html, '<section class="outer" id="box-id">Before<span class="inner">After</span></section>');
});

test("checklist declarative vocabulary and passthrough attributes compile", () => {
  const source = '<oven id="fragment" version="0.1.0" contract="checklist-progress@1" theme="checklist"><box element="div" class="shell"><kpi-strip class="strip" title="summary"><kpi-item class="item" title="detail" heading="Progress"><progress-value done="/progress/done" total="/progress/total" percent="/progress/percent"/></kpi-item></kpi-strip><section-header class="head" title="Events" source="/events" /><log-table class="table" title="ledger" source="/ledger"><column label="Event" source="@item/event" /></log-table><checklist-burn-panel source="/raw" /><checklist-ledger source="/raw" /><checklist-event-cards source="/raw" /><checklist-tabs source="/raw" /></box></oven>';
  const result = compileOven(source);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.diagnostics));
});
