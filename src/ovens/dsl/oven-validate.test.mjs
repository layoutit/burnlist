import test from "node:test";
import assert from "node:assert/strict";
import { compileOven } from "./oven-compile.mjs";

const invalid = (xml, code) => { const r = compileOven(xml); assert.equal(r.ok, false); assert.ok(r.diagnostics.some((x) => x.code === code), JSON.stringify(r.diagnostics)); };
const root = (body, attrs = "") => `<oven id="test" version="0.1.0" contract="checklist-progress@1" theme="checklist" ${attrs}>${body}</oven>`;
test("vocabulary, scalar, registry and references are closed", () => {
  invalid(root("<unknown/>"), "GRAMMAR_ELEMENT");
  invalid(root("<grid columns='2' nope='x'/>"), "GRAMMAR_ATTRIBUTE");
  invalid(root("<grid id='Bad' columns='2'/>"), "SCALAR_ID");
  invalid(root("<log-table source='bad'><column label='x' source='/'/></log-table>"), "SCALAR_POINTER");
  invalid(root("<switch mode-from='missing'><case value='x'/></switch>"), "REFERENCE_TARGET");
  invalid(root("<kpi-item source='/' format='nope'/>"), "REGISTRY_FORMAT");
  invalid(root("<kpi-item><icon slot='visual' name='Nope'/></kpi-item>"), "REGISTRY_ICON");
  invalid(root("<field-toolbar id='tools'><filter-toggle id='f' key='nope' label='x' initial='on'/></field-toolbar>"), "REGISTRY_FILTER");
  invalid(root("<field-toolbar id='tools'><sort-toggle id='s' key='nope' label='x' initial='on'/></field-toolbar>"), "REGISTRY_SORT");
  invalid('<oven id="test" version="0.1.0" contract="checklist-progress@1" theme="wrong"/>', "REGISTRY_THEME");
});
test("structure and interaction validation", () => {
  invalid(root("<grid columns='2' rows='2'><panel id='a' column='1' row='1' column-span='2' row-span='2'/><panel id='b' column='2' row='1'/></grid>"), "STRUCTURE_GRID_OVERLAP");
  invalid(root("<grid columns='2' rows='2'><panel id='a' column='2' row='2' column-span='2'/></grid>"), "STRUCTURE_GRID_BOUNDS");
  invalid(root("<switch mode-from='m'/><mode-toggle id='m' initial='a' aria-label='m'><option value='a' label='a'/><option value='b' label='b'/></mode-toggle>"), "STRUCTURE_SWITCH");
  invalid(root("<mode-toggle id='m' initial='a' aria-label='m'><option value='a' label='a'/><option value='b' label='b'/></mode-toggle><switch mode-from='m'><case default='true'/><case default='true'/></switch>"), "STRUCTURE_SWITCH");
  invalid(root("<collection id='rows' source='/' item-key='/id' paging='client' page-size='1'><each><mode-toggle id='m' initial='a' aria-label='m'><option value='a' label='a'/><option value='b' label='b'/></mode-toggle></each></collection>"), "INTERACTION_EACH");
  invalid(root("<switch><case value='a'/></switch>"), "GRAMMAR_SWITCH_SOURCE");
  invalid(root("<mode-toggle id='m' initial='a' aria-label='m'><option value='a' label='a'/><option value='b' label='b'/></mode-toggle><switch source='/' mode-from='m'><case value='a'/></switch>"), "GRAMMAR_SWITCH_SOURCE");
});

test("switch accepts a payload pointer without a control reference", () => {
  const result = compileOven(root("<switch source='/pageMode'><case value='detail'><section-header title='Fields'/></case></switch>"));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.ir.root[0].attributes.source, "/pageMode");
});

test("pagination without page-sizes returns a required-attribute diagnostic", () => {
  const xml = root("<collection id='rows' source='/' item-key='/id' paging='client' page-size='1'><pagination collection-from='rows'/></collection>");
  let result;
  assert.doesNotThrow(() => { result = compileOven(xml); });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((x) => x.code === "GRAMMAR_REQUIRED"), JSON.stringify(result.diagnostics));
});
