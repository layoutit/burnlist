import { expect, test } from "bun:test";
import { inspectJsonBudget, readBoundedJson, ResourceBudgetError } from "../oven-runtime/resource-budget";
import { TERMINAL_RESOURCE_LIMITS } from "../oven-runtime/resource-limits";
import { admitTerminalOven, normalizeTerminalState, validateTerminalOvenIR } from "../oven-runtime/terminal-contract";

const minimalIr = () => ({ schema: "burnlist-oven-ir@1", id: "checklist", version: "1.0.0", contract: "checklist-progress@1", theme: "checklist", root: [], controls: [], collections: [], requirements: { components: [], formats: [], icons: [], selectors: [] } });
const caps = { kinds: [], components: [], formats: [], icons: [], selectors: [] };

test("resource admission rejects IR depth, node, text, and declared surface excess before recursive validation", () => {
  const deep: any = minimalIr(); let node: any = { kind: "box", attributes: {}, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] };
  deep.root = [node]; for (let index = 0; index <= TERMINAL_RESOURCE_LIMITS.irDepth; index += 1) { const child = { kind: "box", attributes: {}, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }; node.children = [child]; node = child; }
  expect(validateTerminalOvenIR(deep)[0]?.code).toBe("RESOURCE_IR_DEPTH");
  const controls: any = minimalIr(); controls.controls = Array.from({ length: TERMINAL_RESOURCE_LIMITS.controls + 1 }, (_, index) => ({ kind: "search", id: `search-${index}` }));
  expect(validateTerminalOvenIR(controls).map((entry) => entry.code)).toContain("RESOURCE_IR_CONTROLS");
  const text = minimalIr(); text.id = "x".repeat(TERMINAL_RESOURCE_LIMITS.irStringBytes + 1);
  expect(validateTerminalOvenIR(text)[0]?.code).toBe("RESOURCE_IR_STRING");
  const tiny = { prefix: "PAYLOAD" as const, nodes: 3, depth: 3, stringBytes: 8, textBytes: 8 };
  expect(inspectJsonBudget([0, 1], tiny)).toBeNull();
  expect(inspectJsonBudget([0, 1, 2], tiny)?.code).toBe("RESOURCE_PAYLOAD_NODES");
});

test("payload admission fails closed rather than slicing client collections", async () => {
  // @ts-expect-error Production compiler is JavaScript by design.
  const compiled = (await import("../../../src/ovens/dsl/oven-compile.mjs")).compileOven('<oven id="rows-oven" version="1.0.0" contract="checklist-progress@1" theme="checklist"><collection id="rows" source="/rows" item-key="/id" page-size="25" paging="client"><each><kpi-item id="row" value="@item/id"/></each></collection></oven>');
  if (!compiled.ok) throw new Error("fixture did not compile");
  const allCaps = { kinds: [...new Set<string>(compiled.ir.root.flatMap((node: any): string[] => [node.kind, ...node.children.map((child: any) => child.kind)]))], components: compiled.ir.requirements.components, formats: compiled.ir.requirements.formats, icons: compiled.ir.requirements.icons, selectors: compiled.ir.requirements.selectors };
  const result = admitTerminalOven(compiled.ir, { status: "ready", payload: { rows: Array.from({ length: TERMINAL_RESOURCE_LIMITS.collectionItems + 1 }, () => ({ id: "row" })) } }, undefined, [], allCaps);
  expect(result.diagnostics[0]?.code).toBe("RESOURCE_PAYLOAD_COLLECTION_ITEMS");
  const oversized = admitTerminalOven(minimalIr(), { status: "ready", payload: "x".repeat(TERMINAL_RESOURCE_LIMITS.payloadStringBytes + 1) }, undefined, [], caps);
  expect(oversized.diagnostics[0]?.code).toBe("RESOURCE_PAYLOAD_STRING");
  // Envelope object + its status string + payload array consume three values too.
  const atLimit = Array.from({ length: TERMINAL_RESOURCE_LIMITS.payloadNodes - 3 }, () => 0);
  expect(admitTerminalOven(minimalIr(), { status: "ready", payload: atLimit }, undefined, [], caps).status).toBe("ready");
  expect(admitTerminalOven(minimalIr(), { status: "ready", payload: [...atLimit, 0] }, undefined, [], caps).diagnostics[0]?.code).toBe("RESOURCE_PAYLOAD_NODES");
});

test("state admission fails closed before retaining oversized cells or expanded keys", () => {
  const valid = Object.freeze({ viewport: Object.freeze({ width: TERMINAL_RESOURCE_LIMITS.terminalCells, height: 1 }), expandedKeys: Object.freeze(Array.from({ length: TERMINAL_RESOURCE_LIMITS.expandedKeys }, (_, index) => `key-${index}`)) });
  const before = structuredClone(valid);
  expect(admitTerminalOven(minimalIr(), { status: "ready", payload: {} }, valid, [], caps).status).toBe("ready");
  const giant = admitTerminalOven(minimalIr(), { status: "ready", payload: {} }, { ...valid, viewport: { width: 1_000_000, height: 1_000_000 } }, [], caps);
  expect(giant.diagnostics[0]?.code).toBe("RESOURCE_STATE_CELLS");
  const tooMany = admitTerminalOven(minimalIr(), { status: "ready", payload: {} }, { ...valid, expandedKeys: Array.from({ length: TERMINAL_RESOURCE_LIMITS.expandedKeys + 1 }, (_, index) => `key-${index}`) }, [], caps);
  expect(tooMany.diagnostics[0]?.code).toBe("RESOURCE_STATE_EXPANDED_KEYS");
  expect(normalizeTerminalState({ viewport: { width: 1_000_000, height: 1_000_000 }, expandedKeys: Array.from({ length: TERMINAL_RESOURCE_LIMITS.expandedKeys + 1 }, (_, index) => `key-${index}`) }, []).viewport).toEqual({ width: 80, height: 24 });
  expect(valid).toEqual(before);
});

test("HTTP JSON reader cancels overflow before parse and preserves valid response semantics", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new TextEncoder().encode("123456")); }, cancel() { cancelled = true; } });
  await expect(readBoundedJson(new Response(body), 4)).rejects.toMatchObject({ code: "RESOURCE_HTTP_BYTES" } satisfies Partial<ResourceBudgetError>);
  expect(cancelled).toBeTrue();
  await expect(readBoundedJson(Response.json({ ok: true }), 1024)).resolves.toEqual({ ok: true });
});
