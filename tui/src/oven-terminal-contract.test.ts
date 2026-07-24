import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { admitTerminalOven, isJsonValue, normalizeTerminalState, validateTerminalOvenIR } from "./oven-runtime/terminal-contract";
const root = join(import.meta.dir, "../..");
async function compile(source: string) { // @ts-expect-error production compiler is intentionally JS
  return (await import("../../src/ovens/dsl/oven-compile.mjs")).compileOven(source);
}
async function official(id: string) { const result = await compile(readFileSync(join(root, "ovens", id, `${id}.oven`), "utf8")); if (!result.ok) throw new Error(JSON.stringify(result.diagnostics)); return result.ir; }
function capabilities(ir: any) { const kinds = new Set<string>(); const walk = (node: any) => { kinds.add(node.kind); node.children.forEach(walk); }; ir.root.forEach(walk); return { kinds: [...kinds], components: ir.requirements.components, formats: ir.requirements.formats, icons: ir.requirements.icons, selectors: ir.requirements.selectors }; }
test("all six official IRs and legal scoped @item IR pass", async () => { for (const id of ["checklist", "differential-testing", "model-lab", "performance-tracing", "streaming-diff", "visual-parity"]) expect(validateTerminalOvenIR(await official(id))).toEqual([]); const custom = await compile('<oven id="custom" version="1.0.0" contract="checklist-progress@1" theme="checklist"><collection id="rows" source="/rows" item-key="/id" paging="auto" page-size="25"><each><kpi-item id="row" value="@item/value"/></each></collection></oven>'); expect(custom.ok).toBeTrue(); expect(validateTerminalOvenIR(custom.ir)).toEqual([]); const unscoped: any = structuredClone(custom.ir); unscoped.root[0].attributes.source = "@item/nope"; expect(validateTerminalOvenIR(unscoped).map((x) => x.code)).toContain("IR_POINTER"); });
test("JSON boundary rejects executable, accessors, exotics, cycles, nonfinite, and hostile proxy", () => { const cycle: any = {}; cycle.self = cycle; const accessor = Object.create(null, { x: { enumerable: true, get() { throw new Error("read"); } } }), iterator = ["safe"]; iterator[Symbol.iterator] = function* () { throw new Error("iterated"); }; const indexed: unknown[] = []; Object.defineProperty(indexed, "0", { enumerable: true, get() { throw new Error("index"); } }); indexed.length = 1; const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); } }); for (const value of [undefined, () => {}, Symbol(), 1n, new Date(), new Map(), new Set(), new Uint8Array(), cycle, NaN, Infinity, accessor, iterator, indexed, proxy]) expect(isJsonValue(value)).toBeFalse(); });
test("IR checks source-exact headers and declaration correspondence both directions", async () => { const ir: any = structuredClone(await official("differential-testing")); ir.id = "A"; ir.version = "1.0.0-beta"; ir.refreshSeconds = 3601; ir.requirements.components = []; ir.controls = []; ir.collections = []; const codes = validateTerminalOvenIR(ir).map((x) => x.code); expect(codes).toEqual(expect.arrayContaining(["IR_HEADER", "IR_REFRESH", "IR_REQUIREMENTS", "IR_CONTROL", "IR_COLLECTION"])); });
test("IR rejects compiler-invalid attributes, children, and ids", async () => { const base: any = structuredClone(await official("checklist")), ledger = base.root.find((node: any) => node.kind === "checklist-ledger"); ledger.attributes = { unknownThing: "x" }; ledger.children = [{ kind: "text", attributes: { slot: "x", text: "x" }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } }]; ledger.attributes.id = "not valid!"; const codes = validateTerminalOvenIR(base).map((x) => x.code); expect(codes).toEqual(expect.arrayContaining(["IR_ATTRIBUTE", "IR_NODE", "IR_NODE_ID"])); });
test("IR rejects root oven, wrong-kind refs, bind-map drift, and malformed slash pointers", async () => { const root: any = structuredClone(await official("checklist")); root.root = [{ ...root.root[0], kind: "oven" }]; expect(validateTerminalOvenIR(root).map((x) => x.code)).toContain("IR_ROOT"); const ref: any = structuredClone(await official("differential-testing")); ref.controls.find((control: any) => control.id === "value-mode").kind = "search"; expect(validateTerminalOvenIR(ref).map((x) => x.code)).toContain("IR_REF"); const bind: any = structuredClone(await official("visual-parity")); bind.root[0].bindings.targetPass = { source: "/wrong" }; expect(validateTerminalOvenIR(bind).map((x) => x.code)).toContain("IR_BINDING"); const pointer: any = structuredClone(await official("checklist")); pointer.root[0].children[0].attributes.value = "/bad~x"; expect(validateTerminalOvenIR(pointer).map((x) => x.code)).toContain("IR_POINTER"); });
test("compiler-invalid sources have corresponding terminal IR rejection families", async () => { const open = '<oven id="test" version="1.0.0" contract="checklist-progress@1" theme="checklist">', close = '</oven>'; const rows: Array<[string, string, (ir: any) => void, string]> = [
  [open + '<grid columns="0"/>' + close, "SCALAR_INTEGER", (ir) => { ir.root[0].kind = "grid"; ir.root[0].attributes = { columns: 0 }; ir.root[0].children = []; }, "IR_SCALAR"],
  [open + '<text slot="x" text="x" optional="wat"/>' + close, "SCALAR_BOOLEAN", (ir) => { ir.root[0].attributes.optional = "wat"; }, "IR_SCALAR"],
  [open + '<log-table source="bad"/>' + close, "SCALAR_POINTER", (ir) => { ir.root[0].attributes.source = "bad"; }, "IR_POINTER"],
  [open + '<icon slot="x" name="Nope"/>' + close, "REGISTRY_ICON", (ir) => { ir.root[0].kind = "icon"; ir.root[0].attributes = { slot: "x", name: "Nope" }; }, "IR_REGISTRY"],
  [open + '<switch mode-from="missing"><case value="x"/></switch>' + close, "REFERENCE_TARGET", (ir) => { ir.root[0].attributes.selectionFrom = "missing"; }, "IR_REF"],
  [open + '<text slot="x" text="x" source="/x"/>' + close, "GRAMMAR_TEXT", (ir) => { ir.root[0].kind = "text"; ir.root[0].attributes = { slot: "x", text: "x", source: "/x" }; }, "IR_STRUCTURE"],
  [open + '<mode-toggle id="m" initial="a" aria-label="m"><option value="a" label="A"/></mode-toggle>' + close, "STRUCTURE_OPTIONS", (ir) => { ir.root[0].kind = "mode-toggle"; ir.root[0].attributes = { id: "m", initial: "a", ariaLabel: "m" }; ir.root[0].children = []; ir.controls = []; }, "IR_STRUCTURE"],
  [open + '<pagination collection-from="x" page-sizes="1"/>' + close, "GRAMMAR_CHILD", (ir) => { ir.root[0].kind = "pagination"; ir.root[0].attributes = { collectionFrom: "x", pageSizes: "0" }; }, "IR_NODE"],
  [open + '<collection id="c" source="/x" item-key="/id" paging="bad" page-size="1"/>' + close, "INTERACTION_PAGING", (ir) => { ir.root[0].kind = "collection"; ir.root[0].attributes = { id: "c", source: "/x", itemKey: "/id", paging: "bad", pageSize: 1 }; ir.collections = []; }, "IR_STRUCTURE"],
  [open + '<switch source="/x"><case value="a"/><case value="a"/></switch>' + close, "STRUCTURE_SWITCH", (ir) => { ir.root[0].kind = "switch"; ir.root[0].attributes = { source: "/x" }; ir.root[0].children = [{ kind: "case", attributes: { value: "a" }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } }, { kind: "case", attributes: { value: "a" }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } }]; }, "IR_STRUCTURE"],
  [open + '<grid columns="1"><panel id="p" column="2" row="1"/></grid>' + close, "STRUCTURE_GRID_BOUNDS", (ir) => { ir.root[0].kind = "grid"; ir.root[0].attributes = { columns: 1 }; ir.root[0].children = [{ kind: "panel", attributes: { id: "p", column: 2, row: 1 }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } }]; }, "IR_STRUCTURE"],
  [open + '<grid columns="2"><panel id="a" column="1" row="1"/><panel id="b" column="1" row="1"/></grid>' + close, "STRUCTURE_GRID_OVERLAP", (ir) => { ir.root[0].kind = "grid"; ir.root[0].attributes = { columns: 2 }; ir.root[0].children = [{ kind: "panel", attributes: { id: "a", column: 1, row: 1 }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } }, { kind: "panel", attributes: { id: "b", column: 1, row: 1 }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } }]; }, "IR_STRUCTURE"],
  [open + '<metric-tiles source="/x" selection-from="x"/>' + close, "PROPS_REQUIRED", (ir) => { ir.root[0].kind = "metric-tiles"; ir.root[0].attributes = { source: "/x", selectionFrom: "x" }; ir.root[0].children = []; }, "IR_BINDING"],
  [open + '<collection id="c" source="/x" item-key="/id" paging="auto" page-size="1"><each><search id="s" placeholder="x" aria-label="x" match-fields="/x"/></each></collection>' + close, "GRAMMAR_CHILD", (ir) => { ir.root[0].kind = "collection"; ir.root[0].attributes = { id: "c", source: "/x", itemKey: "/id", paging: "auto", pageSize: 1 }; ir.root[0].children = [{ kind: "each", attributes: {}, bindings: {}, children: [{ kind: "search", attributes: { id: "s", placeholder: "x", ariaLabel: "x", matchFields: "/x" }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } }], source: { offset: 0, line: 1, column: 1 } }]; ir.collections = []; }, "IR_STRUCTURE"],
  [open + '<box element="bad"/>' + close, "SCALAR_ELEMENT", (ir) => { ir.root[0].kind = "box"; ir.root[0].attributes = { element: "bad" }; }, "IR_SCALAR"],
]; for (const [source, sourceCode, mutate, terminalCode] of rows) { const compiled = await compile(source); expect(compiled.ok).toBeFalse(); expect(compiled.diagnostics.some((diagnostic: any) => diagnostic.code === sourceCode)).toBeTrue(); const ir: any = structuredClone(await official("checklist")); mutate(ir); const codes = validateTerminalOvenIR(ir).map((diagnostic) => diagnostic.code); if (terminalCode === "IR_SCALAR") expect(codes.some((code) => code === "IR_SCALAR" || code === "IR_ATTRIBUTE")).toBeTrue(); else expect(codes).toContain(terminalCode); } });
test("capabilities are opt-in, closed, and distinguish grammar from component requirements", async () => { const ir = await official("checklist"); expect(admitTerminalOven(ir, { status: "ready", payload: {} }).status).toBe("unsupported"); expect(admitTerminalOven(ir, { status: "ready", payload: {} }, undefined, [], { ...capabilities(ir), components: [] }).status).toBe("unsupported"); expect(admitTerminalOven(ir, { status: "ready", payload: {} }, undefined, [], { ...capabilities(ir), kinds: ["not-a-kind"] }).diagnostics[0]?.code).toBe("CAPABILITIES"); expect(admitTerminalOven(ir, { status: "ready", payload: {} }, undefined, [], capabilities(ir)).status).toBe("ready"); });
test("status envelope preserves numeric revisions and only exposes stale payload when ready", async () => { const ir = await official("checklist"), caps = capabilities(ir), stale = { payload: { good: true }, payloadRevision: 2 }; expect(admitTerminalOven(ir, { status: "empty", empty: true, payload: {} }, undefined, [], caps).diagnostics[0]?.code).toBe("EMPTY_EXPLICIT"); expect(admitTerminalOven(ir, { status: "error", refresh: { phase: "failed", generation: 0, stale: false } }, undefined, [], caps).diagnostics[0]?.code).toBe("ERROR_DIAGNOSTIC"); expect(admitTerminalOven(ir, { status: "unsupported" }, undefined, [], caps).diagnostics[0]?.code).toBe("ENVELOPE_STATUS"); for (const revision of ["2", -1]) expect(admitTerminalOven(ir, { status: "ready", payload: {}, payloadRevision: revision }, undefined, [], caps).diagnostics[0]?.code).toBe("PAYLOAD_REVISION"); expect(admitTerminalOven(ir, { status: "ready", payload: {}, payloadRevision: 0 }, undefined, [], caps).payloadRevision).toBe(0); expect(admitTerminalOven(ir, { status: "loading", payload: {} }, undefined, [], caps).diagnostics[0]?.code).toBe("REFRESH_STATE"); expect(admitTerminalOven(ir, { status: "loading" }, undefined, [], caps).status).toBe("loading"); for (const [status, phase] of [["loading", "loading"], ["error", "failed"]] as const) { const result = admitTerminalOven(ir, { status, ...stale, diagnostics: status === "error" ? [{ code: "NET", message: "later" }] : [], refresh: { phase, generation: 2, stale: true } }, undefined, [], caps); expect(result.status).toBe("ready"); expect(result.payloadRevision).toBe(2); } });
test("state normalization snapshots data, clamps source pages, and omits invalid server pages", () => { const accessor = Object.create(null, { viewport: { enumerable: true, get() { throw new Error("read"); } } }); expect(normalizeTerminalState(accessor, ["first"]).focusId).toBe("first"); const got = normalizeTerminalState({ viewport: { width: -1, height: 2 }, focusId: "bad", expandedKeys: ["a", "a"], diagnostics: [{ code: 1, message: "bad" }], selections: { x: "one", bad: 2 }, collections: { rows: { pageIndex: 9, pageSize: 7, serverPage: { page: 1, pageSize: 5, pageCount: 2, total: 9 }, expandedKeys: ["x", "x"] }, bad: { pageIndex: 2, pageSize: 2, serverPage: { page: 0, pageSize: 0, pageCount: 0, total: -1 } } } }, ["first", "first", "second"]); expect(got).toEqual({ viewport: { width: 80, height: 2 }, controls: {}, collections: { rows: { pageIndex: 1, pageSize: 5, serverPage: { page: 1, pageSize: 5, pageCount: 2, total: 9 }, expandedKeys: ["x"] }, bad: { pageIndex: 2, pageSize: 2 } }, selections: { x: "one" }, focusId: "first", expandedKeys: ["a"], diagnostics: [] }); });
test("retained IR integers reject unsafe values", async () => {
  const unsafe = 2 ** 53, compiled = await compile('<oven id="safe-integers" version="1.0.0" contract="checklist-progress@1" theme="checklist"><collection id="rows" source="/rows" item-key="/id" paging="auto" page-size="25"><each><kpi-item id="row" value="@item/value"/></each></collection></oven>');
  expect(compiled.ok).toBeTrue();
  const refresh: any = structuredClone(compiled.ir); refresh.refreshSeconds = unsafe;
  const source: any = structuredClone(compiled.ir); source.root[0].source.offset = unsafe;
  const attribute: any = structuredClone(compiled.ir); attribute.root[0].attributes.pageSize = unsafe;
  const declaration: any = structuredClone(compiled.ir); declaration.collections[0].pageSize = unsafe;
  expect(validateTerminalOvenIR(refresh).map((x) => x.code)).toContain("IR_REFRESH");
  expect(validateTerminalOvenIR(source).map((x) => x.code)).toContain("IR_SOURCE");
  expect(validateTerminalOvenIR(attribute).map((x) => x.code)).toContain("IR_SCALAR");
  expect(validateTerminalOvenIR(declaration).map((x) => x.code)).toContain("IR_COLLECTION");
});
+test("collection normalization owns hostile keys and rebuilds server pages", () => {
  const collections = Object.create(null);
  Object.defineProperty(collections, "__proto__", { enumerable: true, value: { pageIndex: 4, pageSize: 6, serverPage: { page: 1, pageSize: 5, pageCount: 1, total: 9, extra: "drop", callback: () => {} } } });
  const state = normalizeTerminalState({ collections }, []);
  expect(Object.getPrototypeOf(state.collections)).toBe(Object.prototype);
  expect(Object.hasOwn(state.collections, "__proto__")).toBeTrue();
  expect(state.collections["__proto__"]).toEqual({ pageIndex: 1, pageSize: 5, serverPage: { page: 1, pageSize: 5, pageCount: 1, total: 9 } });
  expect(isJsonValue(state)).toBeTrue();
});
+test("state controls and server pages follow reducer value semantics", () => {
  const unsafe = 2 ** 53, controls = Object.create(null, { visible: { enumerable: true, value: "ok" }, active: { enumerable: true, value: true }, number: { enumerable: true, value: 1 }, nil: { enumerable: true, value: null }, object: { enumerable: true, value: {} }, array: { enumerable: true, value: [] } });
  const state = normalizeTerminalState({ controls, collections: { retained: { pageIndex: 8, pageSize: 7, serverPage: { page: 1, pageSize: 5, pageCount: 1, total: 9 } }, unsafe: { pageIndex: 3, pageSize: 4, serverPage: { page: unsafe, pageSize: 5, pageCount: 1, total: 9 } }, signed: { pageIndex: 2, pageSize: 3, serverPage: { page: 0, pageSize: 5, pageCount: 1, total: -1 } } } }, []);
  expect(state.controls).toEqual({ visible: "ok", active: true });
  expect(state.collections).toEqual({ retained: { pageIndex: 1, pageSize: 5, serverPage: { page: 1, pageSize: 5, pageCount: 1, total: 9 } }, unsafe: { pageIndex: 3, pageSize: 4 }, signed: { pageIndex: 2, pageSize: 3 } });
});
+test("compiler-emitted empty optional registry attributes remain terminal-safe", async () => {
  const source = '<oven id="optional-empty" version="1.0.0" contract="checklist-progress@1" theme="checklist"><kpi-strip><kpi-item value="Value" format="" icon="" variant=""/></kpi-strip></oven>', result = await compile(source);
  expect(result.ok).toBeTrue();
  expect(result.ir.root[0].children[0].attributes).toMatchObject({ format: "", icon: "", variant: "" });
  expect(result.ir.requirements.formats).toEqual([]);
  expect(result.ir.requirements.icons).toEqual([]);
  expect(validateTerminalOvenIR(result.ir)).toEqual([]);
  const hostile = structuredClone(result.ir) as any; Object.assign(hostile.root[0].children[0].attributes, { format: "not-a-format", icon: "NotAnIcon", variant: "not-a-variant" });
  expect(validateTerminalOvenIR(hostile).map((item) => item.code)).toEqual(expect.arrayContaining(["IR_REGISTRY", "IR_SCALAR"]));
  const invalid = await compile('<oven id="optional-hostile" version="1.0.0" contract="checklist-progress@1" theme="checklist"><kpi-strip><kpi-item value="Value" format="not-a-format" icon="NotAnIcon" variant="not-a-variant"/></kpi-strip></oven>');
  expect(invalid.ok).toBeFalse();
  expect(invalid.diagnostics.map((item: any) => item.code)).toEqual(expect.arrayContaining(["REGISTRY_FORMAT", "REGISTRY_ICON", "SCALAR_VARIANT"]));
});
+test("column source is item-scoped and compiler aliases plain format to identity", async () => {
  const source = '<oven id="column-source" version="1.0.0" contract="checklist-progress@1" theme="checklist"><log-table source="/rows"><column label="Value" source="@item/value" format="plain"/></log-table></oven>', result = await compile(source);
  expect(result.ok).toBeTrue();
  expect(result.ir.root[0].children[0].attributes.format).toBe("identity");
  expect(result.ir.requirements.formats).toEqual(["identity"]);
  expect(validateTerminalOvenIR(result.ir)).toEqual([]);
  const attr = structuredClone(result.ir) as any; attr.root[0].children[0].attributes.format = "plain";
  expect(validateTerminalOvenIR(attr).map((item) => item.code)).toContain("IR_REGISTRY");
  const binding = await compile('<oven id="plain-bind" version="1.0.0" contract="checklist-progress@1" theme="checklist"><section-header title="Title"><bind prop="title" source="/title" format="plain"/></section-header></oven>');
  expect(binding.ok).toBeTrue();
  const malformedChild = structuredClone(binding.ir) as any; malformedChild.root[0].children[0].attributes.format = "plain";
  expect(validateTerminalOvenIR(malformedChild).map((item) => item.code)).toContain("IR_REGISTRY");
  const malformedMap = structuredClone(binding.ir) as any; malformedMap.root[0].bindings.title.format = "plain";
  expect(validateTerminalOvenIR(malformedMap).map((item) => item.code)).toContain("IR_BINDING");
});
test("descriptor-safe JSON rejects hidden properties without normalizing them", () => {
  const root: Record<string, unknown> = {}, nested = { value: {} as Record<string, unknown> }, state: Record<string, unknown> = {};
  Object.defineProperty(root, "hidden", { value: true });
  Object.defineProperty(nested.value, "hidden", { value: true });
  Object.defineProperty(state, "viewport", { value: { width: 5, height: 6 } });
  expect(isJsonValue(root)).toBeFalse();
  expect(isJsonValue(nested)).toBeFalse();
  expect(normalizeTerminalState(state, []).viewport).toEqual({ width: 80, height: 24 });
});
test("queued reducer rejection envelopes retain diagnostic metadata coherently", async () => {
  const ir = await official("checklist"), caps = capabilities(ir), error = { code: "NET", message: "later" };
  expect(admitTerminalOven(ir, { status: "loading", refresh: { phase: "queued", generation: 2, stale: false, error } }, undefined, [], caps).status).toBe("loading");
  expect(admitTerminalOven(ir, { status: "loading", payload: {}, refresh: { phase: "queued", generation: 2, stale: true, error } }, undefined, [], caps).status).toBe("ready");
  for (const phase of ["idle", "loading", "running"] as const) expect(admitTerminalOven(ir, { status: "error", refresh: { phase, generation: 2, stale: false, error } }, undefined, [], caps).diagnostics[0]?.code).toBe("ENVELOPE_REFRESH");
});
test("source validator rejects unsafe integers and compiled optional false bindings remain exact", async () => {
  const unsafe = 2 ** 53, invalid = await compile(`<oven id="unsafe" version="1.0.0" contract="checklist-progress@1" theme="checklist"><collection id="rows" source="/rows" item-key="/id" paging="auto" page-size="${unsafe}"/></oven>`);
  expect(invalid.ok).toBeFalse();
  expect(invalid.diagnostics.some((item: any) => item.code === "SCALAR_INTEGER")).toBeTrue();
  const valid = await compile('<oven id="optional-false" version="1.0.0" contract="checklist-progress@1" theme="checklist"><section-header title="Title"><bind prop="title" source="/title" optional="false"/></section-header></oven>');
  expect(valid.ok).toBeTrue();
  expect(valid.ir.root[0].bindings.title.optional).toBeFalse();
  expect(validateTerminalOvenIR(valid.ir)).toEqual([]);
});
test("only source attributes treat @item as a pointer and IR attributes use compiler keys and values", async () => {
  const literal = await compile('<oven id="literals" version="1.0.0" contract="checklist-progress@1" theme="checklist"><section-header title="@item/title"><text slot="title" text="@item/text"/></section-header><log-table source="/rows"><column label="@item/label" source="/value"/></log-table></oven>');
  expect(literal.ok).toBeTrue();
  expect(validateTerminalOvenIR(literal.ir)).toEqual([]);
  const typed = structuredClone(literal.ir) as any; typed.root[0].attributes.title = 7;
  expect(validateTerminalOvenIR(typed).map((item) => item.code)).toContain("IR_SCALAR");
  const mode = await compile('<oven id="mode-key" version="1.0.0" contract="checklist-progress@1" theme="checklist"><field-toolbar id="toolbar"><mode-toggle id="mode" initial="one" aria-label="Mode"><option value="one" label="One"/><option value="two" label="Two"/></mode-toggle></field-toolbar></oven>');
  expect(mode.ok).toBeTrue();
  const hyphenated = structuredClone(mode.ir) as any; hyphenated.root[0].children[0].attributes["aria-label"] = hyphenated.root[0].children[0].attributes.ariaLabel; delete hyphenated.root[0].children[0].attributes.ariaLabel;
  expect(validateTerminalOvenIR(hyphenated).map((item) => item.code)).toContain("IR_ATTRIBUTE");
});
test("proxy rejection is trap-free at root and nested boundaries", () => {
  let rootHits = 0, nestedHits = 0;
  const hostile = (count: () => void) => new Proxy({}, { get() { count(); return undefined; }, getPrototypeOf() { count(); return null; }, ownKeys() { count(); return []; } });
  expect(isJsonValue(hostile(() => { rootHits += 1; }))).toBeFalse();
  expect(rootHits).toBe(0);
  expect(isJsonValue({ nested: hostile(() => { nestedHits += 1; }) })).toBeFalse();
  expect(nestedHits).toBe(0);
});
test("envelope refresh table accepts reducer states and rejects incoherent transitions", async () => {
  const ir = await official("checklist"), caps = capabilities(ir), diagnostic = { code: "NET", message: "later" };
  for (const phase of ["loading", "queued", "running"] as const) expect(admitTerminalOven(ir, { status: "loading", refresh: { phase, generation: 1, stale: false } }, undefined, [], caps).status).toBe("loading");
  expect(admitTerminalOven(ir, { status: "error", diagnostics: [diagnostic], refresh: { phase: "failed", generation: 1, stale: false } }, undefined, [], caps).status).toBe("error");
  for (const phase of ["loading", "queued", "running"] as const) expect(admitTerminalOven(ir, { status: "loading", payload: {}, refresh: { phase, generation: 1, stale: true } }, undefined, [], caps).status).toBe("ready");
  expect(admitTerminalOven(ir, { status: "error", payload: {}, refresh: { phase: "failed", generation: 1, stale: true, error: diagnostic } }, undefined, [], caps).status).toBe("ready");
  expect(admitTerminalOven(ir, { status: "ready", payload: {}, refresh: { phase: "queued", generation: 1, stale: false } }, undefined, [], caps).status).toBe("ready");
  const invalid = [
    { status: "loading", refresh: { phase: "loading", generation: 1, stale: true } },
    { status: "loading", payload: {}, refresh: { phase: "failed", generation: 1, stale: true } },
    { status: "error", payload: {}, refresh: { phase: "loading", generation: 1, stale: true } },
    { status: "ready", payload: {}, refresh: { phase: "loading", generation: 1, stale: false, error: diagnostic } },
  ];
  for (const envelope of invalid) expect(admitTerminalOven(ir, envelope, undefined, [], caps).diagnostics[0]?.code).toMatch(/ENVELOPE_REFRESH|REFRESH_STATE/);
});
test("state normalization drops unsafe retained integers", () => {
  const unsafe = 2 ** 53, result = normalizeTerminalState({ viewport: { width: unsafe, height: unsafe }, collections: { rows: { pageIndex: unsafe, pageSize: unsafe } } }, []);
  expect(result.viewport).toEqual({ width: 80, height: 24 });
  expect(result.collections.rows).toEqual({ pageIndex: 0, pageSize: 25 });
});
test("envelope is closed, constrains empty, and rejects unsafe metadata integers", async () => {
  const ir = await official("checklist"), caps = capabilities(ir), unsafe = 2 ** 53;
  expect(admitTerminalOven(ir, { status: "ready", payload: {}, unknown: true }, undefined, [], caps).diagnostics[0]?.code).toBe("ENVELOPE_FIELDS");
  expect(admitTerminalOven(ir, { status: "empty", empty: true }, undefined, [], caps).status).toBe("empty");
  for (const envelope of [{ status: "loading", empty: false }, { status: "error", empty: false }, { status: "ready", payload: {}, empty: false }]) expect(admitTerminalOven(ir, envelope, undefined, [], caps).diagnostics[0]?.code).toBe("EMPTY_EXPLICIT");
  expect(admitTerminalOven(ir, { status: "ready", payload: {}, payloadRevision: unsafe }, undefined, [], caps).diagnostics[0]?.code).toBe("PAYLOAD_REVISION");
  expect(admitTerminalOven(ir, { status: "loading", refresh: { phase: "loading", generation: unsafe, stale: false } }, undefined, [], caps).diagnostics[0]?.code).toBe("ENVELOPE_REFRESH");
});
