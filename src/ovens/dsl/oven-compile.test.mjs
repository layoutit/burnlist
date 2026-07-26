import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileOven, compileOvenFile } from "./oven-compile.mjs";

function frozen(value) { if (!value || typeof value !== "object") return true; return Object.isFrozen(value) && Object.values(value).every(frozen); }
for (const [name, expected] of Object.entries({ checklist: { components: ["kpi-item", "log-table", "progress-donut", "section-header"], icons: ["ClipboardList", "Gauge"] }, "differential-testing": { components: ["burn-donut", "field-list", "kpi-strip", "waffle-metric"], selectors: ["changed", "non-pass"] } })) test(`${name} golden compiles to frozen JSON-safe IR`, async () => {
  const result = await compileOvenFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", `${name}.oven`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(frozen(result.ir), true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.ir)), result.ir);
  for (const [key, values] of Object.entries(expected)) for (const value of values) assert.ok(result.ir.requirements[key].includes(value));
});

test("oven version is a semver string", () => {
  const source = '<oven id="sample-oven" version="0.1.0" contract="checklist-progress@1" theme="checklist"/>';
  const result = compileOven(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.ir.version, "0.1.0");
});

test("oven version requires major.minor.patch", () => {
  for (const version of ["1", "1.0"]) {
    const source = `<oven id="sample-oven" version="${version}" contract="checklist-progress@1" theme="checklist"/>`;
    const result = compileOven(source);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SCALAR_VERSION"), JSON.stringify(result.diagnostics));
  }
});

test("loop-graph is a closed root or item-scoped Oven component", () => {
  const root = compileOven('<oven id="loop-view" version="0.1.0" contract="checklist-progress@1" theme="checklist"><loop-graph source="/loopRun"/></oven>');
  assert.equal(root.ok, true, JSON.stringify(root.diagnostics));
  assert.ok(root.ir.requirements.components.includes("loop-graph"));
  const item = compileOven('<oven id="loop-items" version="0.1.0" contract="checklist-progress@1" theme="checklist"><collection id="items" source="/items" item-key="/id" paging="client" page-size="10"><each><loop-graph source="@item/loopRun"/></each></collection></oven>');
  assert.equal(item.ok, true, JSON.stringify(item.diagnostics));
  const missing = compileOven('<oven id="loop-view" version="0.1.0" contract="checklist-progress@1" theme="checklist"><loop-graph/></oven>');
  assert.equal(missing.ok, false);
  assert.ok(missing.diagnostics.some((diagnostic) => diagnostic.code === "GRAMMAR_REQUIRED"));
});

test("loop-progress is a closed declarative component", () => {
  const result = compileOven('<oven id="loop-progress" version="0.1.0" contract="checklist-progress@1" theme="checklist"><loop-progress source="/raw"/></oven>');
  assert.equal(result.ir.root[0].kind, "loop-progress");
  assert.equal(result.ir.root[0].attributes.source, "/raw");
});

test("loop-progress composes through the same standard containers as loop-graph", () => {
  const bodies = [
    '<grid columns="1"><loop-progress source="/raw"/></grid>',
    '<stack><loop-progress source="/raw"/></stack>',
    '<panel id="progress"><loop-progress source="/raw"/></panel>',
    '<switch source="/mode"><case value="live"><loop-progress source="/raw"/></case></switch>',
    '<collection id="items" source="/items" item-key="/id" paging="client" page-size="10"><each><loop-progress source="@item/raw"/></each></collection>',
  ];
  for (const body of bodies) {
    const result = compileOven(`<oven id="loop-progress" version="0.1.0" contract="checklist-progress@1" theme="checklist">${body}</oven>`);
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.diagnostics));
  }
});

test("ascii-block is a closed, bind-only text component", () => {
  const result = compileOven('<oven id="ascii-view" version="0.1.0" contract="checklist-progress@1" theme="checklist"><ascii-block><bind prop="text" source="/scene/text"/><bind prop="colors" source="/scene/colors"/></ascii-block></oven>');
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.ir.requirements.components.includes("ascii-block"));

  const missingText = compileOven('<oven id="ascii-view" version="0.1.0" contract="checklist-progress@1" theme="checklist"><ascii-block><bind prop="colors" source="/scene/colors"/></ascii-block></oven>');
  assert.equal(missingText.ok, false);
  assert.ok(missingText.diagnostics.some((diagnostic) => diagnostic.code === "PROPS_REQUIRED"));
});
