import assert from "node:assert/strict";
import { test } from "node:test";
import { runCollection } from "./collection-pipeline";
import { initOvenState, ovenReducer, type OvenIr } from "./oven-reducer";
import { selectCollection } from "./oven-selectors";
import { resolvePointer } from "../utils/json-pointer";
import { readFileSync } from "node:fs";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { initTerminalRuntime, reduceTerminalRuntime } from "../../../../tui/src/oven-runtime/state-runtime";
import { runTerminalCollection, selectTerminalCollection } from "../../../../tui/src/oven-runtime/collection-runtime";

const contract = "burnlist-differential-testing-data@1";
const source = { offset: 0, line: 1, column: 1 };
const attributes = { id: "items", source: "/items", itemKey: "/id", pageSize: 2, searchFrom: "search", sortFrom: "sort", filterFrom: "filter", paging: "client" };
const terminalIr = { schema: "burnlist-oven-ir@1", id: "state-runtime", version: "1.0.0", contract, theme: "differential-testing", root: [{ kind: "mode-toggle", attributes: { id: "mode" }, bindings: {}, source, children: [{ kind: "option", attributes: { value: "a" }, bindings: {}, source, children: [] }, { kind: "option", attributes: { value: "b" }, bindings: {}, source, children: [] }] }, { kind: "collection", attributes, bindings: {}, source, children: [] }], controls: [{ id: "mode", kind: "mode-toggle", initial: "a" }, { id: "search", kind: "search", matchFields: "/label" }, { id: "sort", kind: "sort-toggle", key: "changed", initial: "on", requiresSource: "/available", requiresValue: true }, { id: "filter", kind: "filter-toggle", key: "non-pass", initial: "off" }, { id: "domain", kind: "domain-tabs", source: "/domains", initialSource: "/initial" }], collections: [{ id: "items", source: "/items", itemKey: "/id", pageSize: 2, paging: "client" }], requirements: { components: [], formats: [], icons: [], selectors: [] } } as any;
const consoleIr: OvenIr = { contract, controls: terminalIr.controls, collections: [{ ...attributes }], root: terminalIr.root as any };
const payload = { available: true, domains: [{ id: "one" }, { id: "two" }], initial: "two", telemetry: { fields: [{ id: "first", failToPassCount: 0, passToFailCount: 0 }, { id: "second", failToPassCount: 3, passToFailCount: 0 }] }, items: [{ id: "first", label: "Alpha", failedSampleCount: 0, missingSampleCount: 0, telemetry: { failToPassCount: 2, passToFailCount: 0 } }, { id: "second", label: "Beta", failedSampleCount: 1, missingSampleCount: 0, telemetry: { failToPassCount: 1, passToFailCount: 1 } }, { id: "third", label: "Gamma", failedSampleCount: 0, missingSampleCount: 2, telemetry: { failToPassCount: 0, passToFailCount: 0 } }] };
const pick = (state: any) => ({ controls: state.controls, collection: { pageIndex: state.collections.items.pageIndex, pageSize: state.collections.items.pageSize }, expanded: [...(state.expanded ?? state.expandedKeys)].sort() });

test("terminal state and collection execute against independent console authorities", () => {
  let consoleState = initOvenState(consoleIr, payload), terminalState = initTerminalRuntime(terminalIr, payload);
  assert.deepEqual(pick(terminalState), pick(consoleState));
  const actions = [{ type: "modeSelected", id: "mode", value: "b" }, { type: "domainSelected", id: "domain", selectedId: "one", value: "one" }, { type: "queryChanged", id: "search", query: "a", value: "a" }, { type: "toggleChanged", id: "filter", active: true }, { type: "toggleChanged", id: "sort", active: true }, { type: "pageNext", collectionId: "items" }, { type: "pageSizeChanged", collectionId: "items", pageSize: 1 }, { type: "toggleExpanded", key: "second" }] as const;
  for (const action of actions) { consoleState = ovenReducer(consoleState, action as any, consoleIr); terminalState = reduceTerminalRuntime(terminalState, action.type === "domainSelected" ? { type: action.type, id: action.id, value: action.value } : action as any, terminalIr); }
  assert.deepEqual(pick(terminalState), pick(consoleState));
  const consolePage = selectCollection(consoleState, consoleIr, "items", resolvePointer), terminalPage = selectTerminalCollection(terminalIr, terminalState.payload, terminalState.controls, terminalIr.collections[0], terminalState.collections.items);
  assert.deepEqual({ ...terminalPage, itemKeys: undefined }, { ...consolePage, itemKeys: undefined });
  assert.deepEqual(runTerminalCollection(payload.items, { contract, query: "a", matchFields: "/label", filterKey: "non-pass", filterActive: true, sortKey: "changed", sortActive: true }), runCollection(payload.items, { contract, query: "a", matchFields: "/label", filter: { key: "non-pass" }, sort: { key: "changed" } }, resolvePointer));
});

