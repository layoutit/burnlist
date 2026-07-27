import { expect, test } from "bun:test";
import { attachTransitionTelemetry, runTerminalCollection, selectTerminalCase, selectTerminalCollection } from "./collection-runtime";
import type { TerminalOvenIR } from "./terminal-contract";

const contract = "burnlist-differential-testing-data@1";
const rows = [{ id: "first", label: "Alpha", sourceOwner: "z", failedSampleCount: 0, missingSampleCount: 0, telemetry: { failToPassCount: 2, passToFailCount: 0 } }, { id: "second", label: "beta", sourceOwner: "match", failedSampleCount: 1, missingSampleCount: 0, telemetry: { failToPassCount: 1, passToFailCount: 1 } }, { id: "third", label: "alphabet", sourceOwner: "none", failedSampleCount: 0, missingSampleCount: 2, telemetry: { failToPassCount: 0, passToFailCount: 0 } }] as const;

test("paired console collection oracle preserves search/filter/stable changed sort", () => {
  const options = { contract, query: "a", matchFields: "/label", filterKey: "non-pass", filterActive: true, sortKey: "changed", sortActive: true };
  const terminal = runTerminalCollection(rows, options).map((row) => (row as { id: string }).id);
  // This vector is copied from dashboard's collection-pipeline.test.ts authority.
  expect(terminal).toEqual(["second"]);
  const tied = [...rows, { id: "fourth", label: "delta", failedSampleCount: 0, missingSampleCount: 0, telemetry: { failToPassCount: 1, passToFailCount: 1 } }];
  expect(runTerminalCollection(tied, { contract, sortKey: "changed", sortActive: true }).map((row) => (row as { id: string }).id)).toEqual(["first", "second", "fourth"]);
});

test("compiled switch selection and item keys distinguish @item from root pointers", () => {
  const node = { kind: "switch", attributes: { source: "/mode" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [{ kind: "case", attributes: { value: "detail" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }, { kind: "case", attributes: { default: true }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }] } as unknown as TerminalOvenIR["root"][number];
  expect(selectTerminalCase(node, { mode: "detail" }, {} )?.attributes.value).toBe("detail"); expect(selectTerminalCase(node, { mode: "other" }, {})?.attributes.default).toBe(true);
  const page = selectTerminalCollection({ schema: "burnlist-oven-ir@1", id: "x", version: "1.0.0", contract, theme: "default", root: [{ kind: "collection", attributes: { id: "x", source: "/items", itemKey: "/id" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }], controls: [], collections: [{ id: "x", source: "/items", itemKey: "/id" }], requirements: { components: [], formats: [], icons: [], selectors: [] } } as TerminalOvenIR, { id: "root", items: [{ id: "row" }] }, {}, { id: "x", source: "/items", itemKey: "/id" }, { pageIndex: 0, pageSize: 1 });
  expect(page.itemKeys).toEqual(["row"]);
});

test("item identity falls back by page index and disambiguates duplicate scalar keys", () => {
  const ir = { schema: "burnlist-oven-ir@1", id: "x", version: "1.0.0", contract, theme: "default", root: [{ kind: "collection", attributes: { id: "x", source: "/items", itemKey: "/id" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }], controls: [], collections: [{ id: "x", source: "/items", itemKey: "/id" }], requirements: { components: [], formats: [], icons: [], selectors: [] } } as TerminalOvenIR;
  const page = selectTerminalCollection(ir, { items: [{ id: "same" }, { id: "same" }, { id: null }, {}] }, {}, ir.collections[0], { pageIndex: 0, pageSize: 4 });
  expect(page.itemKeys).toEqual(["same", "same#1", "@row:2", "@row:3"]);
  expect(selectTerminalCollection(ir, { items: [{ id: "same" }, { id: "same" }, { id: null }, {}] }, {}, ir.collections[0], { pageIndex: 1, pageSize: 2 }).itemKeys).toEqual(["@row:2", "@row:3"]);
  const items = [{ id: "same", failedSampleCount: 1, missingSampleCount: 0, telemetry: { failToPassCount: 1, passToFailCount: 0 } }, { id: "same", failedSampleCount: 0, missingSampleCount: 0, telemetry: { failToPassCount: 3, passToFailCount: 0 } }];
  expect(selectTerminalCollection(ir, { items }, {}, ir.collections[0], { pageIndex: 1, pageSize: 1 }).itemKeys).toEqual(["same#1"]);
  const sorted = { ...ir, root: [{ ...ir.root[0], attributes: { ...ir.root[0].attributes, sortFrom: "sort", filterFrom: "filter" } }], controls: [{ id: "sort", kind: "sort-toggle", key: "changed" }, { id: "filter", kind: "filter-toggle", key: "non-pass" }], collections: ir.collections } as TerminalOvenIR;
  expect(selectTerminalCollection(sorted, { items }, { sort: true, filter: false }, sorted.collections[0], { pageIndex: 0, pageSize: 2 }).itemKeys).toEqual(["same#1", "same"]);
});

test("sidecar telemetry and client/server/auto paging are deterministic", () => {
  const sidecar = attachTransitionTelemetry(rows, [{ id: "first", failToPassCount: 0, passToFailCount: 0 }, { id: "second", failToPassCount: 3, passToFailCount: 0 }]);
  expect(runTerminalCollection(sidecar, { contract, sortKey: "changed", sortActive: true }).map((row) => (row as { id: string }).id)).toEqual(["second"]);
  const base = { schema: "burnlist-oven-ir@1", id: "example", version: "1.0.0", contract, theme: "default", root: [{ kind: "collection", attributes: { id: "items", source: "/items", pageSize: 1, searchFrom: "search", sortFrom: "sort", paging: "client", itemKey: "/id" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }], requirements: { components: [], formats: [], icons: [], selectors: [] } } as const;
  const controls = [{ id: "search", kind: "search", matchFields: "/label" }, { id: "sort", kind: "sort-toggle", key: "changed" }] as const;
  const client = { id: "items", source: "/items", pageSize: 1, paging: "client", itemKey: "/id" } as const;
  const ir = { ...base, controls, collections: [client] } as unknown as TerminalOvenIR;
  expect(selectTerminalCollection(ir, { items: rows }, { search: "", sort: false }, client, { pageIndex: 9, pageSize: 1 }).pageIndex).toBe(2);
  for (const paging of ["server", "auto"] as const) {
    const item = { ...client, paging }; const descriptorIr = { ...ir, root: [{ ...base.root[0], attributes: { ...base.root[0].attributes, paging } }], collections: [item] } as TerminalOvenIR; const page = selectTerminalCollection(descriptorIr, { items: [rows[0]] }, { search: "", sort: false }, item, { pageIndex: 0, pageSize: 1, serverPage: { page: 2, pageSize: 50, pageCount: 3, total: 101 } });
    expect(page).toMatchObject({ pageIndex: 2, pageSize: 50, pageCount: 3, totalCount: 101, pageItems: [rows[0]] });
  }
});
