import { validateClosedIr } from "../dsl/ir-validate.mjs";
import { isRunRef } from "./run-ref.mjs";
import { foldBudgets } from "./budgets.mjs";
import { isSystemOutcome, validateNormalizedResult } from "./run-result.mjs";

const TERMINAL = new Set(["converged", "needs-human", "failed", "stopped", "budget-exhausted"]), SYSTEM = { error: "failed", timeout: "failed", cancelled: "stopped", lost: "needs-human", exhausted: "budget-exhausted" }, ATOMIC = { ...SYSTEM, converged: "converged" };
const exact = (value, keys) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = (message) => { throw Object.assign(new Error(`Run state machine: ${message}`), { code: "ESTATE" }); };
export const isTerminalState = (state) => TERMINAL.has(state);
export const systemState = (kind) => SYSTEM[kind] ?? fail("unknown system outcome");
export const atomicTerminalState = (kind) => ATOMIC[kind] ?? fail("unknown atomic terminal");
export function validateGraph(graph) { if (!validateClosedIr(graph)) fail("graph is not canonical closed IR"); return Object.freeze({ nodes: new Map(graph.nodes.map((node) => [node.id, node])), edges: new Map(graph.edges.map((edge) => [`${edge.from}\0${edge.on}`, edge])) }); }
export function validateStateTransition(from, to, cause) {
  if (!(["control", "graph", "system"].includes(cause))) fail("invalid transition cause");
  const control = (from === "prepared" && ["running", "stopped"].includes(to)) || (from === "running" && ["paused", "stopped"].includes(to)) || (from === "paused" && ["running", "stopped"].includes(to));
  if (cause === "control" && control) return { from, to, cause };
  if (cause === "graph" && from === "running" && TERMINAL.has(to)) return { from, to, cause };
  if (cause === "system" && from === "running" && TERMINAL.has(to)) return { from, to, cause };
  fail("closed lifecycle transition rejected");
}
function gateOutcome(runtime, node) {
  const valid = node.requires.every((id) => {
    const evidence = runtime.evidence[id], required = runtime.nodes.get(id);
    return evidence?.cycle === runtime.cycle && evidence.candidateId === (runtime.candidate?.id ?? null)
      && (required?.kind === "check" ? evidence.kind === "pass" : required?.kind === "agent" && required.mode === "review" && evidence.kind === "approve");
  });
  return valid ? "pass" : "fail";
}
export function foldStateMachine({ graph, records }) {
  const { nodes, edges } = validateGraph(graph), first = records[0]?.value?.payload;
  if (!first || first.type !== undefined && records[0].value.type !== "run-created" || !isRunRef(first.runId)) fail("invalid RunRef creation");
  const current = { state: "prepared", generation: 0, lease: null }, runtime = { nodeId: graph.entry, attempts: {}, started: false, invocation: null, result: null, system: null, cycle: 0, evidence: {}, candidate: null, latest: { maker: null, check: null, reviewer: null }, nodes, edges };
  for (const [index, record] of records.entries()) {
    const { type, payload } = record.value, node = nodes.get(runtime.nodeId); if (!index) continue;
    if (type === "state-changed") { if (!exact(payload, ["from", "to", "cause"]) || payload.from !== current.state) fail("invalid state event"); validateStateTransition(payload.from, payload.to, payload.cause); if (payload.cause === "control" && payload.to === "paused" && runtime.invocation && !runtime.result) runtime.invocation = null; if (payload.cause === "graph" && (!node || node.kind !== "terminal" || !runtime.started || payload.to !== node.state)) fail("graph terminal bypass"); if (payload.cause === "system" && (!runtime.system || payload.to !== systemState(runtime.system.kind))) fail("system terminal bypass"); current.state = payload.to; continue; }
    if (type === "lease-acquired") { if (!exact(payload, ["generation", "token"]) || current.state !== "running" || current.lease || payload.generation !== current.generation + 1 || !/^[a-f0-9]{64}$/u.test(payload.token)) fail("invalid lease acquisition"); current.generation = payload.generation; current.lease = payload; continue; }
    if (type === "lease-released" || type === "lease-revoked") { if (!exact(payload, ["generation", "token"]) || !current.lease || payload.generation !== current.lease.generation || payload.token !== current.lease.token) fail("stale lease change"); current.lease = null; continue; }
    if (type === "terminal-node-committed") { const cleanup = isTerminalState(current.state), targetState = atomicTerminalState(payload.kind), expectedState = cleanup ? current.state : targetState, expectedNode = payload.kind === "converged" ? graph.nodes.find((item) => item.kind === "terminal" && item.state === "converged")?.id : graph.failurePolicy[payload.kind], targetNode = nodes.get(payload.nodeId), alreadyStarted = runtime.nodeId === payload.nodeId && runtime.started, expectedAttempt = alreadyStarted ? runtime.attempts[payload.nodeId] : (runtime.attempts[payload.nodeId] ?? 0) + 1; if (!exact(payload, ["kind", "summary", "from", "to", "nodeId", "attempt"]) || payload.from !== current.state || !cleanup && !["prepared", "paused", "running"].includes(payload.from) || cleanup && targetState !== current.state || payload.to !== expectedState || payload.nodeId !== expectedNode || targetNode?.kind !== "terminal" || targetNode.state !== payload.to || payload.attempt !== expectedAttempt || typeof payload.summary !== "string" || Buffer.byteLength(payload.summary, "utf8") > 1024 || runtime.system && (runtime.system.kind !== payload.kind || runtime.system.summary !== payload.summary)) fail("invalid atomic terminal node"); runtime.system ??= Object.freeze({ kind: payload.kind, summary: payload.summary, outputBytes: 0 }); if (!alreadyStarted) { runtime.nodeId = payload.nodeId; runtime.started = true; runtime.invocation = null; runtime.result = null; runtime.attempts[payload.nodeId] = payload.attempt; } current.lease = null; current.state = payload.to; continue; }
    if (!current.lease || current.state !== "running") fail("active event lacks lease");
    if (type === "node-started") { if (!exact(payload, ["nodeId", "attempt"]) || payload.nodeId !== runtime.nodeId || runtime.started || payload.attempt !== (runtime.attempts[payload.nodeId] ?? 0) + 1) fail("invalid node start"); runtime.started = true; runtime.attempts[payload.nodeId] = payload.attempt; if (node.kind === "agent" && node.mode === "task") { runtime.cycle += 1; runtime.candidate = null; } continue; }
    if (type === "invocation-started") { if (!exact(payload, ["nodeId", "attempt", "invocationId"]) || !runtime.started || runtime.invocation || !["agent", "check"].includes(node.kind) || payload.nodeId !== runtime.nodeId || payload.attempt !== runtime.attempts[payload.nodeId] || !/^[a-f0-9]{32}$/u.test(payload.invocationId)) fail("invalid invocation start"); runtime.invocation = payload; continue; }
    if (type === "invocation-result") {
      if (!runtime.invocation || runtime.result || !exact(payload, ["invocationId", "kind", "summary", "outputBytes", "candidateId"]) || payload.invocationId !== runtime.invocation.invocationId) fail("invalid invocation result");
      runtime.result = validateNormalizedResult({ kind: payload.kind, summary: payload.summary, outputBytes: payload.outputBytes, candidateId: payload.candidateId }, node, graph.budget.maxOutputBytes);
      const role = node.kind === "check" ? "check" : node.mode === "review" ? "reviewer" : "maker";
      if (node.kind !== "agent" || node.mode !== "task") {
        if (payload.candidateId !== (runtime.candidate?.id ?? null)) fail("result is not bound to the current candidate");
      } else if (payload.candidateId !== null && payload.candidateId !== (runtime.candidate?.id ?? null)) fail("maker result candidate is invalid");
      runtime.latest[role] = { summary: runtime.result.summary, at: record.value.at, candidateId: runtime.result.candidateId };
      if (isSystemOutcome(runtime.result.kind)) runtime.system = runtime.result;
      else runtime.evidence[runtime.nodeId] = { kind: runtime.result.kind, cycle: runtime.cycle, candidateId: runtime.result.candidateId };
      continue;
    }
    if (type === "candidate-bound") {
      if (!exact(payload, ["candidateId", "candidateContext"]) || node?.kind !== "agent" || node.mode !== "task" || !runtime.result || runtime.result.kind !== "complete" || runtime.candidate
        || !/^cm1-sha256:[a-f0-9]{64}$/u.test(payload.candidateId) || typeof payload.candidateContext !== "string" || !payload.candidateContext || Buffer.byteLength(payload.candidateContext, "utf8") > 65_536) fail("invalid candidate binding");
      runtime.candidate = Object.freeze({ id: payload.candidateId, context: payload.candidateContext });
      runtime.latest.maker = { summary: runtime.result.summary, at: record.value.at, candidateId: payload.candidateId };
      runtime.evidence[runtime.nodeId] = { kind: runtime.result.kind, cycle: runtime.cycle, candidateId: payload.candidateId };
      continue;
    }
    if (type === "system-outcome") { if (runtime.system || !exact(payload, ["kind", "summary"]) || !isSystemOutcome(payload.kind) || typeof payload.summary !== "string" || Buffer.byteLength(payload.summary, "utf8") > 1024) fail("invalid system outcome"); runtime.system = Object.freeze({ kind: payload.kind, summary: payload.summary, outputBytes: 0 }); continue; }
    if (type === "failure-routed") { const target = nodes.get(payload?.to); if (!runtime.system || !exact(payload, ["from", "kind", "to"]) || payload.from !== runtime.nodeId || payload.kind !== runtime.system.kind || payload.to !== graph.failurePolicy[payload.kind] || payload.to === runtime.nodeId || target?.kind !== "terminal" || target.state !== systemState(payload.kind)) fail("invalid failure route"); runtime.nodeId = payload.to; runtime.started = false; runtime.invocation = null; runtime.result = null; continue; }
    if (type === "edge-taken") { if (!exact(payload, ["from", "on", "to"]) || payload.from !== runtime.nodeId) fail("invalid edge event"); const edge = edges.get(`${payload.from}\0${payload.on}`); if (!edge || edge.to !== payload.to) fail("undeclared edge"); if (node.kind === "gate" ? payload.on !== gateOutcome(runtime, node) : !runtime.result || isSystemOutcome(runtime.result.kind) || payload.on !== runtime.result.kind) fail("edge outcome is not current result"); runtime.nodeId = edge.to; runtime.started = false; runtime.invocation = null; runtime.result = null; continue; }
    fail("unknown event");
  }
  const budget = foldBudgets({ records, graph });
  return Object.freeze({ state: current.state, generation: current.generation, lease: current.lease && Object.freeze({ ...current.lease }), nodeId: runtime.nodeId, node: nodes.get(runtime.nodeId), attempts: Object.freeze({ ...runtime.attempts }), attempt: runtime.attempts[runtime.nodeId] ?? 0, cycle: runtime.cycle, evidence: Object.freeze({ ...runtime.evidence }), candidate: runtime.candidate, latest: Object.freeze({ ...runtime.latest }), started: runtime.started, invocation: runtime.invocation && Object.freeze({ ...runtime.invocation }), result: runtime.result, system: runtime.system, budget, terminal: isTerminalState(current.state) });
}
export function gateDecision(execution, graph) { return gateOutcome({ evidence: execution.evidence, candidate: execution.candidate, cycle: execution.cycle, nodes: new Map(graph.nodes.map((node) => [node.id, node])) }, execution.node); }
