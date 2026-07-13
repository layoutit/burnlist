import assert from "node:assert/strict";
import test from "node:test";
import { getOvenHandler, listOvenHandlers, registerOvenHandler } from "./oven-registry.mjs";

test("the Oven handler registry validates and retrieves code-owned handlers", () => {
  const handler = {};
  registerOvenHandler("registry-test", handler);

  assert.equal(getOvenHandler("registry-test"), handler);
  assert.equal(listOvenHandlers().includes(handler), true);
  assert.equal(getOvenHandler("not-registered"), null);
  assert.equal(getOvenHandler("Invalid id"), null);
  assert.throws(() => registerOvenHandler("registry-test", {}), /already registered/u);
  assert.throws(() => registerOvenHandler("Invalid id", {}), /lowercase slug/u);
});
