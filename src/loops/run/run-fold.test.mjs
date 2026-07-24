import assert from "node:assert/strict";
import test from "node:test";
import { createJournalRecord } from "./run-journal.mjs";
import { foldRun } from "./run-fold.mjs";
import { created, testGraph, testRunId } from "./m2-test-fixtures.mjs";

const add = (records, type, payload, at = records.length) => [...records, createJournalRecord({ sequence: records.length + 1, prevDigest: records.at(-1)?.digest ?? null, at, type, payload })];
const start = () => [createJournalRecord({ sequence: 1, prevDigest: null, at: 0, type: "run-created", payload: created() })];
test("fold validates canonical RunRef, result bytes, and lifecycle terminal authority", () => {
  const bad = { ...created(), runId: "run:not-a-run-ref" };
  assert.throws(() => foldRun([createJournalRecord({ sequence: 1, prevDigest: null, at: 0, type: "run-created", payload: bad })]), /creation/u);
  let records = start(); records = add(records, "state-changed", { from: "prepared", to: "running", cause: "control" }); records = add(records, "lease-acquired", { generation: 1, token: "a".repeat(64) });
  assert.throws(() => foldRun(add(records, "state-changed", { from: "running", to: "converged", cause: "graph" })), /bypass/u);
  records = add(records, "node-started", { nodeId: "implement", attempt: 1 }); records = add(records, "invocation-started", { nodeId: "implement", attempt: 1, invocationId: "b".repeat(32) });
  assert.throws(() => foldRun(add(records, "invocation-result", { invocationId: "b".repeat(32), kind: "complete", summary: "x".repeat(1025), outputBytes: 0, candidateId: null })), /result/u);
  assert.equal(foldRun(records).graph, testGraph);
});
