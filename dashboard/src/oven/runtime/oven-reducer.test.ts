import assert from "node:assert/strict";
import { test } from "node:test";
import { initOvenState, ovenReducer, type OvenIr } from "./oven-reducer";

const ir: OvenIr = {
  contract: "burnlist-differential-testing-data@1",
  controls: [
    { id: "mode", kind: "mode-toggle", initial: "a" }, { id: "search", kind: "search" },
    { id: "sort", kind: "sort-toggle", key: "changed", initial: "on", requiresSource: "/available", requiresValue: true },
    { id: "filter", kind: "filter-toggle", key: "non-pass", initial: "off" }, { id: "domain", kind: "domain-tabs", source: "/domains", initialSource: "/initial" },
  ], collections: [{ id: "view", source: "/items", pageSize: 2, searchFrom: "search", sortFrom: "sort", filterFrom: "filter" }],
  root: [{ kind: "mode-toggle", attributes: { id: "mode", initial: "a" }, children: [{ kind: "option", attributes: { value: "a" } }, { kind: "option", attributes: { value: "b" } }] }, { kind: "collection", attributes: { id: "view", source: "/items", pageSize: 2, searchFrom: "search", sortFrom: "sort", filterFrom: "filter" } }],
};
const payload = { available: true, domains: [{ id: "one" }, { id: "two" }], initial: "two", items: [1, 2, 3, 4, 5] };

test("reducer initializes descriptors and resets only consuming collection controls", () => {
  let state = initOvenState(ir, payload);
  assert.deepEqual(state.controls, { mode: "a", search: "", sort: true, filter: false, domain: "two" });
  state = ovenReducer(state, { type: "pageNext", collectionId: "view" }, ir);
  state = ovenReducer(state, { type: "queryChanged", id: "search", query: "x" }, ir);
  assert.equal(state.collections.view.pageIndex, 0);
  state = ovenReducer(state, { type: "modeSelected", id: "mode", value: "b" }, ir);
  state = ovenReducer(state, { type: "pageNext", collectionId: "view" }, ir);
  assert.equal(state.collections.view.pageIndex, 1);
  state = ovenReducer(state, { type: "toggleChanged", id: "filter", active: true }, ir);
  assert.equal(state.collections.view.pageIndex, 0);
  state = ovenReducer(state, { type: "pageSizeChanged", collectionId: "view", pageSize: 3 }, ir);
  assert.deepEqual(state.collections.view, { pageIndex: 0, pageSize: 3 });
});

test("initial control seeds override valid defaults and ignore invalid values", () => {
  const state = initOvenState(ir, payload, { mode: "b", filter: true, sort: false, domain: "one", unknown: true, search: true });
  assert.deepEqual(state.controls, { mode: "b", search: "", sort: false, filter: true, domain: "one" });
  const unavailable = initOvenState(ir, { ...payload, available: false }, { sort: true });
  assert.equal(unavailable.controls.sort, false);
});

test("initial page seeds attach metadata only to matching collections", () => {
  const page = { page: 1, pageSize: 25, pageCount: 3, total: 60 };
  const pagedIr: OvenIr = { ...ir, collections: [{ ...ir.collections[0], paging: "auto" }] };
  const state = initOvenState(pagedIr, { ...payload, available: false }, { sort: true }, { view: page, unknown: { page: 9, pageSize: 1, pageCount: 10, total: 10 } });
  assert.deepEqual(state.collections.view, { pageIndex: 0, pageSize: 2, serverPage: page });
  assert.notEqual(state.collections.view.serverPage, page);
  assert.equal(state.collections.unknown, undefined);
  assert.equal(state.controls.sort, true);
  const accepted = ovenReducer(state, { type: "payloadAccepted", payload: { ...payload, available: false } }, pagedIr);
  assert.equal(accepted.controls.sort, true);
});

test("payload acceptance clamps pages and retains valid controls while dropping unavailable values", () => {
  let state = initOvenState(ir, payload);
  state = ovenReducer(state, { type: "modeSelected", id: "mode", value: "b" }, ir);
  state = ovenReducer(state, { type: "domainSelected", id: "domain", selectedId: "one" }, ir);
  state = ovenReducer(state, { type: "pageNext", collectionId: "view" }, ir);
  state = ovenReducer(state, { type: "payloadRequested" }, ir);
  state = ovenReducer(state, { type: "payloadAccepted", generation: 1, payload: { available: false, domains: [{ id: "two" }], initial: "two", items: [1] } }, ir);
  assert.equal(state.payloadRevision, 1);
  assert.equal(state.controls.mode, "b");
  assert.equal(state.controls.sort, false);
  assert.equal(state.controls.domain, "two");
  assert.equal(state.collections.view.pageIndex, 0);
});

test("direct payload acceptance updates a supplied runtime payload", () => {
  const nextPayload = { available: false, domains: [{ id: "one" }], initial: "one", items: [1] };
  const state = ovenReducer(initOvenState(ir, payload), { type: "payloadAccepted", payload: nextPayload }, ir);
  assert.equal(state.payload, nextPayload);
  assert.equal(state.payloadRevision, 1);
});

test("refresh permits one queued request, rejects stale responses, and keeps last good payload on failure", () => {
  let state = initOvenState(ir, payload);
  state = ovenReducer(state, { type: "payloadRequested" }, ir);
  state = ovenReducer(state, { type: "payloadRequested" }, ir);
  assert.equal(state.refresh.phase, "queued");
  state = ovenReducer(state, { type: "payloadAccepted", generation: 0, payload: { bad: true } }, ir);
  assert.equal(state.payload, payload);
  state = ovenReducer(state, { type: "payloadAccepted", generation: 1, payload }, ir);
  assert.equal(state.refresh.phase, "queued");
  state = ovenReducer(state, { type: "payloadRequested" }, ir);
  assert.deepEqual(state.refresh, { phase: "running", error: undefined, generation: 2 });
  state = ovenReducer(state, { type: "payloadRejected", generation: 2, error: "offline" }, ir);
  assert.equal(state.refresh.phase, "failed");
  assert.equal(state.payload, payload);
});
