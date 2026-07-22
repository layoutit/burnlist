import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOvenRuntimeInputs } from "./OvenRuntime";

test("controlled payload mode suppresses IR polling", () => {
  const payload = { validated: true };
  assert.deepEqual(resolveOvenRuntimeInputs({
    initialPayload: { stale: true },
    payload,
    refreshSeconds: 2,
  }), {
    inputPayload: payload,
    refreshSeconds: undefined,
  });
});

test("live mode keeps IR polling with no payload or an initial payload", () => {
  assert.deepEqual(resolveOvenRuntimeInputs({ refreshSeconds: 2 }), {
    inputPayload: undefined,
    refreshSeconds: 2,
  });

  const initialPayload = { retained: true };
  assert.deepEqual(resolveOvenRuntimeInputs({ initialPayload, refreshSeconds: 2 }), {
    inputPayload: initialPayload,
    refreshSeconds: 2,
  });
});
