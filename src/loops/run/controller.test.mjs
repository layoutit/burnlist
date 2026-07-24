import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLoopController } from "./controller.mjs";
import { testGraph, testRunId } from "./m2-test-fixtures.mjs";
import { createRunRunner } from "./runner.mjs";
import { runStore } from "./run-store.mjs";

function fixture(t) {
  const root = mkdtempSync(join(os.tmpdir(), "m6-controller-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  let time = 0; const store = runStore(root, { clock: () => time++ });
  store.createRun({ runId: testRunId, itemRef: "item:260722-001#M6", graph: testGraph });
  return { root, store, controller: createLoopController({ store, runnerFor: (runId) => createRunRunner({ store, runId, invoke: async ({ nodeId }) => ({ kind: nodeId === "implement" ? "complete" : nodeId === "verify" ? "pass" : "approve", summary: "ok", outputBytes: 0 }) }) }) };
}

test("read commands are byte-stable and do not create a lease", (t) => {
  const { controller, store } = fixture(t);
  assert.equal(controller.render(controller.status(testRunId)), controller.render(controller.status(testRunId)));
  assert.equal(controller.render(controller.inspect(testRunId)), controller.render(controller.inspect(testRunId)));
  assert.equal(store.read(testRunId).projection.leaseHeld, false);
});

test("pause is resumable, stop is terminal, and an owner fences competing controls", async (t) => {
  const { controller, store } = fixture(t);
  assert.equal(controller.pause(testRunId).state, "paused");
  assert.equal((await controller.run(testRunId)).state, "converged");
  assert.throws(() => controller.stop(testRunId), { code: "ETERMINAL" });
  const second = fixture(t), owner = second.store.acquireLease(testRunId);
  assert.throws(() => second.controller.pause(testRunId), { code: "ELEASED" });
  second.store.releaseLease(testRunId, owner.lease);
});

test("reconcile requires a fenced lost invocation and cannot be repeated", (t) => {
  const { controller, store } = fixture(t), acquired = store.acquireLease(testRunId);
  store.append(testRunId, acquired.lease, "node-started", { nodeId: "implement", attempt: 1 });
  store.append(testRunId, acquired.lease, "invocation-started", { nodeId: "implement", attempt: 1, invocationId: "a".repeat(32) });
  assert.throws(() => controller.reconcile(testRunId), { code: "ELOST_PROOF" });
  assert.equal(controller.reconcile(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }).state, "needs-human");
  assert.equal(controller.reconcile(testRunId).state, "needs-human");
});
