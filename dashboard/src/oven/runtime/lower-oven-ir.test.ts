import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClipboardList } from "lucide-react";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { KpiItem } from "../KpiItem/KpiItem";
import { KpiStrip } from "../KpiStrip/KpiStrip";
import { OvenView } from "../OvenView/OvenView";
import { ProgressDonut } from "../ProgressDonut/ProgressDonut";
import { SectionHeader } from "../SectionHeader/SectionHeader";
import { assertDomEquivalent, extractFirstByClass } from "../test-support/dom-normalize";
import { lowerOvenIr } from "./lower-oven-ir";

const payload = { value: 7, ratio: 0.123, items: ["a", "b"] };
const open = '<oven id="test" version="0.1.0" contract="checklist-progress@1" theme="checklist">';

function lower(fragment: string) {
  const result = compileOven(`${open}${fragment}</oven>`);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.diagnostics));
  return lowerOvenIr(result.ir);
}

function render(def: ReturnType<typeof lower>) {
  return renderToStaticMarkup(createElement(OvenView, { def, payload }));
}

function handwritten(component: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement("div", null, component));
}

test("lowers kpi-strip and kpi-item icon bindings to handwritten markup", () => {
  const def = lower('<kpi-strip aria-label="Summary"><kpi-item heading="Done" source="/value"><icon slot="visual" name="ClipboardList" /></kpi-item></kpi-strip>');
  assertDomEquivalent(render(def), handwritten(createElement(KpiStrip, { ariaLabel: "Summary", className: "driving-parity-kpi-strip has-burns checklist-kpi-strip" }, createElement(KpiItem, {
    className: "driving-parity-kpi-item driving-parity-kpi-section",
    heading: "Done", value: 7, visual: createElement(ClipboardList, { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" }),
  }))));
});

test("lowers kpi-item progress visual and bound text value", () => {
  const def = lower('<stack><kpi-item heading="Progress"><progress-donut slot="visual" source="/ratio" format="ratio-to-percent" /><text slot="value" source="/ratio" format="percent" /></kpi-item></stack>');
  const expected = createElement("div", { className: "oven-stack", style: { display: "flex", flexDirection: "column" } }, createElement(KpiItem, {
    className: "driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress",
    heading: "Progress", visual: createElement(ProgressDonut, { percent: 12.3 }), value: "12.30%",
  }));
  assertDomEquivalent(render(def), renderToStaticMarkup(expected));
});

test("lowers progress-donut and section-header primary source shorthands", () => {
  const donut = lower('<stack><kpi-item heading="Progress" source="/ratio"><progress-donut slot="visual" source="/ratio" format="ratio-to-percent" /></kpi-item></stack>');
  assertDomEquivalent(extractFirstByClass(render(donut), "driving-parity-kpi-progress-donut"), renderToStaticMarkup(createElement(ProgressDonut, { percent: 12.3 })));
  const header = lower('<section-header title="Items" source="/items" format="length" />');
  assertDomEquivalent(render(header), handwritten(createElement(SectionHeader, { title: "Items", count: 2 })));
});

test("shared compiled progress fixture preserves optional and fallback bindings", () => {
  const source = readFileSync("tui/src/catalog/progress-fixture.oven", "utf8");
  const compiled = compileOven(source, { file: "tui/src/catalog/progress-fixture.oven" });
  assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
  const def = lowerOvenIr(compiled.ir), strip = def.sections[0].cells[0], optional = strip.children?.find((cell) => cell.props?.heading === "Optional");
  assert.deepEqual(optional?.bind?.value, { source: "/missing", optional: true, fallback: "waiting" });
  assert.deepEqual(optional?.slots?.visual && "bind" in optional.slots.visual ? optional.slots.visual.bind?.percent : undefined, { source: "/missing", optional: true, fallback: "25" });
  const markup = renderToStaticMarkup(createElement(OvenView, { def, payload: { percent: 57, done: 4, total: 7, burns: [], metric: { total: 0 }, required: "ready" } }));
  assert.match(markup, /waiting/u);
});

test("lowers trusted grid and panel geometry into style objects", () => {
  const def = lower('<grid columns="12" rows="4" row-height="48"><panel id="summary" column="2" row="3" column-span="4" row-span="2"><kpi-item heading="Done" source="/value" /></panel></grid>');
  assert.deepEqual(def.sections[0].props?.style, {
    display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(4, 48px)",
  });
  assert.equal(def.sections[1].className, "oven-panel");
  assert.deepEqual(def.sections[1].props?.style, { gridColumn: "2 / span 4", gridRow: "3 / span 2" });
});

test("rejects interactive and iterating IR nodes in static lowering", () => {
  assert.throws(() => lowerOvenIr({ id: "x", root: [{ kind: "collection", attributes: {}, bindings: {}, children: [] }] }), /Unsupported in static lowering: collection/);
});
