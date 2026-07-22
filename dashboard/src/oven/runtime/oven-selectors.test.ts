import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePointer } from "../utils/json-pointer";
import { initOvenState, type OvenIr } from "./oven-reducer";
import { selectCollection, selectDomain, selectMode, selectRefreshStatus } from "./oven-selectors";

const ir: OvenIr = { contract: "burnlist-differential-testing-data@1", controls: [{ id: "mode", kind: "mode-toggle", initial: "a" }, { id: "domain", kind: "domain-tabs", source: "/domains", initialSource: "/initial" }], collections: [{ id: "items", source: "/items", pageSize: 2 }], root: [] };
const payload = { domains: ["north", "south"], initial: "south", items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] };

test("selectors expose control and refresh state", () => {
  const state = initOvenState(ir, payload);
  assert.equal(selectMode(state, "mode"), "a");
  assert.equal(selectDomain(state, "domain"), "south");
  assert.deepEqual(selectRefreshStatus(state), { phase: "idle", error: undefined, generation: 0, stale: false });
});

test("collection selector supplies first, middle, and clamped last pages", () => {
  const state = initOvenState(ir, payload);
  assert.deepEqual(selectCollection(state, ir, "items", resolvePointer), { pageItems: [{ id: 1 }, { id: 2 }], pageIndex: 0, pageCount: 3, pageSize: 2, totalCount: 5 });
  state.collections.items.pageIndex = 1;
  assert.deepEqual(selectCollection(state, ir, "items", resolvePointer).pageItems, [{ id: 3 }, { id: 4 }]);
  state.collections.items.pageIndex = 9;
  state.payload = { ...payload, items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const result = selectCollection(state, ir, "items", resolvePointer);
  assert.equal(result.pageIndex, 1);
  assert.deepEqual(result.pageItems, [{ id: 3 }]);
});

test("auto and server paging return the supplied slice and metadata without a client pipeline", () => {
  const pagedIr: OvenIr = {
    contract: "burnlist-differential-testing-data@1",
    controls: [{ id: "search", kind: "search" }],
    collections: [
      { id: "auto", source: "/items", pageSize: 2, paging: "auto", searchFrom: "search" },
      { id: "server", source: "/items", pageSize: 2, paging: "server", searchFrom: "search" },
    ],
    root: [],
  };
  const pagedPayload = {
    items: [{ id: "second", label: "Beta" }, { id: "first", label: "Alpha" }],
    telemetry: { fields: [{ id: "first", failToPassCount: 1 }] },
  };
  const pages = {
    auto: { page: 1, pageSize: 25, pageCount: 3, total: 60 },
    server: { page: 2, pageSize: 10, pageCount: 4, total: 32 },
  };
  const state = initOvenState(pagedIr, pagedPayload, { search: "no match" }, pages);
  assert.deepEqual(selectCollection(state, pagedIr, "auto", resolvePointer), {
    pageItems: [
      { id: "second", label: "Beta" },
      { id: "first", label: "Alpha", transitionTelemetry: { id: "first", failToPassCount: 1 } },
    ],
    pageIndex: 1,
    pageCount: 3,
    pageSize: 25,
    totalCount: 60,
  });
  assert.deepEqual(selectCollection(state, pagedIr, "server", resolvePointer), {
    pageItems: [
      { id: "second", label: "Beta" },
      { id: "first", label: "Alpha", transitionTelemetry: { id: "first", failToPassCount: 1 } },
    ],
    pageIndex: 2,
    pageCount: 4,
    pageSize: 10,
    totalCount: 32,
  });
});

test("client paging ignores supplied server metadata", () => {
  const clientIr: OvenIr = {
    ...ir,
    collections: [{ id: "items", source: "/items", pageSize: 2, paging: "client" }],
  };
  const state = initOvenState(clientIr, payload, {}, { items: { page: 1, pageSize: 25, pageCount: 1, total: 2 } });
  assert.deepEqual(selectCollection(state, clientIr, "items", resolvePointer), {
    pageItems: [{ id: 1 }, { id: 2 }],
    pageIndex: 0,
    pageCount: 3,
    pageSize: 2,
    totalCount: 5,
  });
});
