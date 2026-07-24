import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunRunner } from "./runner.mjs";
import { gateDecision } from "./state-machine.mjs";
import { normalizeIr } from "../dsl/canonical.mjs";
import { outcomesFor } from "../dsl/grammar.mjs";
import { runStore } from "./run-store.mjs";
import { testGraph, testRunId } from "./m2-test-fixtures.mjs";

function fixture(t, graph = testGraph) { const root = mkdtempSync(join(os.tmpdir(), "m2-runner-")); t.after(() => rmSync(root, { recursive: true, force: true })); let at = 0; const store = runStore(root, { clock: () => at++ }); store.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph }); return store; }
function renamedGraph() { const names = { verify: "audit", review: "tests" }, graph = JSON.parse(JSON.stringify(testGraph)); graph.nodes = graph.nodes.map((node) => node.kind === "agent" ? { ...node, id: names[node.id] ?? node.id, independentFrom: node.independentFrom ? names[node.independentFrom] ?? node.independentFrom : null } : node.kind === "check" ? { ...node, id: names[node.id] ?? node.id } : node.kind === "gate" ? { ...node, requires: node.requires.map((id) => names[id] ?? id) } : node); graph.edges = graph.edges.map((edge) => ({ ...edge, from: names[edge.from] ?? edge.from, to: names[edge.to] ?? edge.to })); return normalizeIr(graph, outcomesFor); }
function highBoundaryGraph() { const graph = JSON.parse(JSON.stringify(testGraph)); graph.budget = { maxRounds: 100, maxMinutes: 1000, maxAgentRuns: 100, maxCheckRuns: 100, maxTransitions: 1000, maxOutputBytes: 1000000 }; graph.edges = graph.edges.map((edge) => edge.from === "review" && edge.on === "reject" || edge.from === "verify" && edge.on === "fail" ? { ...edge, maxVisits: 100 } : edge); return normalizeIr(graph, outcomesFor); }
function ownerAt253(store) { let acquired = store.acquireLease(testRunId); for (let cycle = 0; cycle < 125; cycle += 1) { store.releaseLease(testRunId, acquired.lease); acquired = store.acquireLease(testRunId); } assert.equal(store.replay(testRunId).projection.sequence, 253); return acquired; }
test("runner table traverses maker/check/reviewer/gate/terminal", async (t) => {
  const store = fixture(t), outcomes = ["complete", "pass", "approve"], calls = [];
  const runner = createRunRunner({ store, runId: testRunId, clock: () => 0, invoke: async ({ nodeId }) => { calls.push(nodeId); return { kind: outcomes.shift(), summary: "ok", outputBytes: 1 }; } });
  assert.equal((await runner.run()).projection.state, "converged"); assert.deepEqual(calls, ["implement", "verify", "review"]);
});
test("post-maker candidate capture failure journals a restart-safe terminal and releases its lease", async (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m12-candidate-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = runStore(root, { clock: (() => { let at = 0; return () => at++; })() });
  store.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: testGraph });
  const runner = createRunRunner({ store, runId: testRunId,
    invoke: async () => ({ kind: "complete", summary: "maker complete", outputBytes: 0 }),
    bindCandidate() { throw new Error("candidate manifest exceeds bounds"); } });
  const result = await runner.run();
  assert.equal(result.projection.state, "failed");
  assert.equal(result.projection.leaseHeld, false);
  assert.equal(result.execution.system.summary, "candidate manifest exceeds bounds");
  const replayed = runStore(root).read(testRunId);
  assert.equal(replayed.projection.state, "failed");
  assert.equal(replayed.projection.leaseHeld, false);
  assert.equal(replayed.journal.some((record) => record.value.type === "system-outcome"), true);
});
test("multibyte candidate capture errors are UTF-8 bounded before durable terminalization", async (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m12-candidate-utf8-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = runStore(root);
  store.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: testGraph });
  const runner = createRunRunner({ store, runId: testRunId,
    invoke: async () => ({ kind: "complete", summary: "maker complete", outputBytes: 0 }),
    bindCandidate() { throw new Error("💥".repeat(400)); } });
  const result = await runner.run();
  assert.equal(result.projection.state, "failed");
  assert.equal(result.projection.leaseHeld, false);
  assert.ok(Buffer.byteLength(result.execution.system.summary, "utf8") <= 1024);
  const replayed = runStore(root).read(testRunId);
  assert.equal(replayed.projection.state, "failed");
  assert.equal(replayed.projection.leaseHeld, false);
});
test("renamed audit/tests requirements drive gate convergence", async (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-renamed-")); t.after(() => rmSync(root, { recursive: true, force: true })); let at = 0; const store = runStore(root, { clock: () => at++ }); store.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: renamedGraph() });
  const runner = createRunRunner({ store, runId: testRunId, invoke: async ({ nodeId }) => ({ kind: nodeId === "implement" ? "complete" : nodeId === "audit" ? "pass" : "approve", summary: "ok", outputBytes: 0 }) });
  assert.equal((await runner.run()).projection.state, "converged");
});
test("persisted time, not a runner clock, decides exact budget exhaustion", async (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-time-")); t.after(() => rmSync(root, { recursive: true, force: true })); const boundary = testGraph.budget.maxMinutes * 60_000, times = [0, boundary, boundary, boundary];
  const store = runStore(root, { clock: () => times.shift() ?? boundary }); store.createRun({ runId: testRunId, itemRef: "item:260722-001#M2", graph: testGraph });
  const runner = createRunRunner({ store, runId: testRunId, clock: () => Number.MAX_SAFE_INTEGER, invoke: async () => ({ kind: "complete", summary: "no", outputBytes: 0 }) });
  await runner.run(); assert.equal(store.replay(testRunId).projection.state, "budget-exhausted");
});
test("every system result restarts through its declared failure terminal without reinvocation", async (t) => {
  for (const kind of ["error", "timeout", "cancelled", "lost", "exhausted"]) {
    const store = fixture(t); let calls = 0, runner = createRunRunner({ store, runId: testRunId, invoke: async () => { calls += 1; return { kind, summary: kind, outputBytes: 0 }; } });
    await runner.step(); await runner.step(); assert.equal(calls, 1); assert.equal(store.replay(testRunId).execution.system.kind, kind); store.releaseLease(testRunId, runner.lease);
    runner = createRunRunner({ store, runId: testRunId, invoke: async () => { calls += 1; throw new Error("duplicate invocation"); } }); await runner.step(); const routed = store.replay(testRunId), target = testGraph.failurePolicy[kind]; assert.equal(routed.projection.currentNode, target); assert.deepEqual(routed.journal.at(-1).value, { schema: "burnlist-loop-m2-journal@1", sequence: routed.projection.sequence, prevDigest: routed.journal.at(-2).digest, at: routed.journal.at(-1).value.at, type: "failure-routed", payload: { from: "implement", kind, to: target } }); store.releaseLease(testRunId, runner.lease);
    runner = createRunRunner({ store, runId: testRunId, invoke: async () => { calls += 1; throw new Error("duplicate invocation"); } }); await runner.step(); const started = store.replay(testRunId); assert.equal(started.journal.at(-1).value.type, "node-started"); assert.equal(started.journal.at(-1).value.payload.nodeId, target); store.releaseLease(testRunId, runner.lease);
    runner = createRunRunner({ store, runId: testRunId, invoke: async () => { calls += 1; throw new Error("duplicate invocation"); } }); const result = await runner.run(), terminalNode = testGraph.nodes.find((node) => node.id === target); assert.equal(result.projection.state, terminalNode.state); assert.equal(result.projection.currentNode, target); assert.equal(result.projection.leaseHeld, false); assert.equal(result.execution.system.kind, kind); assert.equal(calls, 1); assert.equal(result.journal.filter((record) => record.value.type === "invocation-started").length, 1); assert.equal(result.journal.filter((record) => record.value.type === "node-started" && record.value.payload.nodeId === target).length, 1);
  }
});
test("system outcomes near terminal capacity restart to target terminal node", async (t) => {
  const store = fixture(t), acquired = ownerAt253(store);
  store.append(testRunId, acquired.lease, "system-outcome", { kind: "error", summary: "boom" });
  store.releaseLease(testRunId, acquired.lease);
  const runner = createRunRunner({ store, runId: testRunId, invoke: async () => { throw new Error("should not execute"); } });
  const final = await runner.run();
  const last = final.journal.at(-1).value.payload;
  assert.equal(final.projection.sequence, 256);
  assert.equal(final.projection.state, "failed");
  assert.equal(final.projection.currentNode, "failed");
  assert.equal(final.projection.leaseHeld, false);
  assert.equal(final.journal.at(-1).value.type, "terminal-node-committed");
  assert.equal(last.nodeId, "failed");
  assert.equal(last.to, "failed");
  assert.equal(last.attempt, 1);
  assert.equal(final.journal.some((record) => record.value.sequence === 257), false);
});
test("check fail and reviewer reject consume repair cycles before escalation", async (t) => {
  const store = fixture(t), outcomes = ["complete", "fail", "complete", "pass", "reject", "complete", "pass", "escalate"];
  const runner = createRunRunner({ store, runId: testRunId, invoke: async () => ({ kind: outcomes.shift(), summary: "branch", outputBytes: 0 }) });
  const result = await runner.run(); assert.equal(result.projection.state, "needs-human"); assert.equal(result.execution.cycle, 3); assert.equal(result.execution.attempts.implement, 3);
});
test("gate fail is derived when its current required evidence is absent", () => {
  const gate = testGraph.nodes.find((node) => node.kind === "gate");
  assert.equal(gateDecision({ node: gate, cycle: 1, evidence: { verify: { kind: "pass", cycle: 1 } } }, testGraph), "fail");
});
test("recovery fences a persisted invocation and never re-invokes it", async (t) => {
  const store = fixture(t), acquired = store.acquireLease(testRunId), lease = acquired.lease;
  store.append(testRunId, lease, "node-started", { nodeId: "implement", attempt: 1 }); store.append(testRunId, lease, "invocation-started", { nodeId: "implement", attempt: 1, invocationId: "a".repeat(32) }); store.recoverLease(testRunId, { generation: lease.generation, recoveryProof: acquired.recoveryProof });
  let calls = 0; const runner = createRunRunner({ store, runId: testRunId, clock: () => 0, invoke: async () => { calls += 1; return { kind: "complete", summary: "bad", outputBytes: 0 }; } });
  await runner.run(); assert.equal(calls, 0); assert.equal(store.replay(testRunId).projection.state, "needs-human"); assert.equal(store.replay(testRunId).projection.currentNode, "needs-human");
});
test("an unsettled cancellation retains its lease; a second interrupt stops only after settlement", async (t) => {
  const store = fixture(t); let settle;
  const invoke = Object.assign(() => new Promise((resolve) => { settle = resolve; }), { cancel: () => true });
  const runner = createRunRunner({ store, runId: testRunId, invoke }), running = runner.run();
  while (!settle) await new Promise((resolve) => setImmediate(resolve));
  runner.requestPause(); await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(store.read(testRunId).projection.state, "running"); assert.equal(store.read(testRunId).projection.leaseHeld, true);
  runner.requestStop(); settle({ kind: "cancelled", summary: "settled", outputBytes: 0 });
  assert.equal((await running).projection.state, "stopped"); assert.equal(store.read(testRunId).projection.leaseHeld, false);
});
test("a settled foreground interruption pauses without a synthetic result and resumes the unfinished node", async (t) => {
  const store = fixture(t); let settle;
  const interruptedInvoke = Object.assign(() => new Promise((resolve) => { settle = resolve; }), { cancel: () => true });
  const interrupted = createRunRunner({ store, runId: testRunId, invoke: interruptedInvoke });
  const running = interrupted.run(); while (!settle) await new Promise((resolve) => setImmediate(resolve));
  interrupted.requestPause(); settle({ kind: "cancelled", summary: "interrupted", outputBytes: 0 });
  assert.equal((await running).projection.state, "paused");
  const paused = store.replay(testRunId);
  assert.equal(paused.execution.invocation, null); assert.equal(paused.execution.result, null);
  assert.equal(paused.journal.filter((record) => record.value.type === "invocation-result").length, 0);
  const resumed = createRunRunner({ store, runId: testRunId, invoke: async ({ nodeId }) => ({
    kind: nodeId === "implement" ? "complete" : nodeId === "verify" ? "pass" : "approve", summary: "resumed", outputBytes: 0,
  }) });
  const completed = await resumed.run();
  assert.equal(completed.projection.state, "converged");
  assert.equal(completed.journal.filter((record) => record.value.type === "invocation-started" && record.value.payload.nodeId === "implement").length, 2);
});
test("ordinary retry traffic spends the final slot on one lease-clearing journal terminal", async (t) => {
  const store = fixture(t, highBoundaryGraph()), calls = [];
  const runner = createRunRunner({ store, runId: testRunId, invoke: async ({ nodeId }) => { calls.push(nodeId); return { kind: nodeId === "implement" ? "complete" : "fail", summary: "retry", outputBytes: 0 }; } });
  const result = await runner.run(), replay = store.replay(testRunId);
  assert.equal(result.projection.sequence, 256); assert.equal(result.projection.state, "budget-exhausted"); assert.equal(result.projection.leaseHeld, false); assert.equal(result.projection.journal.remaining, 0); assert.equal(replay.journal.at(-1).value.type, "terminal-node-committed"); assert.equal(replay.journal.some((record) => record.value.sequence === 257), false); assert.ok(calls.filter((nodeId) => nodeId === "verify").length > 20);
});
