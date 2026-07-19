import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { LogTable } from "../LogTable";
import { formatRegistry } from "../OvenView/registries";
import { assertDomEquivalent } from "../test-support/dom-normalize";
import { resolvePointer } from "../utils/json-pointer";
import { buildLogTableProps } from "./log-table-adapter";
import { OvenNode } from "./OvenNode";
import { initOvenState, type OvenIr } from "./oven-reducer";

const source = `<oven id="log-table-test" version="1" contract="checklist-progress@1" theme="checklist"><grid id="log-grid" columns="1"><log-table source="/events" empty-text="Nothing here."><column label="Time" source="@item/time" format="time-only"/><column label="Name" source="@item/name"/><column label="Note" source="@item/note" optional="true" fallback="—"/></log-table></grid></oven>`;
const compiled = compileOven(source);
if (!compiled.ok) throw new Error(compiled.diagnostics.map((item: { message: string }) => item.message).join("\n"));
const table = compiled.ir.root[0].children[0];
const ir = { ...compiled.ir, controls: [], collections: [] } as OvenIr;
const payload = { events: [{ time: "2025-01-01T09:07:00Z", name: "first" }, { time: "2025-01-01T10:08:00Z", name: "second", note: "ready" }] };

function renderRuntime(value: unknown) {
  return renderToStaticMarkup(createElement(OvenNode, { node: table, ir, state: initOvenState(ir, value), dispatch: () => {} }));
}

test("log-table runtime renders compiled @item columns like LogTable", () => {
  const props = buildLogTableProps(table, payload, { resolvePointer, formatRegistry });
  const expected = renderToStaticMarkup(createElement(LogTable, { ...props }));
  assertDomEquivalent(renderRuntime(payload), expected);
  assert.equal(props.rows[0].cells[0].content, formatRegistry["time-only"](payload.events[0].time));
  assert.equal(props.rows[0].cells[2].content, "—");
  assert.equal(props.rows[1].cells[1].content, "second");
});

test("log-table runtime renders empty-text for a missing or empty source", () => {
  assert.match(renderRuntime({ events: [] }), /Nothing here\./);
  assert.match(renderRuntime({}), /Nothing here\./);
});
