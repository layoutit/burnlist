import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runStore } from "./run-store.mjs";
import { appendJournalRecord, createJournalRecord } from "./run-journal.mjs";
import { testGraph, testRunId } from "./m2-test-fixtures.mjs";
import { withDirectoryLock } from "../../server/dir-lock.mjs";
import { readOvenEvents } from "../../events/oven-event-store.mjs";
import { publishLoopProjectionInvalidation } from "../events/projection-events.mjs";
import { presentRun } from "./read-projection.mjs";

function fixture(t) { const root = mkdtempSync(join(os.tmpdir(), "m2-store-")); t.after(() => rmSync(root, { recursive: true, force: true })); let at = 0; const store = runStore(root, { clock: () => at++ }); store.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: testGraph }); return store; }
test("Run creation stages private authority and journal until one directory rename", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m6-stage-")); t.after(() => rmSync(root, { recursive: true, force: true })); let observed;
  const store = runStore(root, { hooks: { beforeRunPublish({ runId, target }) {
    observed = { listed: runStore(root).list(), target: existsSync(target), runId };
  } } });
  store.createRun({ runId: testRunId, itemRef: "item:260722-001#M6", graph: testGraph });
  assert.deepEqual(observed, { listed: [], target: false, runId: testRunId }); assert.equal(store.read(testRunId).journal.length, 1);
  const failed = runStore(root, { hooks: { beforeRunPublish() { throw new Error("crash-before-publish"); } } });
  const other = "run:01arz3ndektsv4rrffq69g5faw";
  assert.throws(() => failed.createRun({ runId: other, itemRef: "item:260722-001#M6", graph: testGraph }), /crash-before-publish/u);
  assert.equal(runStore(root).list().length, 1);
});
test("authority-less fixture Runs freeze that fact and retain a null Loop revision", (t) => {
  const store = fixture(t), current = store.read(testRunId);
  assert.equal(current.journal[0].value.payload.authorityRequired, false);
  assert.deepEqual(current.loopIdentity, { loopId: testGraph.id, loopRevision: null });
});
test("pre-fold rejects poison, and lost-owner proof fences without reader takeover", (t) => {
  const store = fixture(t), acquired = store.acquireLease(testRunId), one = acquired.lease;
  assert.throws(() => store.append(testRunId, one, "state-changed", { from: "running", to: "converged", cause: "graph" }), /bypass/u);
  assert.equal(store.replay(testRunId).journal.length, 3);
  assert.throws(() => store.acquireLease(testRunId), { code: "ELEASED" });
  assert.throws(() => store.recoverLease(testRunId, { generation: one.generation, recoveryProof: "reader-does-not-know" }), { code: "ELOST_PROOF" });
  assert.throws(() => store.acquireLease(testRunId), { code: "ELEASED" });
  store.recoverLease(testRunId, { generation: one.generation, recoveryProof: acquired.recoveryProof });
  assert.throws(() => store.append(testRunId, one, "node-started", { nodeId: "implement", attempt: 1 }), { code: "ESTALE_LEASE" });
  const two = store.acquireLease(testRunId).lease; assert.equal(two.generation, 2);
});
test("an authorized recovery proof survives store recreation but is not replay data", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-recover-")); t.after(() => rmSync(root, { recursive: true, force: true })); let at = 0;
  const first = runStore(root, { clock: () => at++ }); first.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: testGraph }); const acquired = first.acquireLease(testRunId);
  const second = runStore(root, { clock: () => at++ }); assert.equal(second.read(testRunId).projection.leaseHeld, true);
  assert.throws(() => second.recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: "0".repeat(64) }), { code: "ELOST_PROOF" });
  second.recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }); const replacement = second.acquireLease(testRunId); assert.equal(replacement.lease.generation, 2); assert.doesNotMatch(JSON.stringify(second.read(testRunId)), new RegExp(acquired.recoveryProof, "u")); second.releaseLease(testRunId, replacement.lease); assert.equal(existsSync(join(second.paths.pathFor(testRunId), ".recovery-proof")), false);
});
test("proof sidecar rejects malformed private state and acquisition cuts remain recoverable", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-proof-")); t.after(() => rmSync(root, { recursive: true, force: true })); let at = 0;
  const store = runStore(root, { clock: () => at++ }); store.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: testGraph }); const acquired = store.acquireLease(testRunId), proof = join(store.paths.pathFor(testRunId), ".recovery-proof");
  chmodSync(proof, 0o644); assert.throws(() => runStore(root).recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }), /proof is corrupt/u);
  chmodSync(proof, 0o600); writeFileSync(proof, `${JSON.stringify({ schema: "burnlist-loop-m2-recovery-proof@1", runId: testRunId, generation: acquired.lease.generation, token: acquired.lease.token, recoveryProof: acquired.recoveryProof, extra: true })}\n`, { mode: 0o600 }); assert.throws(() => runStore(root).recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }), /proof is corrupt/u);
  writeFileSync(proof, `${JSON.stringify({ schema: "burnlist-loop-m2-recovery-proof@1", runId: testRunId, generation: acquired.lease.generation, token: "0".repeat(64), recoveryProof: acquired.recoveryProof })}\n`, { mode: 0o600 }); assert.throws(() => runStore(root).recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }), /generation changed/u);
  writeFileSync(proof, Buffer.alloc(1025), { mode: 0o600 }); assert.throws(() => runStore(root).recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }), /proof is corrupt/u);
  writeFileSync(proof, "{}\n", { mode: 0o600 }); assert.throws(() => runStore(root).recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }), /proof is corrupt/u);
  rmSync(proof); mkdirSync(proof, { mode: 0o600 }); assert.throws(() => runStore(root).recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }), /proof/u); rmSync(proof, { recursive: true }); symlinkSync("missing", proof); assert.throws(() => runStore(root).recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }), /ELOOP|proof/u); rmSync(proof);
  const cutRoot = mkdtempSync(join(os.tmpdir(), "m2-proof-cut-")); t.after(() => rmSync(cutRoot, { recursive: true, force: true })); const setup = runStore(cutRoot); setup.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: testGraph });
  assert.throws(() => runStore(cutRoot, { hooks: { beforeProofPublish() { throw new Error("before-proof"); } } }).acquireLease(testRunId), /before-proof/u); assert.equal(runStore(cutRoot).read(testRunId).projection.leaseHeld, false);
  assert.throws(() => runStore(cutRoot, { hooks: { afterProofPublish() { throw new Error("after-proof"); } } }).acquireLease(testRunId), /after-proof/u); assert.equal(runStore(cutRoot).acquireLease(testRunId).lease.generation, 1);
  const leaseRoot = mkdtempSync(join(os.tmpdir(), "m2-proof-lease-")); t.after(() => rmSync(leaseRoot, { recursive: true, force: true })); const leaseStore = runStore(leaseRoot); leaseStore.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: testGraph }); let captured;
  assert.throws(() => runStore(leaseRoot, { hooks: { afterLeaseAppend(value) { captured = value; throw new Error("after-lease"); } } }).acquireLease(testRunId), /after-lease/u); const recreated = runStore(leaseRoot); recreated.recoverLease(testRunId, { generation: captured.lease.generation, recoveryProof: captured.recoveryProof }); assert.equal(recreated.acquireLease(testRunId).lease.generation, 2);
});
test("lease acquire and release churn reserves one terminal record instead of stranding an owner", (t) => {
  const store = fixture(t); let acquired = store.acquireLease(testRunId);
  for (let cycle = 0; cycle < 126; cycle += 1) { store.releaseLease(testRunId, acquired.lease); acquired = store.acquireLease(testRunId); }
  assert.equal(store.replay(testRunId).projection.sequence, 255); const terminal = store.releaseLease(testRunId, acquired.lease);
  assert.equal(terminal.projection.sequence, 256); assert.equal(terminal.projection.state, "budget-exhausted"); assert.equal(terminal.projection.leaseHeld, false); assert.equal(terminal.journal.at(-1).value.type, "terminal-node-committed"); assert.equal(terminal.journal.some((record) => record.value.sequence === 257), false);
});
function rawTerminal(store, type, payload) { const current = store.replay(testRunId), record = createJournalRecord({ sequence: current.projection.sequence + 1, prevDigest: current.projection.journalDigest, at: current.journal.at(-1).value.at + 1, type, payload }); appendJournalRecord({ journalDirectory: store.paths.journalFor(testRunId), record }); return store.replay(testRunId); }
function ownerAt253(store) { let acquired = store.acquireLease(testRunId); for (let cycle = 0; cycle < 125; cycle += 1) { store.releaseLease(testRunId, acquired.lease); acquired = store.acquireLease(testRunId); } assert.equal(store.replay(testRunId).projection.sequence, 253); return acquired; }
test("a legacy stopped transition at 255 recovers through one lease-clearing final record", (t) => {
  const store = fixture(t), acquired = ownerAt253(store); store.append(testRunId, acquired.lease, "node-started", { nodeId: "implement", attempt: 1 });
  const legacy = rawTerminal(store, "state-changed", { from: "running", to: "stopped", cause: "control" }); assert.equal(legacy.projection.sequence, 255); assert.equal(legacy.projection.leaseHeld, true);
  const cleaned = store.recoverLease(testRunId, { generation: acquired.lease.generation, recoveryProof: acquired.recoveryProof }); assert.equal(cleaned.projection.sequence, 256); assert.equal(cleaned.projection.state, "stopped"); assert.equal(cleaned.projection.leaseHeld, false); assert.equal(cleaned.journal.at(-1).value.type, "terminal-node-committed"); assert.equal(cleaned.journal.some((record) => record.value.sequence === 257), false);
});
test("a legacy graph terminal at 255 releases through one lease-clearing final record", (t) => {
  const store = fixture(t); let acquired = store.acquireLease(testRunId), lease = acquired.lease;
  for (const [type, payload] of [["node-started", { nodeId: "implement", attempt: 1 }], ["invocation-started", { nodeId: "implement", attempt: 1, invocationId: "a".repeat(32) }], ["invocation-result", { invocationId: "a".repeat(32), kind: "complete", summary: "ok", outputBytes: 0, candidateId: null }], ["edge-taken", { from: "implement", on: "complete", to: "verify" }], ["node-started", { nodeId: "verify", attempt: 1 }], ["invocation-started", { nodeId: "verify", attempt: 1, invocationId: "b".repeat(32) }], ["invocation-result", { invocationId: "b".repeat(32), kind: "pass", summary: "ok", outputBytes: 0, candidateId: null }], ["edge-taken", { from: "verify", on: "pass", to: "review" }], ["node-started", { nodeId: "review", attempt: 1 }], ["invocation-started", { nodeId: "review", attempt: 1, invocationId: "c".repeat(32) }], ["invocation-result", { invocationId: "c".repeat(32), kind: "approve", summary: "ok", outputBytes: 0, candidateId: null }], ["edge-taken", { from: "review", on: "approve", to: "converged" }], ["node-started", { nodeId: "converged", attempt: 1 }], ["edge-taken", { from: "converged", on: "pass", to: "completed" }]]) store.append(testRunId, lease, type, payload);
  for (let cycle = 0; cycle < 118; cycle += 1) { store.releaseLease(testRunId, lease); acquired = store.acquireLease(testRunId); lease = acquired.lease; } assert.equal(store.replay(testRunId).projection.sequence, 253);
  store.append(testRunId, lease, "node-started", { nodeId: "completed", attempt: 1 }); const legacy = rawTerminal(store, "state-changed", { from: "running", to: "converged", cause: "graph" }); assert.equal(legacy.projection.sequence, 255); assert.equal(legacy.projection.leaseHeld, true);
  const cleaned = store.releaseLease(testRunId, lease); assert.equal(cleaned.projection.sequence, 256); assert.equal(cleaned.projection.state, "converged"); assert.equal(cleaned.projection.leaseHeld, false); assert.equal(cleaned.journal.at(-1).value.type, "terminal-node-committed"); assert.equal(cleaned.journal.some((record) => record.value.sequence === 257), false);
});

