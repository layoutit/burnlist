import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { cellWidth } from "../layout/layout-runtime";
import { admitTerminalOven, type JsonValue, type TerminalNode, type TerminalOvenIR, type TerminalRenderResult } from "../terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";
import { burnDonutCounts, burnDonutText, kpiFromNode, kpiStripModel, progressDonutText, waffleMetricData, waffleMetricText } from "./progress-components";
import { projectComponentLayout } from "./component-layout";
import { progressGlyphFrame } from "./progress-glyph";

const checklistPayload = { current: { title: "Newest item", value: "B7 · Active" }, progress: { title: "Delivery", done: 4, total: 7, percent: 57 }, durations: { elapsed: "2m", pace: "30s", timeLeft: "90s" }, raw: { generatedAt: "2026-07-24T12:00:00Z", total: 7, done: 4, remaining: 3, active: [], completed: [] }, ledger: [], history: [], events: [] } as const satisfies JsonValue;
const differentialSource = `<oven id="differential-progress-fixture" version="1.0.0" contract="burnlist-differential-testing-data@1" theme="differential-testing"><kpi-strip aria-label="Differential Testing field KPIs" title="/title"><kpi-item variant="scenario" heading="Scenario" value="/scenario"/><kpi-item heading="Progress"><progress-donut slot="visual" source="/percent"/><text slot="value" source="/ratio" format="percent"/></kpi-item><kpi-item variant="burns" heading="Results"><burn-donut slot="visual" source="/burns"/></kpi-item><kpi-item variant="fields" heading="Fields"><waffle-metric slot="visual" source="/fields"/></kpi-item><kpi-item variant="frames" heading="Frames"><waffle-metric slot="visual" source="/frames"/></kpi-item></kpi-strip></oven>`;
const differentialPayload = { title: "Run metrics", scenario: "Baseline", percent: 60, ratio: 0.6, burns: [{ result: "pass" }, { result: "worsened" }, { result: "blocked" }, { result: "other" }], fields: { total: 10, failed: 2, blocked: 1 }, frames: { total: 5, failed: 1, blocked: 0 } } as const satisfies JsonValue;

