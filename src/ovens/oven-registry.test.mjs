import assert from "node:assert/strict";
import test from "node:test";
import { getOvenHandler, listOvenHandlers, registerOvenHandler } from "./oven-registry.mjs";

test("the Oven handler registry validates and retrieves code-owned handlers", () => {
  const handler = { id: "registry-test", dashboardEntries() { return []; } };
  const registered = registerOvenHandler("registry-test", handler);

  assert.equal(getOvenHandler("registry-test"), registered);
  assert.equal(listOvenHandlers().includes(registered), true);
  assert.equal(Object.isFrozen(registered), true);
  handler.id = "mutated-id";
  assert.equal(getOvenHandler("registry-test").id, "registry-test");
  assert.equal(listOvenHandlers()[0].id, "registry-test");
  assert.equal(getOvenHandler("not-registered"), null);
  assert.equal(getOvenHandler("Invalid id"), null);
  assert.throws(() => registerOvenHandler("registry-test", { id: "registry-test" }), /already registered/u);
  assert.throws(() => registerOvenHandler("Invalid id", { id: "Invalid id" }), /lowercase slug/u);
  assert.throws(() => registerOvenHandler("registry-mismatch", { id: "another-id" }), /must equal/u);
  assert.throws(() => registerOvenHandler("registry-hook", { id: "registry-hook", warm: true }), /must be a function/u);
  assert.throws(() => registerOvenHandler("registry-warm", { id: "registry-warm", warmIntervalMs: 0 }), /positive integer/u);
});
