import assert from "node:assert/strict";
import test from "node:test";
import { budgetReason, foldBudgets } from "./budgets.mjs";
import { createJournalRecord } from "./run-journal.mjs";
import { created, testGraph } from "./m2-test-fixtures.mjs";

const record = (sequence, prior, type, payload, at = sequence) => createJournalRecord({ sequence, prevDigest: prior?.digest ?? null, at, type, payload });
test("fold enforces inclusive counters, retries, visits, output, and time", () => {
  const one = record(1, null, "run-created", created(), 0), two = record(2, one, "node-started", { nodeId: "implement", attempt: 1 }), three = record(3, two, "invocation-started", { nodeId: "implement", attempt: 1, invocationId: "a".repeat(32) }), four = record(4, three, "invocation-result", { invocationId: "a".repeat(32), kind: "complete", summary: "ok", outputBytes: 1, candidateId: null });
  const folded = foldBudgets({ records: [one, two, three, four], graph: testGraph }); assert.equal(folded.counters.agentRuns, 1); assert.equal(budgetReason({ folded, graph: testGraph, node: testGraph.nodes.find((node) => node.id === "implement") }), null);
  const elapsed = foldBudgets({ records: [one, record(2, one, "state-changed", { from: "prepared", to: "running", cause: "control" }, testGraph.budget.maxMinutes * 60000)], graph: testGraph }); assert.equal(budgetReason({ folded: elapsed, graph: testGraph }), "minutes");
  const visits = [one];
  for (let index = 1; index <= 4; index += 1) visits.push(record(index + 1, visits.at(-1), "edge-taken", { from: "review", on: "reject", to: "implement" }));
  assert.throws(() => foldBudgets({ records: visits, graph: testGraph }), /visit exceeds/u);
});
