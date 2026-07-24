import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { ProgressLedger, ProgressPanel } from "@/components/ChecklistDashboard/ChecklistDashboard";
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
  assertDomEquivalent(renderWidget("checklist-event-cards"), renderToStaticMarkup(createElement(ChecklistWorkspace, { data: checklistFixture })));
});

test("box lowering preserves element, class, id, text, and children", () => {
const result = compileOven('<oven id="box-test" version="0.1.0" contract="checklist-progress@1" theme="checklist"><box element="section" class="outer" id="box-id" text="Before"><box element="span" class="inner" text="After" /></box></oven>');
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.diagnostics));
  const state = initOvenState(ir, {});
  const html = renderToStaticMarkup(createElement(OvenNode, { node: result.ir.root[0], ir, state, dispatch: () => {} }));
  assertDomEquivalent(html, '<section class="outer" id="box-id">Before<span class="inner">After</span></section>');
});

test("checklist declarative vocabulary and passthrough attributes compile", () => {
  const source = '<oven id="fragment" version="0.1.0" contract="checklist-progress@1" theme="checklist"><box element="div" class="shell"><kpi-strip class="strip" title="summary"><kpi-item class="item" title="detail" heading="Progress"><progress-value done="/progress/done" total="/progress/total" percent="/progress/percent"/></kpi-item></kpi-strip><section-header class="head" title="Events" source="/events" /><log-table class="table" title="ledger" source="/ledger"><column label="Event" source="@item/event" /></log-table><checklist-burn-panel source="/raw" /><checklist-ledger source="/raw" /><checklist-event-cards source="/raw" /></box></oven>';
  const result = compileOven(source);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.diagnostics));
});