test("official compiled DT auto metadata and malformed fallback agree", () => {
  const compiled = compileOven(readFileSync("ovens/differential-testing/differential-testing.oven", "utf8")); assert.equal(compiled.ok, true);
  const ir = compiled.ir as any, data = { telemetry: { status: "comparable", fields: [] }, fields: [{ id: "one", label: "One" }], __burnlistOvenRuntime: { collectionPages: { "/fields": { page: 1, pageSize: 25, pageCount: 3, total: 51 } } } };
  let consoleState = initOvenState(ir, data), terminalState = initTerminalRuntime(ir, data);
  assert.equal(consoleState.collections["field-view"].serverPage?.total, 51); assert.equal(terminalState.collections["field-view"].serverPage?.total, 51);
  consoleState = ovenReducer(consoleState, { type: "payloadAccepted", payload: { ...data, __burnlistOvenRuntime: { collectionPages: { "/fields": { page: -1 } } } } } as any, ir);
  terminalState = reduceTerminalRuntime(terminalState, { type: "payloadAccepted", payload: { ...data, __burnlistOvenRuntime: { collectionPages: { "/fields": { page: -1 } } } } } as any, ir);
  assert.equal(consoleState.collections["field-view"].pageIndex, terminalState.collections["field-view"].pageIndex); assert.equal(terminalState.collections["field-view"].serverPage, undefined);
});

test("compiled client/server/auto paging and malformed metadata matrix have identical pages", () => {
  const official = readFileSync("ovens/differential-testing/differential-testing.oven", "utf8");
  const payload = (page: unknown) => ({ telemetry: { status: "comparable", fields: [{ id: "a", failToPassCount: 1, passToFailCount: 0 }, { id: "b", failToPassCount: 1, passToFailCount: 0 }] }, fields: [{ id: "a", label: "A" }, { id: "b", label: "B" }], __burnlistOvenRuntime: { collectionPages: { "/fields": page } } });
  const valid = { page: 1, pageSize: 10, pageCount: 3, total: 22 };
  for (const paging of ["client", "server", "auto"] as const) {
    const result = compileOven(official.replace('paging="auto"', `paging="${paging}"`)); assert.equal(result.ok, true, paging); const ir = result.ir as any;
    const consoleState = initOvenState(ir, payload(valid)), terminalState = initTerminalRuntime(ir, payload(valid));
    const consolePage = selectCollection(consoleState, ir, "field-view", resolvePointer), terminalPage = selectTerminalCollection(ir, terminalState.payload, terminalState.controls, ir.collections[0], terminalState.collections["field-view"]);
    assert.equal(consolePage.totalCount, paging === "client" ? 2 : 22); assert.deepEqual({ pageItems: terminalPage.pageItems, pageIndex: terminalPage.pageIndex, pageCount: terminalPage.pageCount, pageSize: terminalPage.pageSize, totalCount: terminalPage.totalCount }, consolePage);
  }
  const malformed = [{ page: -1, pageSize: 1, pageCount: 1, total: 1 }, { page: 0.5, pageSize: 1, pageCount: 1, total: 1 }, { page: 0, pageSize: 0, pageCount: 1, total: 1 }, { page: 0, pageSize: 1, pageCount: 0, total: 1 }, { page: 0, pageSize: 1, pageCount: 1, total: -1 }, { page: 0, pageSize: "x", pageCount: 1, total: 1 }, {}];
  const result = compileOven(official); assert.equal(result.ok, true); const ir = result.ir as any;
  for (const page of malformed) { const consoleState = initOvenState(ir, payload(page)), terminalState = initTerminalRuntime(ir, payload(page)); const consolePage = selectCollection(consoleState, ir, "field-view", resolvePointer), terminalPage = selectTerminalCollection(ir, terminalState.payload, terminalState.controls, ir.collections[0], terminalState.collections["field-view"]); assert.equal(terminalState.collections["field-view"].serverPage, undefined); assert.deepEqual({ pageItems: terminalPage.pageItems, pageIndex: terminalPage.pageIndex, pageCount: terminalPage.pageCount, pageSize: terminalPage.pageSize, totalCount: terminalPage.totalCount }, consolePage); }
});

