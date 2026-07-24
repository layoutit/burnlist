import { createDiagnostics } from "./diagnostics.mjs";
import { normalizeIr } from "./canonical.mjs";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const route = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const semver = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
const positive = /^[1-9][0-9]*$/;
const order = ["budget", "agent", "check", "agent", "gate", "terminal", "terminal", "terminal", "terminal", "terminal", "failure-policy", "edge", "edge", "edge", "edge", "edge", "edge", "edge", "edge"];
const attrs = {
  loop: ["id", "version", "entry"], budget: ["max-rounds", "max-minutes", "max-agent-runs", "max-check-runs", "max-transitions", "max-output-bytes"],
  agent: ["id", "mode", "role", "route", "authority", "instructions", "independent-from", "requires"], check: ["id", "capability"], gate: ["id", "kind", "requires"],
  terminal: ["id", "state"], "failure-policy": ["error", "timeout", "cancelled", "lost", "exhausted"], edge: ["from", "on", "to", "max-visits"],
};
const required = {
  loop: attrs.loop, budget: attrs.budget, agent: ["id", "mode", "role", "route", "authority", "instructions"], check: ["id", "capability"], gate: attrs.gate, terminal: attrs.terminal,
  "failure-policy": attrs["failure-policy"], edge: ["from", "on", "to"],
};
const outcomes = { agent: (node) => node.mode === "task" ? ["complete"] : ["approve", "reject", "escalate"], check: () => ["pass", "fail"], gate: () => ["pass", "fail"], terminal: () => [] };
const terminalStates = ["converged", "needs-human", "failed", "stopped", "budget-exhausted"];
const limits = { "max-rounds": [1, 100], "max-minutes": [1, 1440], "max-agent-runs": [1, 100], "max-check-runs": [1, 100], "max-transitions": [1, 1000], "max-output-bytes": [1024, 1048576] };

function add(d, node, code, message) { d.add("review.loop", node?.byteOffset ?? 0, code, message); }
function exactAttrs(d, node) {
  const allowed = attrs[node.name];
  if (!allowed) { add(d, node, "E_ELEMENT_UNKNOWN", `Unknown Stage 1 element <${node.name}>`); return; }
  for (const key of Object.keys(node.attrs)) if (!allowed.includes(key)) add(d, node, "E_ATTRIBUTE_UNKNOWN", `Attribute ${key} is not allowed on <${node.name}>`);
  for (const key of required[node.name]) if (!(key in node.attrs)) add(d, node, "E_ATTRIBUTE_REQUIRED", `<${node.name}> requires attribute ${key}`);
}
function value(d, node, key, test, description) { if (key in node.attrs && !test(node.attrs[key])) add(d, node, "E_SCALAR", `${key} must be ${description}`); }
function reachesTerminal(nodes, edges, start) {
  const byFrom = new Map(); for (const edge of edges) (byFrom.get(edge.from) ?? byFrom.set(edge.from, []).get(edge.from)).push(edge.to);
  const seen = new Set(), work = [start]; while (work.length) { const id = work.pop(); if (seen.has(id)) continue; seen.add(id); for (const next of byFrom.get(id) ?? []) work.push(next); }
  return seen;
}
function backEdges(nodes, edges, entry) {
  const byFrom = new Map(); for (const edge of edges) (byFrom.get(edge.from) ?? byFrom.set(edge.from, []).get(edge.from)).push(edge);
  const color = new Map(), result = new Set();
  const visit = (id) => { color.set(id, 1); for (const edge of byFrom.get(id) ?? []) { if (color.get(edge.to) === 1) result.add(edge); else if (!color.get(edge.to)) visit(edge.to); } color.set(id, 2); };
  visit(entry); return result;
}

