import assert from "node:assert/strict";
import test from "node:test";
import { createJournalRecord } from "./run-journal.mjs";
import { foldRun } from "./run-fold.mjs";
import { foldStateMachine, validateGraph } from "./state-machine.mjs";
import { validateNormalizedResult } from "./run-result.mjs";
import { createHostClaim } from "./run-claim.mjs";
import { created, testGraph } from "./m2-test-fixtures.mjs";
import { findingId } from "../contracts/finding.mjs";

const append = (records, type, payload) => [...records, createJournalRecord({ sequence: records.length + 1, prevDigest: records.at(-1)?.digest ?? null, at: records.length, type, payload })];
test("table validates every executable outcome and rejects cross-node outcomes", () => {
  const nodes = new Map(testGraph.nodes.map((node) => [node.id, node]));
  for (const [node, outcomes] of [["implement", ["complete"]], ["verify", ["pass", "fail"]], ["review", ["approve", "reject", "escalate"]]]) for (const outcome of outcomes) assert.doesNotThrow(() => validateNormalizedResult({ kind: outcome, summary: "ok", outputBytes: 0, candidateId: null }, nodes.get(node), testGraph.budget.maxOutputBytes));
  assert.throws(() => validateNormalizedResult({ kind: "approve", summary: "ok", outputBytes: 0, candidateId: null }, nodes.get("implement"), testGraph.budget.maxOutputBytes), /legal/u);
  assert.throws(() => validateGraph({ ...testGraph, ignored: true }), /canonical/u);
});

test("an external claim atomically starts only the current unstarted agent invocation", () => {
  const claim = createHostClaim({ runId: created().runId, nodeId: "implement", attempt: 1,
    assignmentId: "as1-sha256:" + "a".repeat(64), inputCandidate: "cm1-sha256:" + "b".repeat(64),
    executionDigest: "sha256:" + "c".repeat(64), expiresAt: 10_000 });
  let records = [createJournalRecord({ sequence: 1, prevDigest: null, at: 0, type: "run-created", payload: created() })];
  records = append(records, "state-changed", { from: "prepared", to: "running", cause: "control" });
  records = append(records, "lease-acquired", { generation: 1, token: "a".repeat(64) });
  const invocationId = "iv1-sha256:" + "d".repeat(64);
  records = append(records, "external-claim-bound", { claim, envelopeDigest: claim.executionDigest, invocationId });
  const folded = foldRun(records);
  assert.equal(folded.execution.started, true);
  assert.equal(folded.execution.invocation.invocationId, invocationId);
  assert.equal(folded.execution.externalClaim.claim.claimId, claim.claimId);
  assert.equal(folded.execution.attempt, 1);
  assert.equal(folded.execution.cycle, 1);
  const invalid = [...records.slice(0, -1), createJournalRecord({ sequence: 4, prevDigest: records[2].digest, at: 3,
    type: "external-claim-bound", payload: { claim: { ...claim, nodeId: "review" }, envelopeDigest: claim.executionDigest, invocationId } })];
  assert.throws(() => foldRun(invalid), /external claim/u);
});