function compiled(source: string, file: string): TerminalOvenIR {
  const result = compileOven(source, { file });
  if (!result.ok) throw new Error(result.diagnostics.map((item: { message: string }) => item.message).join("\n"));
  return result.ir as TerminalOvenIR;
}
function admitted(ir: TerminalOvenIR, payload: JsonValue, width: number, height = 12): TerminalRenderResult {
  return admitTerminalOven(ir, { status: "ready", payload }, { viewport: { width, height } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
}
async function frame(result: TerminalRenderResult) {
  const setup = await createTestRenderer({ width: result.state.viewport.width, height: result.state.viewport.height, useThread: false }), root = createRoot(setup.renderer);
  try { flushSync(() => root.render(<TerminalOvenViewport result={result} />)); await setup.renderOnce(); return setup.captureCharFrame(); } finally { root.unmount(); setup.renderer.destroy(); }
}

test("full official Checklist admission uses the implemented composite roots", () => {
  const source = readFileSync(new URL("../../../../ovens/checklist/checklist.oven", import.meta.url), "utf8"), ir = compiled(source, "ovens/checklist/checklist.oven");
  const result = admitted(ir, checklistPayload, 60, 20);
  expect(result.status).toBe("ready");
  expect(result.diagnostics).toEqual([]);
  const officialKpis = kpiStripModel(ir.root[0]!, checklistPayload, 120);
  expect(officialKpis.items.map((item) => item.heading)).toEqual(["Current", "Progress", "Elapsed", "Avg pace", "Time left"]);
  expect(officialKpis.items[1]).toMatchObject({ value: "4 · 7 (57%)" });
});

test("standalone kpi-item roots reserve and render inside box, stack, and panel without double roots", async () => {
  const source = `<oven id="standalone-kpis" version="1.0.0" contract="checklist-progress@1" theme="checklist"><box element="section"><kpi-item variant="current" heading="Box KPI" value="/box"/></box><stack><kpi-item variant="scenario" heading="Stack KPI" value="/stack"/></stack><panel id="panel"><kpi-item variant="fields" heading="Panel KPI" value="/panel"/></panel></oven>`;
  const ir = compiled(source, "standalone-kpis.oven"), projected = projectComponentLayout(ir.root, 60);
  expect(projected.roots.map((root) => root.node.kind)).toEqual(["kpi-item", "kpi-item", "kpi-item"]);
  const output = await frame(admitted(ir, { box: "one", stack: "two", panel: "three" }, 60, 16));
  for (const value of ["Box KPI", "Stack KPI", "Panel KPI", "one", "two", "three"]) expect(output).toContain(value);
  const strip = compiled(differentialSource, "nested-strip.oven");
  expect(projectComponentLayout(strip.root, 60).roots.map((root) => root.node.kind)).toEqual(["kpi-strip"]);
});

test("source-derived generic KPI fixture preserves metadata, variants, slots, and console values", async () => {
  const ir = compiled(differentialSource, "differential-progress-fixture.oven"), model = kpiStripModel(ir.root[0]!, differentialPayload, 120);
  expect(model).toMatchObject({ ariaLabel: "Differential Testing field KPIs", title: "Run metrics" });
  expect(model.items.map((item) => item.variant)).toEqual(["scenario", undefined, "burns", "fields", "frames"]);
  expect(model.items[1]).toMatchObject({ value: "60.00%" }); expect(model.items[1]!.visual).toContain("60%");
  for (const width of [20, 36, 60, 120]) {
    const output = await frame(admitted(ir, differentialPayload, width, 20));
    for (const value of ["Run metrics", "Scenario", "Progress", "Results", "Fields", "Frames"]) expect(output).toContain(value);
    expect(output.split("\n").some((line) => line.includes("q:back"))).toBe(true);
    for (const line of output.split("\n")) expect(cellWidth(line.trimEnd())).toBeLessThanOrEqual(width);
    for (const glyph of ["◎", "◉", "▦", "▤"]) expect(output).toContain(glyph);
  }
});

test("slot precedence matches console lowering and required bindings fail closed", () => {
  const source = `<oven id="precedence" version="1.0.0" contract="checklist-progress@1" theme="checklist"><kpi-strip><kpi-item heading="/heading" value="/attribute" source="/source" icon="Gauge"><bind prop="value" source="/bind"/><text slot="value" text="slot wins"/><icon slot="visual" name="Clock3"/></kpi-item></kpi-strip></oven>`;
  const item = compiled(source, "precedence.oven").root[0]!.children[0]!;
  expect(kpiFromNode(item, { heading: "Bound", attribute: "attribute", source: "source", bind: "bind" })).toMatchObject({ heading: "Bound", value: "slot wins", icon: "Gauge" });
  expect(() => kpiFromNode(item, { attribute: "attribute", source: "source", bind: "bind" })).toThrow("Missing required oven binding source: /heading");
  const optional = compiled(`<oven id="optional" version="1.0.0" contract="checklist-progress@1" theme="checklist"><kpi-strip><kpi-item heading="Optional"><bind prop="value" source="/missing" optional="true" fallback="waiting"/></kpi-item></kpi-strip></oven>`, "optional.oven");
  expect(kpiFromNode(optional.root[0]!.children[0]!, {})).toMatchObject({ value: "waiting" });
  const optionalSlots = compiled(`<oven id="optional-slots" version="1.0.0" contract="checklist-progress@1" theme="checklist"><kpi-strip><kpi-item heading="Optional"><progress-donut slot="visual" source="/missing" optional="true" fallback="25"/><text slot="value" source="/missing" optional="true" fallback="waiting"/></kpi-item></kpi-strip></oven>`, "optional-slots.oven");
  expect(kpiFromNode(optionalSlots.root[0]!.children[0]!, {})).toMatchObject({ value: "waiting", visual: expect.stringContaining("25%") });
  const shared = compiled(readFileSync(new URL("../../catalog/progress-fixture.oven", import.meta.url), "utf8"), "progress-fixture.oven");
  expect(kpiFromNode(shared.root[0]!.children.at(-1)!, {})).toMatchObject({ heading: "Optional", value: "waiting", visual: expect.stringContaining("25%") });
});

test("frozen pre-extraction console vectors constrain shared metric behavior", () => {
  expect(burnDonutCounts(differentialPayload.burns)).toEqual({ improved: 1, worsened: 1, unchanged: 1, reverted: 1 });
  expect(waffleMetricData(differentialPayload.fields)).toEqual({ failed: 3, failedCells: 29, empty: false });
  expect(waffleMetricData({ total: 6, failed: 1, blocked: 5 })).toEqual({ failed: 6, failedCells: 80, empty: false });
  expect(progressDonutText(-1, 4)).toBe("○○○○ 0%"); expect(progressDonutText(101, 4)).toBe("●●●● 100%");
  expect(waffleMetricText({ total: 0 }, 4)).toBe("□□□□ 0");
});

test("burn apportionment is bounded, deterministic, and retains active classes when representable", () => {
  const entries = [{ result: "pass" }, { result: "pass" }, { result: "worsened" }, { result: "blocked" }, { result: "other" }];
  const bar = burnDonutText(entries, 4).split(" ")[0]!;
  expect(cellWidth(bar)).toBe(4); for (const glyph of ["●", "×", "·", "!"]) expect(bar).toContain(glyph);
  expect(burnDonutText(entries, 2).split(" ")[0]).toBe("●×");
  expect(burnDonutText([], 3)).toBe("○○○ 0");
  const ratio = [{ result: "pass" }, { result: "pass" }, { result: "worsened" }];
  expect([3, 4, 6].map((width) => burnDonutText(ratio, width).split(" ")[0])).toEqual(["●●×", "●●●×", "●●●●××"]);
  const tie = [{ result: "worsened" }, { result: "pass" }];
  expect(burnDonutText(tie, 4).split(" ")[0]).toBe("●●××");
  expect(burnDonutText([...tie].reverse(), 4)).toBe(burnDonutText(tie, 4));
  const skew = [...Array.from({ length: 100 }, () => ({ result: "pass" })), { result: "worsened" }, { result: "blocked" }, { result: "other" }];
  expect(burnDonutText(skew, 3).split(" ")[0]).toBe("●●●");
  expect(new Set(burnDonutText(skew, 4).split(" ")[0])).toEqual(new Set(["●", "×", "!", "·"]));
  expect(burnDonutText(skew, 8).split(" ")[0]!.length).toBe(8);
  const frame = progressGlyphFrame("burn-donut", skew, 4);
  expect(new Set(frame.color)).toEqual(new Set(["#55b987", "#e06c75", "#d19a66", "#8b8b8b"]));
});