/** Validates the full closed Stage 1 grammar and emits normalized symbolic IR. */
export function validateLoop(ast) {
  const d = createDiagnostics();
  if (!ast || ast.name !== "loop") { add(d, ast, "E_ROOT", "Root element must be <loop>"); return { diagnostics: d.list, allDiagnostics: d.all }; }
  exactAttrs(d, ast);
  if (ast.selfClosing) add(d, ast, "E_ROOT_FORM", "Root <loop> must not be self-closing");
  value(d, ast, "id", (v) => slug.test(v), "a lowercase slug"); value(d, ast, "version", (v) => semver.test(v), "a Stage 1 SemVer"); value(d, ast, "entry", (v) => slug.test(v), "a lowercase slug");
  ast.children.forEach((node, index) => { exactAttrs(d, node); if (!node.selfClosing) add(d, node, "E_CHILD_FORM", `<${node.name}> must be self-closing`); if (node.children.length) add(d, node, "E_CHILDREN", `<${node.name}> may not have children`); if (node.name !== order[index]) add(d, node, "E_CHILD_ORDER", "Children must use the closed Stage 1 group order"); if (index === 1 && node.attrs.mode !== "task") add(d, node, "E_CHILD_GROUP", "Maker agent group must precede check"); if (index === 3 && node.attrs.mode !== "review") add(d, node, "E_CHILD_GROUP", "Reviewer agent group must follow check"); });
  if (ast.children.length !== order.length) add(d, ast, "E_CHILD_COUNT", "Loop must contain the exact closed Stage 1 child set");
  const ids = new Map(), nodes = [], edges = [], policy = ast.children.find((node) => node.name === "failure-policy");
  for (const node of ast.children) {
    if (["agent", "check", "gate", "terminal"].includes(node.name)) {
      value(d, node, "id", (v) => slug.test(v), "a lowercase slug");
      if (node.attrs.id && ids.has(node.attrs.id)) add(d, node, "E_ID_DUPLICATE", `Duplicate id ${node.attrs.id}`); else if (node.attrs.id) ids.set(node.attrs.id, node);
    }
    if (node.name === "budget") for (const [key, [min, max]] of Object.entries(limits)) value(d, node, key, (v) => positive.test(v) && +v >= min && +v <= max, `an integer from ${min} through ${max}`);
    if (node.name === "agent") {
      value(d, node, "mode", (v) => v === "task" || v === "review", "task or review"); value(d, node, "role", (v) => v === "maker" || v === "reviewer", "maker or reviewer");
      value(d, node, "route", (v) => route.test(v), "a Route"); value(d, node, "authority", (v) => v === "read" || v === "write", "read or write"); value(d, node, "instructions", (v) => slug.test(v), "a lowercase slug");
      const task = node.attrs.mode === "task"; const expected = task ? ["maker", "write"] : ["reviewer", "read"];
      if ((node.attrs.role && node.attrs.authority) && (node.attrs.role !== expected[0] || node.attrs.authority !== expected[1])) add(d, node, "E_AGENT_COMBINATION", `${node.attrs.mode} agent must be ${expected[0]}/${expected[1]}`);
      if (task && ("independent-from" in node.attrs || "requires" in node.attrs)) add(d, node, "E_AGENT_ATTRIBUTES", "Task agent may not have review-only attributes");
      if (!task) { for (const key of ["independent-from", "requires"]) if (!(key in node.attrs)) add(d, node, "E_ATTRIBUTE_REQUIRED", `<agent> requires attribute ${key}`); if (node.attrs.requires !== "fresh-session:enforced,filesystem-write-deny:supervised") add(d, node, "E_REVIEW_REQUIREMENTS", "Review requires must be fresh-session:enforced,filesystem-write-deny:supervised"); }
      nodes.push({ kind: "agent", id: node.attrs.id, mode: node.attrs.mode, role: node.attrs.role, route: node.attrs.route, authority: node.attrs.authority, instructions: node.attrs.instructions, independentFrom: node.attrs["independent-from"] ?? null, requires: node.attrs.requires ? node.attrs.requires.split(",") : [] });
    }
    if (node.name === "check") { value(d, node, "capability", (v) => slug.test(v), "a lowercase slug"); nodes.push({ kind: "check", id: node.attrs.id, capability: node.attrs.capability }); }
    if (node.name === "gate") { if (node.attrs.kind !== "convergence") add(d, node, "E_GATE_KIND", "Stage 1 gate kind must be convergence"); nodes.push({ kind: "gate", id: node.attrs.id, gateKind: node.attrs.kind, requires: node.attrs.requires?.split(",") ?? [] }); }
    if (node.name === "terminal") { if (!terminalStates.includes(node.attrs.state)) add(d, node, "E_TERMINAL_STATE", "Terminal state is not allowed in Stage 1"); nodes.push({ kind: "terminal", id: node.attrs.id, state: node.attrs.state }); }
    if (node.name === "edge") { if ("max-visits" in node.attrs) value(d, node, "max-visits", (v) => positive.test(v) && +v <= 100, "an integer from 1 through 100"); edges.push({ from: node.attrs.from, on: node.attrs.on, to: node.attrs.to, maxVisits: node.attrs["max-visits"] ? +node.attrs["max-visits"] : null, offset: node.byteOffset }); }
  }
  const agents = nodes.filter((node) => node.kind === "agent"), checks = nodes.filter((node) => node.kind === "check"), gates = nodes.filter((node) => node.kind === "gate"), terminals = nodes.filter((node) => node.kind === "terminal");
  if (agents.length !== 2 || agents.filter((node) => node.mode === "task").length !== 1 || agents.filter((node) => node.mode === "review").length !== 1) add(d, ast, "E_AGENT_CARDINALITY", "Stage 1 requires one task agent and one review agent");
  if (checks.length !== 1 || gates.length !== 1) add(d, ast, "E_NODE_CARDINALITY", "Stage 1 requires exactly one check and one convergence gate");
  for (const state of terminalStates) if (terminals.filter((node) => node.state === state).length !== 1) add(d, ast, "E_TERMINAL_CARDINALITY", `Stage 1 requires exactly one ${state} terminal`);
  const reviewer = agents.find((node) => node.mode === "review"), maker = agents.find((node) => node.mode === "task"), check = checks[0], gate = gates[0];
  if (reviewer && reviewer.independentFrom !== maker?.id) add(d, ids.get(reviewer.id), "E_REVIEW_INDEPENDENCE", "Reviewer independent-from must name the task agent");
  if (gate && `${gate.requires.join(",")}` !== `${check?.id ?? ""},${reviewer?.id ?? ""}`) add(d, ids.get(gate.id), "E_GATE_REQUIREMENTS", "Convergence gate requires must name check then reviewer");
  if (policy) for (const [outcome, state] of Object.entries({ error: "failed", timeout: "failed", cancelled: "stopped", lost: "needs-human", exhausted: "budget-exhausted" })) { const target = ids.get(policy.attrs[outcome]); if (!target || target.attrs.state !== state) add(d, policy, "E_FAILURE_POLICY", `${outcome} must target the ${state} terminal`); }
  for (const edge of edges) {
    const from = ids.get(edge.from), to = ids.get(edge.to);
    if (!from || !to) { d.add("review.loop", edge.offset, "E_EDGE_REFERENCE", "Edge endpoints must name declared nodes"); continue; }
    if (from.name === "terminal") d.add("review.loop", edge.offset, "E_EDGE_TERMINAL", "Terminal nodes may not have edges");
    const source = nodes.find((node) => node.id === edge.from);
    if (!outcomes[source?.kind]?.(source).includes(edge.on)) d.add("review.loop", edge.offset, "E_EDGE_OUTCOME", `Outcome ${edge.on} is not emitted by ${edge.from}`);
    const target = nodes.find((node) => node.id === edge.to);
    const allowed = (source?.kind === "agent" && source.mode === "task" && edge.on === "complete" && target?.kind === "check") ||
      (source?.kind === "check" && edge.on === "pass" && target?.kind === "agent" && target.mode === "review") ||
      (source?.kind === "check" && edge.on === "fail" && target?.kind === "agent" && target.mode === "task") ||
      (source?.kind === "agent" && source.mode === "review" && edge.on === "reject" && target?.kind === "agent" && target.mode === "task") ||
      (source?.kind === "agent" && source.mode === "review" && edge.on === "approve" && target?.kind === "gate") ||
      (source?.kind === "agent" && source.mode === "review" && edge.on === "escalate" && target?.kind === "terminal" && target.state === "needs-human") ||
      (source?.kind === "gate" && edge.on === "pass" && target?.kind === "terminal" && target.state === "converged") ||
      (source?.kind === "gate" && edge.on === "fail" && target?.kind === "terminal" && target.state === "needs-human");
    if (!allowed) d.add("review.loop", edge.offset, "E_EDGE_TARGET", `Target ${edge.to} is not allowed for ${edge.from}/${edge.on}`);
  }
  const pairs = new Set(); for (const edge of edges) { const key = `${edge.from}\0${edge.on}`; if (pairs.has(key)) d.add("review.loop", edge.offset, "E_EDGE_DUPLICATE", `Duplicate edge outcome ${edge.from}/${edge.on}`); pairs.add(key); }
  for (const node of nodes.filter((node) => node.kind !== "terminal")) for (const outcome of outcomes[node.kind](node)) if (!pairs.has(`${node.id}\0${outcome}`)) add(d, ids.get(node.id), "E_EDGE_MISSING", `Missing edge for ${node.id}/${outcome}`);
  const converged = terminals.find((node) => node.state === "converged");
  if (converged) for (const edge of edges.filter((edge) => edge.to === converged.id)) if (edge.from !== gate?.id || edge.on !== "pass") d.add("review.loop", edge.offset, "E_CONVERGENCE_DOMINATION", "Only convergence gate pass may target the converged terminal");
  if (converged && !edges.some((edge) => edge.from === gate?.id && edge.on === "pass" && edge.to === converged.id)) add(d, ids.get(gate?.id), "E_CONVERGENCE_DOMINATION", "Convergence gate pass must target the converged terminal");
  // System outcomes are runner-owned but are still graph routes for reachability.
  const systemEdges = policy ? nodes.filter((node) => node.kind !== "terminal").flatMap((node) => Object.entries(policy.attrs).map(([on, to]) => ({ from: node.id, on, to }))) : [];
  const reachable = reachesTerminal(nodes, [...edges, ...systemEdges], ast.attrs.entry); if (!ids.has(ast.attrs.entry)) add(d, ast, "E_ENTRY", "Entry must name a declared node");
  else for (const node of nodes) if (!reachable.has(node.id)) add(d, ids.get(node.id), "E_REACHABILITY", `Node ${node.id} is not reachable from entry`);
  const back = ids.has(ast.attrs.entry) ? backEdges(nodes, edges, ast.attrs.entry) : new Set();
  for (const edge of edges) { const needs = back.has(edge); if (needs !== (edge.maxVisits !== null)) d.add("review.loop", edge.offset, "E_EDGE_VISITS", needs ? "DFS back edges require max-visits" : "max-visits is allowed only on DFS back edges"); }
  if (d.all.length) return { diagnostics: d.list, allDiagnostics: d.all };
  const ir = normalizeIr({ schema: "burnlist-loop-ir@1", compiler: "burnlist-loop-compiler@1", id: ast.attrs.id, declaredVersion: ast.attrs.version, entry: ast.attrs.entry,
    budget: { maxRounds: +ast.children[0].attrs["max-rounds"], maxMinutes: +ast.children[0].attrs["max-minutes"], maxAgentRuns: +ast.children[0].attrs["max-agent-runs"], maxCheckRuns: +ast.children[0].attrs["max-check-runs"], maxTransitions: +ast.children[0].attrs["max-transitions"], maxOutputBytes: +ast.children[0].attrs["max-output-bytes"] }, nodes, failurePolicy: { error: policy.attrs.error, timeout: policy.attrs.timeout, cancelled: policy.attrs.cancelled, lost: policy.attrs.lost, exhausted: policy.attrs.exhausted }, edges: edges.map(({ offset, ...edge }) => edge), instructions: [] }, (node) => outcomes[node.kind](node));
  return { ir, instructionIds: agents.map((node) => node.instructions), diagnostics: [], allDiagnostics: [] };
}

export function outcomesFor(node) { return outcomes[node.kind](node); }
