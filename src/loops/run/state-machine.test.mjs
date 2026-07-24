import assert from "node:assert/strict";
import test from "node:test";
import { createJournalRecord } from "./run-journal.mjs";
import { foldRun } from "./run-fold.mjs";
import { foldStateMachine, validateGraph } from "./state-machine.mjs";
import { validateNormalizedResult } from "./run-result.mjs";
import { created, testGraph } from "./m2-test-fixtures.mjs";

const append = (records, type, payload) => [...records, createJournalRecord({ sequence: records.length + 1, prevDigest: records.at(-1)?.digest ?? null, at: records.length, type, payload })];
test("table validates every executable outcome and rejects cross-node outcomes", () => {
  const nodes = new Map(testGraph.nodes.map((node) => [node.id, node]));
  for (const [node, outcomes] of [["implement", ["complete"]], ["verify", ["pass", "fail"]], ["review", ["approve", "reject", "escalate"]]]) for (const outcome of outcomes) assert.doesNotThrow(() => validateNormalizedResult({ kind: outcome, summary: "ok", outputBytes: 0, candidateId: null }, nodes.get(node), testGraph.budget.maxOutputBytes));
  assert.throws(() => validateNormalizedResult({ kind: "approve", summary: "ok", outputBytes: 0, candidateId: null }, nodes.get("implement"), testGraph.budget.maxOutputBytes), /legal/u);
  assert.throws(() => validateGraph({ ...testGraph, ignored: true }), /canonical/u);
});

test("a semantic result may retain its evidence when a later limit selects exhaustion", () => {
  let records = [createJournalRecord({ sequence: 1, prevDigest: null, at: 0, type: "run-created", payload: created() })];
  records = append(records, "state-changed", { from: "prepared", to: "running", cause: "control" });
  records = append(records, "lease-acquired", { generation: 1, token: "a".repeat(64) });
  records = append(records, "node-started", { nodeId: "implement", attempt: 1 });
  records = append(records, "invocation-started", { nodeId: "implement", attempt: 1, invocationId: "b".repeat(32) });
  records = append(records, "invocation-result", { invocationId: "b".repeat(32), kind: "complete", summary: "ok", outputBytes: 0, candidateId: null });
  records = append(records, "system-outcome", { kind: "exhausted", summary: "transitions" });
  records = append(records, "state-changed", { from: "running", to: "budget-exhausted", cause: "system" });
  assert.equal(foldStateMachine({ graph: testGraph, records }).state, "budget-exhausted");
});

test("an atomic sequence-256 terminal event folds to the declared terminal projection", () => {
  const first = createJournalRecord({ sequence: 1, prevDigest: null, at: 0, type: "run-created", payload: created() });
  const running = createJournalRecord({ sequence: 2, prevDigest: first.digest, at: 1, type: "state-changed", payload: { from: "prepared", to: "running", cause: "control" } });
  const leased = createJournalRecord({ sequence: 3, prevDigest: running.digest, at: 2, type: "lease-acquired", payload: { generation: 1, token: "a".repeat(64) } });
  const terminal = createJournalRecord({ sequence: 256, prevDigest: leased.digest, at: 3, type: "terminal-node-committed", payload: { kind: "exhausted", summary: "minutes", from: "running", to: "budget-exhausted", nodeId: "exhausted", attempt: 1 } });
  const folded = foldRun([first, running, leased, terminal]);
  assert.equal(folded.projection.sequence, 256); assert.equal(folded.projection.state, "budget-exhausted"); assert.equal(folded.execution.system.kind, "exhausted");
});

test("capacity terminalization clears an owner and is closed for every recoverable lifecycle state", () => {
  const first = createJournalRecord({ sequence: 1, prevDigest: null, at: 0, type: "run-created", payload: created() });
  const terminal = (prior, from) => createJournalRecord({ sequence: 256, prevDigest: prior.digest, at: 4, type: "terminal-node-committed", payload: { kind: "exhausted", summary: "journal", from, to: "budget-exhausted", nodeId: "exhausted", attempt: 1 } });
  const prepared = foldRun([first, terminal(first, "prepared")]); assert.equal(prepared.projection.leaseHeld, false);
  const running = createJournalRecord({ sequence: 2, prevDigest: first.digest, at: 1, type: "state-changed", payload: { from: "prepared", to: "running", cause: "control" } });
  const noOwner = foldRun([first, running, terminal(running, "running")]); assert.equal(noOwner.projection.leaseHeld, false);
  const owner = createJournalRecord({ sequence: 3, prevDigest: running.digest, at: 2, type: "lease-acquired", payload: { generation: 1, token: "a".repeat(64) } });
  const owned = foldRun([first, running, owner, terminal(owner, "running")]); assert.equal(owned.projection.leaseHeld, false);
  const paused = createJournalRecord({ sequence: 4, prevDigest: owner.digest, at: 3, type: "state-changed", payload: { from: "running", to: "paused", cause: "control" } });
  const pausedTerminal = foldRun([first, running, owner, paused, terminal(paused, "paused")]); assert.equal(pausedTerminal.projection.leaseHeld, false);
  const stopped = createJournalRecord({ sequence: 4, prevDigest: owner.digest, at: 3, type: "state-changed", payload: { from: "running", to: "stopped", cause: "control" } });
  const contradictory = createJournalRecord({ sequence: 5, prevDigest: stopped.digest, at: 4, type: "terminal-node-committed", payload: { kind: "error", summary: "wrong terminal kind", from: "stopped", to: "stopped", nodeId: "failed", attempt: 1 } });
  assert.throws(() => foldRun([first, running, owner, stopped, contradictory]), /invalid atomic terminal/u);
});
