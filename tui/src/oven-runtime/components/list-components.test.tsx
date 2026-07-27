import { afterEach, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { listFixture, listPreviewRows } from "../../catalog/list-fixture";
import { admitTerminalOven, type JsonValue, type TerminalOvenIR } from "../terminal-contract";
import { projectComponentLayout } from "./component-layout";
import { TerminalList, logTableModel } from "./list-components";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";

const renderers: Array<{ destroy(): void }> = [];
afterEach(() => { while (renderers.length) renderers.pop()?.destroy(); });
async function frame(width: number, height: number, state: "current" | "expanded" | "latest", footer = false) {
  const setup = await createTestRenderer({ width, height, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer), preview = listPreviewRows(width, state);
  const listHeight = footer ? height - 2 : height;
  flushSync(() => root.render(footer ? <box width={width} height={height} flexDirection="column"><TerminalList model={{ ...preview, columns: listFixture.columns, height: listHeight }} /><box height={2} border={["top"]}><text>q:back · esc:exit</text></box></box> : <TerminalList model={{ ...preview, columns: listFixture.columns, height }} />));
  await setup.flush(); const output = setup.captureCharFrame(); root.unmount(); return output;
}

function compiled(source: string): TerminalOvenIR {
  const result = compileOven(source, { file: "generic-log-table.oven" });
  if (!result.ok) throw new Error(result.diagnostics.map((item: { message: string }) => item.message).join("\n"));
  return result.ir as TerminalOvenIR;
}

async function ovenFrame(ir: TerminalOvenIR, payload: JsonValue, width = 60, height = 12) {
  const admitted = admitTerminalOven(ir, { status: "ready", payload }, { viewport: { width, height } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  expect(admitted.status).toBe("ready");
  const setup = await createTestRenderer({ width, height, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer);
  flushSync(() => root.render(<TerminalOvenViewport result={admitted} />));
  await setup.flush(); const output = setup.captureCharFrame(); root.unmount(); return output;
}

test("table/list fixture measures columns and ellipsizes at wide, medium, and narrow widths", async () => {
  for (const width of [72, 48, 36]) {
    const output = await frame(width, 12, "current");
    expect(output).toContain("STATE"); expect(output).toContain("ACTIVE");
    expect(output.split("\n").every((line) => Array.from(line).length <= width)).toBe(true);
  }
});

test("expanded shared row remains bounded and final focused row stays above the reserved footer", async () => {
  const expanded = await frame(48, 12, "expanded"); expect(expanded).toContain("Expanded detail");
  const latest = await frame(48, 12, "latest", true);
  const lines = latest.split("\n"); expect(lines.at(-1)).not.toContain("B28"); expect(lines.slice(0, -1).join("\n")).toContain("B28"); expect(latest).toContain("LATEST");
  expect(lines.slice(-2).join("\n")).toContain("q:back"); expect(lines.slice(-2).join("\n")).not.toContain("B28");
});

test("compiled generic log-table preserves console binding formats, fallback, and empty text", async () => {
  const ir = compiled(`<oven id="generic-log-table" version="1.0.0" contract="checklist-progress@1" theme="checklist"><log-table source="/events" empty-text="Nothing here."><column label="Time" source="@item/time" format="time-only"/><column label="Name" source="@item/name"/><column label="Note" source="@item/note" optional="true" fallback="—"/></log-table></oven>`);
  expect(projectComponentLayout(ir.root, 60).roots.map((root) => root.node.kind)).toEqual(["log-table"]);
  const payload = { events: [{ time: "2025-01-01T09:07:00Z", name: "first" }, { time: "2025-01-01T10:08:00Z", name: "second", note: "ready" }] } as const satisfies JsonValue;
  const model = logTableModel(ir.root[0]!, payload, 60, 8);
  expect(model.rows[0]?.cells).toEqual({ "column-0": "09:07", "column-1": "first", "column-2": "—" });
  const output = await ovenFrame(ir, payload);
  for (const value of ["Time", "Name", "Note", "09:07", "first", "—", "second", "ready", "q:back"]) expect(output).toContain(value);
  expect(await ovenFrame(ir, { events: [] })).toContain("Nothing here.");
});