test("projection events publish after a committed revision, outside the journal lock, and deduplicate retries", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m7-run-events-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  let at = 0, store, lockWasFree = false;
  const bootstrap = runStore(root, { clock: () => at++ });
  bootstrap.createRun({ runId: testRunId, itemRef: "item:260722-001#M7", graph: testGraph });
  store = runStore(root, { clock: () => at++, publishProjection(repo, replay) {
    withDirectoryLock({ lockPath: join(store.paths.pathFor(testRunId), ".lock"), reclaimLiveAfterAge: false,
      errorFactory: () => new Error("journal lock remained held during publication"), fn: () => { lockWasFree = true; } });
    const committed = store.replay(testRunId);
    assert.equal(committed.revision, replay.revision);
    assert.equal(presentRun(committed).revision, replay.revision, "event cursor uses the public projection revision");
    return publishLoopProjectionInvalidation(repo, replay);
  } });
  const lease = store.acquireLease(testRunId).lease;
  const result = store.append(testRunId, lease, "node-started", { nodeId: "implement", attempt: 1 });
  assert.equal(lockWasFree, true);
  const events = readOvenEvents(root, { ovenIds: ["checklist"] }).filter((event) => event.kind === "loop-projection-changed");
  const event = events.at(-1);
  assert.equal(event.cursor, result.revision);
  assert.deepEqual(event.payload, { revision: result.revision });
  const retry = publishLoopProjectionInvalidation(root, result);
  assert.equal(retry.created, false, "the same committed revision has one public event");
  assert.equal(readOvenEvents(root, { ovenIds: ["checklist"] }).filter((entry) => entry.cursor === result.revision).length, 1);
});

test("a projection publisher failure cannot roll back a committed run mutation", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m7-run-publisher-failure-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = runStore(root, { publishProjection() { throw new Error("event sink unavailable"); } });
  const created = store.createRun({ runId: testRunId, itemRef: "item:260722-001#M7", graph: testGraph });
  assert.equal(store.replay(testRunId).revision, created.revision);
  assert.equal(store.list().length, 1);
});