test("review findings survive repair, reach a fresh reviewer, and telemetry never leaks across nodes", () => {
  const makerClaim = createHostClaim({ runId: created().runId, nodeId: "implement", attempt: 1,
    assignmentId: "as1-sha256:" + "a".repeat(64), inputCandidate: "cm1-sha256:" + "b".repeat(64),
    executionDigest: "sha256:" + "c".repeat(64), expiresAt: 10_000 });
  const claim = createHostClaim({ runId: created().runId, nodeId: "review", attempt: 1,
    assignmentId: makerClaim.assignmentId, inputCandidate: makerClaim.inputCandidate,
    executionDigest: "sha256:" + "9".repeat(64), expiresAt: 10_000 });
  const evidenceRefs = ["artifact:sha256:" + "e".repeat(64)];
  const finding = { severity: "blocker", summary: "Fix candidate binding", evidenceRefs };
  finding.id = findingId(finding);
  let records = [createJournalRecord({ sequence: 1, prevDigest: null, at: 0, type: "run-created", payload: created() })];
  records = append(records, "state-changed", { from: "prepared", to: "running", cause: "control" });
  records = append(records, "lease-acquired", { generation: 1, token: "a".repeat(64) });
  const makerInvocation = "iv1-sha256:" + "8".repeat(64);
  records = append(records, "external-claim-bound", { claim: makerClaim, envelopeDigest: makerClaim.executionDigest, invocationId: makerInvocation });
  records = append(records, "external-report-accepted", { claimId: makerClaim.claimId, reportDigest: "sha256:" + "7".repeat(64),
    invocationId: makerInvocation, kind: "complete", summary: "host reported complete", outputBytes: 10, candidateId: null });
  records = append(records, "candidate-bound", { candidateId: makerClaim.inputCandidate, candidateContext: "candidate-summary@2\n" });
  records = append(records, "edge-taken", { from: "implement", on: "complete", to: "verify" });
  records = append(records, "node-started", { nodeId: "verify", attempt: 1 });
  records = append(records, "invocation-started", { nodeId: "verify", attempt: 1, invocationId: "6".repeat(32) });
  records = append(records, "invocation-result", { invocationId: "6".repeat(32), kind: "pass", summary: "ok", outputBytes: 0, candidateId: makerClaim.inputCandidate });
  records = append(records, "edge-taken", { from: "verify", on: "pass", to: "review" });
  const invocationId = "iv1-sha256:" + "d".repeat(64);
  records = append(records, "external-claim-bound", { claim, envelopeDigest: claim.executionDigest, invocationId });
  const telemetry = { schema: "burnlist-loop-host-telemetry@1", provenance: "host-reported", executor: "codex",
    displayName: null, provider: "openai", model: "gpt-test", effort: "low",
    startedAt: 1, completedAt: 2, inputTokens: 10, outputTokens: 3 };
  records = append(records, "external-report-accepted", { claimId: claim.claimId, reportDigest: "sha256:" + "f".repeat(64),
    invocationId, kind: "reject", summary: "host reported reject", outputBytes: 10, candidateId: makerClaim.inputCandidate,
    findings: [finding], resolvedFindingIds: [], telemetry });
  const execution = foldRun(records).execution;
  assert.deepEqual(execution.openFindings.get(finding.id), Object.freeze({ ...finding, evidenceRefs: Object.freeze(evidenceRefs) }));
  assert.deepEqual(execution.telemetry, telemetry);
  records = append(records, "edge-taken", { from: "review", on: "reject", to: "implement" });
  const repairCandidate = "cm1-sha256:" + "4".repeat(64);
  const repairClaim = createHostClaim({ runId: created().runId, nodeId: "implement", attempt: 2,
    assignmentId: makerClaim.assignmentId, inputCandidate: repairCandidate,
    executionDigest: "sha256:" + "3".repeat(64), expiresAt: 10_000 });
  const repairInvocation = "iv1-sha256:" + "2".repeat(64);
  records = append(records, "external-claim-bound", {
    claim: repairClaim, envelopeDigest: repairClaim.executionDigest, invocationId: repairInvocation,
  });
  records = append(records, "external-report-accepted", {
    claimId: repairClaim.claimId, reportDigest: "sha256:" + "1".repeat(64), invocationId: repairInvocation,
    kind: "complete", summary: "host reported complete", outputBytes: 10, candidateId: null,
    findings: [], resolvedFindingIds: [], telemetry: null,
  });
  records = append(records, "candidate-bound", { candidateId: repairCandidate, candidateContext: "candidate-summary@2\n" });
  records = append(records, "edge-taken", { from: "implement", on: "complete", to: "verify" });
  const repaired = foldRun(records).execution;
  assert.equal(repaired.telemetry, null);
  assert.equal(repaired.openFindings.has(finding.id), true);
  records = append(records, "node-started", { nodeId: "verify", attempt: 2 });
  records = append(records, "invocation-started", { nodeId: "verify", attempt: 2, invocationId: "5".repeat(32) });
  records = append(records, "invocation-result", {
    invocationId: "5".repeat(32), kind: "pass", summary: "ok", outputBytes: 0, candidateId: repairCandidate,
  });
  records = append(records, "edge-taken", { from: "verify", on: "pass", to: "review" });
  const finalClaim = createHostClaim({ runId: created().runId, nodeId: "review", attempt: 2,
    assignmentId: makerClaim.assignmentId, inputCandidate: repairCandidate,
    executionDigest: "sha256:" + "0".repeat(64), expiresAt: 10_000 });
  const finalInvocation = "iv1-sha256:" + "0".repeat(64);
  records = append(records, "external-claim-bound", {
    claim: finalClaim, envelopeDigest: finalClaim.executionDigest, invocationId: finalInvocation,
  });
  records = append(records, "external-report-accepted", {
    claimId: finalClaim.claimId, reportDigest: "sha256:" + "2".repeat(64), invocationId: finalInvocation,
    kind: "approve", summary: "host reported approve", outputBytes: 10, candidateId: repairCandidate,
    findings: [], resolvedFindingIds: [finding.id], telemetry: null,
  });
  assert.equal(foldRun(records).execution.openFindings.size, 0);
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
