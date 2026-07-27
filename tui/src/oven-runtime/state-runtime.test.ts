import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initTerminalRuntime, reduceTerminalRuntime, selectDomain, selectExpanded, selectFocus, selectMode } from "./state-runtime";
import type { TerminalOvenIR } from "./terminal-contract";
// @ts-expect-error Production compiler is JavaScript.
import { compileOven } from "../../../src/ovens/dsl/oven-compile.mjs";

const ir = { schema: "burnlist-oven-ir@1", id: "example", version: "1.0.0", contract: "burnlist-differential-testing-data@1", theme: "default", root: [{ kind: "mode-toggle", attributes: { id: "mode" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [{ kind: "option", attributes: { value: "a" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }, { kind: "option", attributes: { value: "b" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }] }, { kind: "collection", attributes: { id: "items", source: "/items", pageSize: 2, searchFrom: "query", filterFrom: "filter" }, bindings: {}, source: { offset: 0, line: 1, column: 1 }, children: [] }], requirements: { components: [], formats: [], icons: [], selectors: [] }, controls: [{ id: "mode", kind: "mode-toggle", initial: "a" }, { id: "query", kind: "search" }, { id: "filter", kind: "filter-toggle", key: "non-pass" }, { id: "domain", kind: "domain-tabs", source: "/domains", initialSource: "/initial" }], collections: [{ id: "items", source: "/items", pageSize: 2 }] } as unknown as TerminalOvenIR;
const payload = { domains: [{ id: "one" }, { id: "two" }], initial: "two", items: [{ id: "a" }, { id: "b" }, { id: "c" }] } as const;

test("state retains valid choices across refresh, clamps pages, and transitions focus", () => {
  let state = initTerminalRuntime(ir, payload, ["mode", "query", "items"]);
  expect(state.controls).toMatchObject({ mode: "a", query: "", domain: "two" });
  state = reduceTerminalRuntime(state, { type: "modeSelected", id: "mode", value: "b" }, ir, ["mode", "query", "items"]);
  state = reduceTerminalRuntime(state, { type: "domainSelected", id: "domain", value: "one" }, ir, []);
  state = reduceTerminalRuntime(state, { type: "pageNext", collectionId: "items" }, ir, []);
  state = reduceTerminalRuntime(state, { type: "payloadAccepted", payload: { domains: [{ id: "one" }], initial: "one", items: [{ id: "a" }] } }, ir, []);
  expect(state.controls).toMatchObject({ mode: "b", domain: "one" }); expect(state.collections.items.pageIndex).toBe(0);
  state = reduceTerminalRuntime(state, { type: "focusNext" }, ir, ["mode", "query", "items"]);
  expect(state.focusId).toBe("query"); expect(reduceTerminalRuntime(state, { type: "focusPrevious" }, ir, ["mode", "query", "items"]).focusId).toBe("mode");
});

test("invalid actions fail closed and expansion remains immutable", () => {
  const state = initTerminalRuntime(ir, payload, ["mode"]);
  expect(reduceTerminalRuntime(state, { type: "modeSelected", id: "missing", value: "x" }, ir)).toBe(state);
  expect(reduceTerminalRuntime(state, { type: "pageSizeChanged", collectionId: "items", pageSize: 0 }, ir)).toBe(state);
  expect(reduceTerminalRuntime(state, { type: "domainSelected", id: "domain", value: "missing" }, ir)).toBe(state);
  const expanded = reduceTerminalRuntime(state, { type: "toggleExpanded", key: "row" }, ir);
  expect(expanded.expandedKeys).toEqual(["row"]); expect(expanded).not.toBe(state);
});

test("production compiled collection descriptors, payload metadata, availability, and focus reconcile", () => {
  const compiled = compileOven(readFileSync(fileURLToPath(new URL("../../../ovens/differential-testing/differential-testing.oven", import.meta.url)), "utf8"));
  expect(compiled.ok).toBe(true); const production = compiled.ir as TerminalOvenIR;
  const data = { telemetry: { status: "comparable" }, fields: [{ id: "a", label: "A" }], __burnlistOvenRuntime: { collectionPages: { "/fields": { page: 1, pageSize: 50, pageCount: 3, total: 101 } } } } as const;
  let state = initTerminalRuntime(production, data, ["field-search", "changed-sort"]);
  expect(state.collections["field-view"]).toMatchObject({ pageIndex: 1, pageSize: 50, serverPage: { total: 101 } }); expect(state.controls["changed-sort"]).toBe(true);
  state = reduceTerminalRuntime(state, { type: "payloadAccepted", payload: { ...data, telemetry: { status: "blocked" }, __burnlistOvenRuntime: { collectionPages: { "/fields": { page: -1, pageSize: 0, pageCount: 0, total: -1 } } } } }, production, ["field-search"]);
  expect(state.controls["changed-sort"]).toBe(true); expect(state.collections["field-view"].serverPage).toBeUndefined(); expect(state.focusId).toBe("field-search");
});

test("undefined payload and server-seeded control retention match reducer semantics", () => {
  const undefinedState = initTerminalRuntime(ir, undefined, []); expect(undefinedState.controls.filter).toBe(false);
  const compiled = compileOven(readFileSync(fileURLToPath(new URL("../../../ovens/differential-testing/differential-testing.oven", import.meta.url)), "utf8")).ir as TerminalOvenIR;
  let state = initTerminalRuntime(compiled, { telemetry: { status: "comparable" }, fields: [], __burnlistOvenRuntime: { collectionPages: { "/fields": { page: 0, pageSize: 25, pageCount: 1, total: 0 } } } }, []);
  state = reduceTerminalRuntime(state, { type: "toggleChanged", id: "changed-sort", active: true }, compiled);
  state = reduceTerminalRuntime(state, { type: "payloadAccepted", payload: { telemetry: { status: "blocked" }, fields: [] } }, compiled);
  expect(state.controls["changed-sort"]).toBe(true); expect(selectMode(state, "missing")).toBeUndefined(); expect(selectDomain(state, "missing")).toBeUndefined(); expect(selectExpanded(state, "x")).toBe(false); expect(selectFocus(state)).toBeUndefined();
});