test("official production controls retain, seed, and clamp identically", () => {
  const dtSource = readFileSync("ovens/differential-testing/differential-testing.oven", "utf8"), compiled = compileOven(dtSource); assert.equal(compiled.ok, true); const dt = compiled.ir as any;
  const undefinedConsole = initOvenState(dt, undefined), undefinedTerminal = initTerminalRuntime(dt, undefined); assert.equal(undefinedConsole.controls["changed-sort"], true); assert.equal(undefinedTerminal.controls["changed-sort"], true);
  for (const paging of ["auto", "server"] as const) {
    const result = compileOven(dtSource.replace('paging="auto"', `paging="${paging}"`)); assert.equal(result.ok, true); const ir = result.ir as any;
    const seeded = { telemetry: { status: "comparable", fields: [{ id: "a", failToPassCount: 1, passToFailCount: 0 }] }, fields: [{ id: "a", label: "A" }], __burnlistOvenRuntime: { collectionPages: { "/fields": { page: 1, pageSize: 25, pageCount: 2, total: 30 } } } };
    let consoleState = initOvenState(ir, seeded), terminalState = initTerminalRuntime(ir, seeded); assert.ok(consoleState.collections["field-view"].serverPage); assert.ok(terminalState.collections["field-view"].serverPage); assert.equal(consoleState.controls["changed-sort"], true);
    const blocked = { telemetry: { status: "blocked", fields: [] }, fields: [{ id: "a", label: "A" }] }; consoleState = ovenReducer(consoleState, { type: "payloadAccepted", payload: blocked } as any, ir); terminalState = reduceTerminalRuntime(terminalState, { type: "payloadAccepted", payload: blocked } as any, ir); assert.equal(consoleState.controls["changed-sort"], true); assert.equal(terminalState.controls["changed-sort"], true);
  }
  let consoleState = initOvenState(dt, { telemetry: { status: "comparable", fields: [] }, fields: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }] }), terminalState = initTerminalRuntime(dt, { telemetry: { status: "comparable", fields: [] }, fields: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }] });
  consoleState = ovenReducer(consoleState, { type: "modeSelected", id: "progress-mode", value: "failed" }, dt); terminalState = reduceTerminalRuntime(terminalState, { type: "modeSelected", id: "progress-mode", value: "failed" }, dt); consoleState = ovenReducer(consoleState, { type: "payloadAccepted", payload: { telemetry: { status: "comparable", fields: [] }, fields: [{ id: "a", label: "A" }] } }, dt); terminalState = reduceTerminalRuntime(terminalState, { type: "payloadAccepted", payload: { telemetry: { status: "comparable", fields: [] }, fields: [{ id: "a", label: "A" }] } }, dt); assert.equal(consoleState.controls["progress-mode"], terminalState.controls["progress-mode"]);
  const clientResult = compileOven(dtSource.replace('paging="auto"', 'paging="client"')); assert.equal(clientResult.ok, true); const client = clientResult.ir as any, many = { telemetry: { status: "blocked", fields: [] }, fields: [{ id: "a" }, { id: "b" }, { id: "c" }] }; consoleState = initOvenState(client, many); terminalState = initTerminalRuntime(client, many); for (const action of [{ type: "pageSizeChanged", collectionId: "field-view", pageSize: 1 }, { type: "pageNext", collectionId: "field-view" }, { type: "pageNext", collectionId: "field-view" }] as const) { consoleState = ovenReducer(consoleState, action, client); terminalState = reduceTerminalRuntime(terminalState, action, client); } consoleState = ovenReducer(consoleState, { type: "payloadAccepted", payload: { ...many, fields: [{ id: "a" }] } }, client); terminalState = reduceTerminalRuntime(terminalState, { type: "payloadAccepted", payload: { ...many, fields: [{ id: "a" }] } }, client); const cp = selectCollection(consoleState, client, "field-view", resolvePointer), tp = selectTerminalCollection(client, terminalState.payload, terminalState.controls, client.collections[0], terminalState.collections["field-view"]); assert.equal(cp.pageIndex, 0); assert.deepEqual({ pageItems: tp.pageItems, pageIndex: tp.pageIndex, pageCount: tp.pageCount, pageSize: tp.pageSize, totalCount: tp.totalCount }, cp);
});

test("official visual domains retain then fall back identically", () => {
  const result = compileOven(readFileSync("ovens/visual-parity/visual-parity.oven", "utf8")); assert.equal(result.ok, true); const ir = result.ir as any;
  const payload = (domains: string[], initial = "one") => ({ domains: domains.map((id) => ({ id })), initialDomainId: initial }); let consoleState = initOvenState(ir, payload(["one", "two"])), terminalState = initTerminalRuntime(ir, payload(["one", "two"]));
  consoleState = ovenReducer(consoleState, { type: "domainSelected", id: "domain-select", selectedId: "two" }, ir); terminalState = reduceTerminalRuntime(terminalState, { type: "domainSelected", id: "domain-select", value: "two" }, ir); for (const next of [payload(["one", "two"]), payload(["one"])]) { consoleState = ovenReducer(consoleState, { type: "payloadAccepted", payload: next }, ir); terminalState = reduceTerminalRuntime(terminalState, { type: "payloadAccepted", payload: next }, ir); assert.equal(consoleState.controls["domain-select"], terminalState.controls["domain-select"]); }
});
