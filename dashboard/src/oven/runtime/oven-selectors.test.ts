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
  assert.deepEqual(selectRefreshStatus(state), { phase: "idle", error: undefined, generation: 0 });
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
