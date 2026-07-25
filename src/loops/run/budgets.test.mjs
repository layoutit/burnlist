import assert from "node:assert/strict";
import test from "node:test";
import { budgetReason, foldBudgets } from "./budgets.mjs";
import { createJournalRecord } from "./run-journal.mjs";
import { created, testGraph } from "./m2-test-fixtures.mjs";
import { createHostClaim } from "./run-claim.mjs";

const record = (sequence, prior, type, payload, at = sequence) => createJournalRecord({ sequence, prevDigest: prior?.digest ?? null, at, type, payload });
test("fold enforces inclusive counters, retries, visits, output, and time", () => {
  const one = record(1, null, "run-created", created(), 0), two = record(2, one, "node-started", { nodeId: "implement", attempt: 1 }), three = record(3, two, "invocation-started", { nodeId: "implement", attempt: 1, invocationId: "a".repeat(32) }), four = record(4, three, "invocation-result", { invocationId: "a".repeat(32), kind: "complete", summary: "ok", outputBytes: 1, candidateId: null });
  const folded = foldBudgets({ records: [one, two, three, four], graph: testGraph }); assert.equal(folded.counters.agentRuns, 1); assert.equal(budgetReason({ folded, graph: testGraph, node: testGraph.nodes.find((node) => node.id === "implement") }), null);
  const elapsed = foldBudgets({ records: [one, record(2, one, "state-changed", { from: "prepared", to: "running", cause: "control" }, testGraph.budget.maxMinutes * 60000)], graph: testGraph }); assert.equal(budgetReason({ folded: elapsed, graph: testGraph }), "minutes");
  const visits = [one];
  for (let index = 1; index <= 4; index += 1) visits.push(record(index + 1, visits.at(-1), "edge-taken", { from: "review", on: "reject", to: "implement" }));
  assert.throws(() => foldBudgets({ records: visits, graph: testGraph }), /visit exceeds/u);
});

test("managed claim and report boundaries consume agent, round, and output budgets once", () => {
  const one = record(1, null, "run-created", created(), 0);
  const hostClaim = createHostClaim({ runId: created().runId, nodeId: "implement", attempt: 1,
    assignmentId: `as1-sha256:${"a".repeat(64)}`, inputCandidate: `cm1-sha256:${"b".repeat(64)}`,
    executionDigest: `sha256:${"c".repeat(64)}`, expiresAt: 10_000 });
  const bound = { claim: hostClaim, envelopeDigest: hostClaim.executionDigest, invocationId: `iv1-sha256:${"d".repeat(64)}` };
  const claim = record(2, one, "external-claim-bound", bound);
  const report = record(3, claim, "external-report-accepted", { claimId: hostClaim.claimId, reportDigest: `sha256:${"e".repeat(64)}`,
    invocationId: bound.invocationId, kind: "complete", summary: "ok", outputBytes: 7, candidateId: null });
  const managed = [one, claim, report];
  const exact = { ...testGraph, budget: { ...testGraph.budget, maxAgentRuns: 1, maxRounds: 1, maxOutputBytes: 7 } };
  const folded = foldBudgets({ records: managed, graph: exact });
  assert.deepEqual(folded.counters, { rounds: 1, agentRuns: 1, checkRuns: 0, transitions: 0, outputBytes: 7 });
  const directStart = record(2, one, "node-started", { nodeId: "implement", attempt: 1 });
  const mixed = [one, directStart, record(3, directStart, "external-claim-bound", bound)];
  assert.equal(foldBudgets({ records: mixed, graph: exact }).counters.agentRuns, 1, "transport boundary cannot double count an attempt");
  assert.equal(budgetReason({ folded, graph: exact, node: exact.nodes.find((node) => node.id === "implement") }), "agent-runs");
  const nextClaim = createHostClaim({ runId: hostClaim.runId, nodeId: hostClaim.nodeId, attempt: 2,
    assignmentId: hostClaim.assignmentId, inputCandidate: hostClaim.inputCandidate,
    executionDigest: `sha256:${"f".repeat(64)}`, expiresAt: 20_000 });
  const secondClaim = record(4, report, "external-claim-bound", { claim: nextClaim, envelopeDigest: nextClaim.executionDigest, invocationId: `iv1-sha256:${"1".repeat(64)}` });
  const secondReport = record(4, report, "external-report-accepted", { claimId: hostClaim.claimId, reportDigest: `sha256:${"2".repeat(64)}`,
    invocationId: bound.invocationId, kind: "complete", summary: "ok", outputBytes: 1, candidateId: null });
  assert.throws(() => foldBudgets({ records: [...managed, secondClaim], graph: exact }), /inclusive limit exceeded/u);
  assert.throws(() => foldBudgets({ records: [...managed, secondReport], graph: exact }), /inclusive limit exceeded/u);
});
