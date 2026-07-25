import assert from "node:assert/strict";
import test from "node:test";
import { createJournalRecord } from "../run/run-journal.mjs";
import { normalizeOptionalActivityRecord, projectRunActivity } from "./activity-projection.mjs";

const graph = { nodes: [{ id: "implement", kind: "agent", execution: "host" }, { id: "verify", kind: "check", capability: "repo-verify" }], edges: [] };
const runId = "run:01arz3ndektsv4rrffq69g5fav";
const claim = { nodeId: "implement", attempt: 1 };
function journal(type, payload, sequence = 1) {
  return createJournalRecord({ sequence, prevDigest: sequence === 1 ? null : `sha256:${"a".repeat(64)}`, at: sequence, type, payload });
}

test("activity projection is bounded, correlated, and excludes execution text", () => {
  const records = [
    journal("run-created", { schema: "burnlist-loop-m2-run@1", runId, itemRef: "item:260722-001#M7", graph, authorityRequired: false }),
    journal("external-claim-bound", { claim: { ...claim, schema: "burnlist-loop-host-claim@1", claimId: `cl1-sha256:${"a".repeat(64)}`, runId, itemRef: "item:260722-001#M7", assignmentId: `as1-sha256:${"b".repeat(64)}`, nodeId: "implement", attempt: 1, issuedAt: 1, expiresAt: 2, executionDigest: `sha256:${"c".repeat(64)}` }, envelopeDigest: `sha256:${"c".repeat(64)}`, invocationId: `iv1-sha256:${"d".repeat(64)}` }, 2),
    journal("edge-taken", { from: "implement", on: "complete", to: "verify" }, 3),
  ];
  const result = projectRunActivity({ runId, graph, journal: records });
  assert.equal(result.hooks, "unavailable");
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records[0].origin, "runner");
  assert.match(result.records[0].correlation, /^ac1-sha256:/u);
  assert.doesNotMatch(JSON.stringify(result), /claimId|invocationId|output|prompt|secret/u);
});

test("activity projection keeps only the most recent ten records", () => {
  const records = Array.from({ length: 12 }, (_, index) => journal("edge-taken", { from: "a", on: "pass", to: "b" }, index + 1));
  const result = projectRunActivity({ runId, graph, journal: records });
  assert.equal(result.records.length, 10);
  assert.equal(result.records[0].at, 3);
});

test("optional Claude and Codex observations are narrow, correlated, and preserve parentage", () => {
  const claude = normalizeOptionalActivityRecord({ at: 2, origin: "host-hook", kind: "subagent-started", provider: "claude", runId, nodeId: "implement", attempt: 1, invocationId: "invocation-1", parentAgentId: "parent-1", subagentId: "child-1", truncated: true });
  const codex = normalizeOptionalActivityRecord({ at: 3, origin: "agent-reported", kind: "tool-finished", provider: "codex", runId, nodeId: "implement", attempt: 1, invocationId: "invocation-1", tool: "node-test", observedPath: "src/loops/run/binder.mjs" });
  assert.deepEqual({ origin: claude.origin, parentAgentId: claude.parentAgentId, subagentId: claude.subagentId, truncated: claude.truncated }, { origin: "host-hook", parentAgentId: "parent-1", subagentId: "child-1", truncated: true });
  assert.equal(codex.tool, "node-test");
  assert.equal(codex.observedPath, "src/loops/run/binder.mjs");
  const invocationId = `iv1-sha256:${"d".repeat(64)}`;
  const bound = journal("external-claim-bound", { claim: { ...claim, schema: "burnlist-loop-host-claim@1", claimId: `cl1-sha256:${"a".repeat(64)}`, runId, assignmentId: `as1-sha256:${"b".repeat(64)}`, inputCandidate: `cm1-sha256:${"c".repeat(64)}`, executionDigest: `sha256:${"e".repeat(64)}`, expiresAt: 10 }, envelopeDigest: `sha256:${"e".repeat(64)}`, invocationId }, 1);
  const activity = projectRunActivity({ runId, graph, journal: [bound], optionalRecords: [
    { at: 2, origin: "host-hook", kind: "subagent-started", provider: "claude", runId, nodeId: "implement", attempt: 1, invocationId, parentAgentId: "parent-1", subagentId: "child-1", truncated: true },
    { at: 3, origin: "agent-reported", kind: "tool-finished", provider: "codex", runId, nodeId: "implement", attempt: 1, invocationId, tool: "node-test" },
  ] });
  assert.equal(activity.hooks, "available");
  assert.equal(activity.records.length, 3);
  assert.equal(activity.records[1].correlation, activity.records[0].correlation);
  assert.notEqual(
    normalizeOptionalActivityRecord({ at: 3, origin: "agent-reported", kind: "tool-finished", provider: "codex", runId, nodeId: "implement", attempt: 1, invocationId: "another-invocation", tool: "node-test" }).correlation,
    activity.records[0].correlation,
  );
  const stale = projectRunActivity({ runId, graph, journal: [bound], optionalRecords: [
    { at: 4, origin: "host-hook", kind: "tool-finished", provider: "codex", runId, nodeId: "implement", attempt: 1, invocationId: "not-current", tool: "node" },
  ] });
  assert.equal(stale.hooks, "unavailable");
  assert.equal(stale.records.length, 1);
  assert.equal(normalizeOptionalActivityRecord({ at: 1, origin: "host-hook", kind: "tool-finished", provider: "codex", runId, nodeId: "implement", attempt: 1, invocationId: "x", tool: "node", output: "forbidden" }), null);
  assert.equal(normalizeOptionalActivityRecord({ at: 1, origin: "host-hook", kind: "tool-finished", provider: "codex", runId, nodeId: "implement", attempt: 1, invocationId: "x", tool: "node", args: ["forbidden"] }), null);
  for (const observedPath of ["/private/file", "C:/profile/secret.txt", "C:secret.txt", "../secret", "src/../secret", "src\\secret", "src/\u0000secret"]) {
    assert.equal(normalizeOptionalActivityRecord({ at: 1, origin: "host-hook", kind: "tool-finished", provider: "codex", runId, nodeId: "implement", attempt: 1, invocationId: "x", tool: "node", observedPath }), null);
  }
});
