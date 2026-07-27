import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { validateTerminalOvenIR, type TerminalNode } from "../terminal-contract";
import { layoutTerminalNodes, cellWidth } from "./layout-runtime";
import { StructuralOvenViewport } from "./structural-viewport";

const source = `<oven id="layout-fixture" version="1.0.0" contract="checklist-progress@1" theme="checklist"><box element="section"><grid columns="3" rows="2" row-height="3"><panel id="wide" column="1" row="1" column-span="2"><section-header title="wide"><text text="A very long terminal label 😀 that must remain inside its cell"/></section-header></panel><panel id="side" column="3" row="1" row-span="2"><section-header title="side"><icon slot="main" name="Clock3"/></section-header></panel><panel id="lower" column="1" row="2" column-span="2"><stack direction="row"><section-header title="first"/><section-header title="middle"/><section-header title="last"/></stack></panel></grid><stack>${Array.from({ length: 20 }, (_, index) => `<section-header title="row ${index}"/>`).join("")}</stack></box></oven>`;
function compiled(input = source): readonly TerminalNode[] { const result = compileOven(input, { file: "layout-fixture.oven" }); if (!result.ok) throw new Error(result.diagnostics.map((entry: { message: string }) => entry.message).join("\n")); expect(validateTerminalOvenIR(result.ir)).toEqual([]); return result.ir.root as readonly TerminalNode[]; }
const tree = compiled();
async function capture(width: number, height: number, nodes: readonly TerminalNode[], focusedPath?: string) {
  const setup = await createTestRenderer({ width, height, useThread: false }), root = createRoot(setup.renderer);
  try { flushSync(() => root.render(<StructuralOvenViewport nodes={nodes} viewport={{ width, height }} focusedPath={focusedPath} />)); await setup.renderOnce(); return setup.captureCharFrame(); } finally { root.unmount(); setup.renderer.destroy(); }
}
test("deterministic tracks fit real OpenTUI frames at every target width", async () => {
  for (const width of [40, 60, 80, 100, 140]) {
    const result = layoutTerminalNodes(tree, { width, height: 16 }, undefined, 2), frame = await capture(width, 16, tree);
    expect(result.scroll.height).toBe(14); expect(result.scroll.focusedVisible).toBe(true);
    for (const cell of result.cells) { expect(cell.rect.x).toBeGreaterThanOrEqual(0); expect(cell.rect.x + cell.rect.width).toBeLessThanOrEqual(width); expect(cell.rect.y + cell.rect.height).toBeLessThanOrEqual(14); }
    expect(frame).toContain("terminal"); expect(frame.split("\n")[15]).toContain("q:back"); expect(frame.split("\n")[14]).not.toContain("row");
  }
});
test("grid tracks preserve remainders, spans, and unequal row heights", () => {
  const result = layoutTerminalNodes(tree, { width: 41, height: 20 });
  const wide = result.cells.find((cell) => cell.path === "root/0/0/0")!, side = result.cells.find((cell) => cell.path === "root/0/0/1")!, lower = result.cells.find((cell) => cell.path === "root/0/0/2")!;
  expect(wide.rect.width).toBe(26); expect(side.rect.x).toBe(27); expect(side.rect.height).toBe(6); expect(lower.rect.y).toBe(4); expect(wide.rect.x + wide.rect.width).toBeLessThanOrEqual(side.rect.x);
});
test("narrow grids and row stacks collapse in document order without text overflow", async () => {
  const narrow = compiled(`<oven id="narrow-fixture" version="1.0.0" contract="checklist-progress@1" theme="checklist"><grid columns="4">${Array.from({ length: 4 }, (_, index) => `<panel id="p${index}" column="${index + 1}" row="1"><stack direction="row"><section-header title="panel ${index}"><text text="panel ${index}"/></section-header><section-header title="more"><text text="more"/></section-header></stack></panel>`).join("")}</grid></oven>`);
  const result = layoutTerminalNodes(narrow, { width: 40, height: 50 }), frame = await capture(40, 20, narrow);
  const panels = result.cells.filter((cell) => cell.kind === "panel");
  expect(panels.every((cell) => cell.collapsed)).toBe(true); expect(panels.map((cell) => cell.rect.y)).toEqual([...panels.map((cell) => cell.rect.y)].sort((a, b) => a - b));
  for (const cell of result.cells.filter((cell) => cell.kind === "text" || cell.kind === "icon")) expect(cellWidth(cell.text ?? "")).toBeLessThanOrEqual(cell.rect.width);
  expect(frame).toContain("↳"); expect(frame).toContain("panel"); expect(frame).not.toContain("panelmore");
});
test("first, middle, and last focus clamp above the two-row footer", () => {
  for (const focus of ["root/0/1/0", "root/0/1/10", "root/0/1/19"]) { const result = layoutTerminalNodes(tree, { width: 80, height: 10 }, focus); const cell = result.cells.find((item) => item.path === focus)!; expect(result.scroll.focusedVisible).toBe(true); expect(cell.rect.y).toBeGreaterThanOrEqual(0); expect(cell.rect.y + cell.rect.height).toBeLessThanOrEqual(8); }
});
test("grapheme width preserves combining, ZWJ families, regional flags, and wide emoji", () => { expect(cellWidth("e\u0301")).toBe(1); expect(cellWidth("👨‍👩‍👧‍👦")).toBe(2); expect(cellWidth("🇩🇪")).toBe(2); expect(cellWidth("😀")).toBe(2); });
