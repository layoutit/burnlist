import assert from "node:assert/strict";
import test from "node:test";
import {
  OVEN_DATA_INPUT,
  getOvenHandler,
  listOvenHandlers,
  registerOvenHandler,
} from "./oven-registry.mjs";

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
  assert.throws(() => registerOvenHandler("registry-reconcile", {
    id: "registry-reconcile", reconcileDataBindings: true,
  }), /must be a function/u);
  assert.throws(() => registerOvenHandler("registry-warm", { id: "registry-warm", warmIntervalMs: 0 }), /positive integer/u);
});

test("the registry validates pre-write data capabilities", () => {
  const validateData = (payload) => payload;
  const payloadHandler = registerOvenHandler("registry-payload", {
    id: "registry-payload",
    dataInput: OVEN_DATA_INPUT.jsonPayload,
    validateData,
  });
  const producerHandler = registerOvenHandler("registry-producer", {
    id: "registry-producer",
    dataInput: OVEN_DATA_INPUT.producerManaged,
  });

  assert.equal(payloadHandler.validateData, validateData);
  assert.equal(producerHandler.validateData, undefined);
  assert.throws(() => registerOvenHandler("registry-input", {
    id: "registry-input",
    dataInput: "unknown",
  }), /dataInput/u);
  assert.throws(() => registerOvenHandler("registry-validator", {
    id: "registry-validator",
    dataInput: OVEN_DATA_INPUT.jsonPayload,
  }), /validateData/u);
  assert.throws(() => registerOvenHandler("registry-managed", {
    id: "registry-managed",
    dataInput: OVEN_DATA_INPUT.producerManaged,
    validateData,
  }), /producer-managed/u);
});

test("every built-in declares its real runtime data capability", async () => {
  await import("./built-in-handlers.mjs");

  for (const id of ["checklist", "differential-testing", "model-lab", "performance-tracing", "visual-parity"]) {
    const handler = getOvenHandler(id);
    assert.equal(handler.dataInput, OVEN_DATA_INPUT.jsonPayload, id);
    assert.equal(typeof handler.validateData, "function", id);
  }
  const streamingDiff = getOvenHandler("streaming-diff");
  assert.equal(streamingDiff.dataInput, OVEN_DATA_INPUT.producerManaged);
  assert.equal(streamingDiff.validateData, undefined);
});
