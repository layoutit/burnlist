import { randomBytes } from "node:crypto";
import { budgetReason } from "./budgets.mjs";
import { gateDecision } from "./state-machine.mjs";
import { isSystemOutcome, validateNormalizedResult } from "./run-result.mjs";

const fail = (message) => { throw Object.assign(new Error(`Run runner: ${message}`), { code: "ERUNNER" }); };
function boundedSummary(value) {
  const bytes = Buffer.from(String(value ?? "candidate capture failed"), "utf8");
  if (bytes.length <= 1024) return bytes.toString("utf8");
  let end = 1024;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
export function createRunRunner({ store, runId, invoke, bindCandidate = null }) {
  if (!store?.replay || !store?.append || !store?.acquireLease || !store?.terminalize || typeof invoke !== "function") fail("invalid runner input");
  let lease = null, pauseRequested = false, stopRequested = false, cancelRequested = false, cancelWake = null;
  const read = () => store.replay(runId), append = (type, payload) => store.append(runId, lease, type, payload);
  function transition(to, cause) { const execution = read().execution; return append("state-changed", { from: execution.state, to, cause }); }
  function edge(execution, on) { const current = read(), target = current.graph.edges.find((item) => item.from === execution.nodeId && item.on === on); if (!target) fail("outcome has no declared edge"); const exhausted = budgetReason({ folded: execution.budget, graph: current.graph, edge: target }); if (exhausted) return system("exhausted", exhausted); return append("edge-taken", { from: target.from, on, to: target.to }); }
  function system(kind, summary) { return append("system-outcome", { kind, summary }); }
  function routeSystem(current, execution) { const target = current.graph.failurePolicy[execution.system.kind]; if (execution.nodeId !== target) return append("failure-routed", { from: execution.nodeId, kind: execution.system.kind, to: target }); if (!execution.started) return append("node-started", { nodeId: target, attempt: execution.attempt + 1 }); return transition(execution.node.state, "graph"); }
  async function step() {
    let current = read(), execution = current.execution; if (execution.terminal) return { kind: "terminal", state: execution.state }; if (!lease) lease = store.acquireLease(runId).lease;
    current = read(); execution = current.execution; if (execution.terminal) { lease = null; return { kind: "terminal", state: execution.state }; } if (execution.system) return routeSystem(current, execution); const node = execution.node; if (execution.budget.elapsedMilliseconds >= current.graph.budget.maxMinutes * 60_000) return system("exhausted", "minutes");
    if (!execution.started) { const exhausted = budgetReason({ folded: execution.budget, graph: current.graph, node }); if (exhausted) return system("exhausted", exhausted); return append("node-started", { nodeId: node.id, attempt: execution.attempt + 1 }); }
    if (node.kind === "terminal") return transition(node.state, "graph");
    if (node.kind === "gate") return edge(execution, gateDecision(execution, current.graph));
    if (execution.result) {
      if (node.kind === "agent" && node.mode === "task" && execution.result.kind === "complete" && !execution.candidate && typeof bindCandidate === "function") {
        try {
          const candidate = bindCandidate({ runId, nodeId: node.id, attempt: execution.attempt, result: execution.result });
          return append("candidate-bound", candidate);
        } catch (error) {
          return system("error", boundedSummary(error?.message));
        }
      }
      return edge(execution, execution.result.kind);
    }
    if (execution.invocation) return system("lost", "persisted invocation requires recovery");
    append("invocation-started", { nodeId: node.id, attempt: execution.attempt, invocationId: randomBytes(16).toString("hex") }); current = read(); execution = current.execution;
    const pending = Promise.resolve(invoke(Object.freeze({ runId, nodeId: node.id, attempt: execution.attempt, invocationId: execution.invocation.invocationId })))
      .then((value) => ({ value }), (error) => ({ error }));
    let result;
    const raced = cancelRequested ? { cancelled: true } : await Promise.race([pending, new Promise((resolve) => { cancelWake = () => resolve({ cancelled: true }); })]);
    cancelWake = null;
    if (raced?.cancelled || cancelRequested || pauseRequested || stopRequested) {
      invoke.cancel?.();
      // A control request fences the Run until the real foreground handle has
      // settled.  Never manufacture a cancellation result: releasing a lease
      // while a child may still write would permit a split-brain resume.
      const settled = await pending;
      result = settled.error ? { kind: "error", summary: String(settled.error?.message ?? "invocation error"), outputBytes: 0 } : settled.value;
    } else result = raced.error ? { kind: "error", summary: String(raced.error?.message ?? "invocation error"), outputBytes: 0 } : raced.value;
    // A pause is committed only after the foreground handle has settled.  Its
    // cancelled result is intentionally not journalled: it has no graph edge,
    // and the next foreground owner must retry this unfinished invocation.
    const cleanupLost = result?.kind === "lost";
    if (pauseRequested && !stopRequested && !cleanupLost) return { kind: "paused" };
    if (cleanupLost) { pauseRequested = false; cancelRequested = false; }
    result = validateNormalizedResult({ ...result, candidateId: result.candidateId ?? execution.candidate?.id ?? null }, node, current.graph.budget.maxOutputBytes); const exhausted = budgetReason({ folded: execution.budget, graph: current.graph, outputBytes: result.outputBytes });
    return append("invocation-result", { invocationId: execution.invocation.invocationId, ...(exhausted ? { kind: "exhausted", summary: exhausted, outputBytes: 0, candidateId: execution.candidate?.id ?? null } : result) });
  }
  function pause() {
    const current = read();
    if (current.execution.terminal || current.execution.state === "paused") return current;
    if (!lease || current.execution.state !== "running" || current.execution.invocation && !current.execution.result && !pauseRequested)
      fail("pause requires an idle foreground lease");
    append("state-changed", { from: "running", to: "paused", cause: "control" });
    store.releaseLease(runId, lease); lease = null; return read();
  }
  function stop() {
    const current = read(); if (current.execution.terminal) return current;
    if (!lease) lease = store.acquireLease(runId).lease;
    const result = store.terminalize(runId, lease, "cancelled", "control"); lease = null; return result;
  }
  async function run() { for (;;) {
    if (stopRequested) return stop();
    await step();
    // A second SIGINT upgrades a pending pause to stop while the invocation
    // settles.  Check it before the pause branch so terminal control wins.
    if (stopRequested) return stop();
    const current = read();
    if (current.execution.terminal) { if (lease && current.execution.lease) store.releaseLease(runId, lease); lease = null; return read(); }
    if (pauseRequested) return pause();
  } }
  function requestPause() { pauseRequested = true; cancelRequested = true; invoke.cancel?.(); cancelWake?.(); }
  function requestStop() { stopRequested = true; cancelRequested = true; invoke.cancel?.(); cancelWake?.(); }
  return Object.freeze({ step, run, pause, stop, requestPause, requestStop, replay: read, get lease() { return lease; } });
}
