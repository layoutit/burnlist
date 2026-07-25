import { normalizeIr } from "./canonical.mjs";
import { outcomesFor } from "./grammar.mjs";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const route = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const semver = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
const states = ["converged", "needs-human", "failed", "stopped", "budget-exhausted"];
const top = ["schema", "compiler", "id", "declaredVersion", "entry", "budget", "nodes", "failurePolicy", "edges", "instructions"];
const budget = ["maxRounds", "maxMinutes", "maxAgentRuns", "maxCheckRuns", "maxTransitions", "maxOutputBytes"];
const policy = ["error", "timeout", "cancelled", "lost", "exhausted"];
const nodeKeys = { agent: ["kind", "id", "mode", "execution", "intelligence", "role", "route", "authority", "instructions", "independentFrom", "requires"], check: ["kind", "id", "capability"], gate: ["kind", "id", "gateKind", "requires"], terminal: ["kind", "id", "state"] };
const limits = { maxRounds: [1, 100], maxMinutes: [1, 1440], maxAgentRuns: [1, 100], maxCheckRuns: [1, 100], maxTransitions: [1, 1000], maxOutputBytes: [1024, 1048576] };
const reviewRequirements = ["fresh-session:enforced", "filesystem-write-deny:supervised"];

function exact(value, keys) { return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function boundedSlug(value) { return typeof value === "string" && value.length <= 65536 && slug.test(value); }
function integer(value, range = [0, Number.MAX_SAFE_INTEGER]) { return Number.isSafeInteger(value) && value >= range[0] && value <= range[1]; }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function validNode(node) {
  if (!exact(node, nodeKeys[node?.kind] ?? []) || !boundedSlug(node.id)) return false;
  if (node.kind === "agent") {
    if (!["task", "review"].includes(node.mode) || !["managed", "host"].includes(node.execution)
      || !["fast", "standard", "strong", "critical"].includes(node.intelligence)
      || !route.test(node.route) || !boundedSlug(node.instructions)
      || !Array.isArray(node.requires) || node.requires.some((item) => typeof item !== "string" || item.length > 128)) return false;
    return node.mode === "task"
      ? node.role === "maker" && node.authority === "write" && node.independentFrom === null && node.requires.length === 0
      : node.role === "reviewer" && node.authority === "read" && boundedSlug(node.independentFrom) && same(node.requires, reviewRequirements);
  }
  if (node.kind === "check") return boundedSlug(node.capability);
  if (node.kind === "gate") return node.gateKind === "convergence" && Array.isArray(node.requires) && node.requires.every(boundedSlug);
  return states.includes(node.state);
}

function backEdges(nodes, edges, entry) {
  const byFrom = new Map();
  for (const edge of edges) {
    (byFrom.get(edge.from) ?? byFrom.set(edge.from, []).get(edge.from)).push(edge.to);
  }
  const color = new Map();
  const result = new Set();
  const visit = (id) => {
    color.set(id, 1);
    for (const to of byFrom.get(id) ?? []) {
      if (color.get(to) === 1) {
        result.add(`${id}\0${to}`);
      } else if (!color.get(to)) {
        visit(to);
      }
    }
    color.set(id, 2);
  };
  if (nodes.some((node) => node.id === entry)) visit(entry);
  return result;
}

function targetAllowed(source, outcome, target) {
  return (source.kind === "agent" && source.mode === "task" && outcome === "complete" && target.kind !== "terminal") ||
    (source.kind === "check" && outcome === "pass" && target.kind === "agent" && target.mode === "review") ||
    (source.kind === "check" && outcome === "fail" && target.kind === "agent" && target.mode === "task") ||
    (source.kind === "agent" && source.mode === "review" && outcome === "reject" && target.kind !== "terminal") ||
    (source.kind === "agent" && source.mode === "review" && outcome === "approve" && target.kind !== "terminal") ||
    (source.kind === "agent" && source.mode === "review" && outcome === "escalate" && target.kind === "terminal" && target.state === "needs-human") ||
    (source.kind === "gate" && outcome === "pass" && target.kind === "terminal" && target.state === "converged") ||
    (source.kind === "gate" && outcome === "fail" && target.kind === "terminal" && target.state === "needs-human");
}

/** Rejects every noncanonical or unsupported symbolic IR before frozen replay. */
export function validateClosedIr(ir) {
  if (!exact(ir, top) || ir.schema !== "burnlist-loop-ir@1" || ir.compiler !== "burnlist-loop-compiler@1" || !boundedSlug(ir.id) || !semver.test(ir.declaredVersion) || !boundedSlug(ir.entry) || !exact(ir.budget, budget) || !Object.entries(limits).every(([key, range]) => integer(ir.budget[key], range)) || !exact(ir.failurePolicy, policy) || !Object.values(ir.failurePolicy).every(boundedSlug) || !Array.isArray(ir.nodes) || ir.nodes.length > 64 || !ir.nodes.every(validNode) || !Array.isArray(ir.edges) || ir.edges.length > 512 || !Array.isArray(ir.instructions) || ir.instructions.length > 64) return false;
  const ids = new Map(ir.nodes.map((node) => [node.id, node]));
  if (ids.size !== ir.nodes.length || !ids.has(ir.entry)) return false;
  const agents = ir.nodes.filter((node) => node.kind === "agent");
  const makers = agents.filter((node) => node.mode === "task" && node.role === "maker" && node.authority === "write");
  const reviewers = agents.filter((node) => node.mode === "review" && node.role === "reviewer" && node.authority === "read");
  const checks = ir.nodes.filter((node) => node.kind === "check");
  const gates = ir.nodes.filter((node) => node.kind === "gate");
  const terminals = ir.nodes.filter((node) => node.kind === "terminal");
  const agentInstructionIds = new Set(agents.map((agent) => agent.instructions));

  if (makers.length < 1 || reviewers.length < 1 || checks.length < 1 || gates.length !== 1 || states.some((state) => terminals.filter((node) => node.state === state).length !== 1)) return false;
  if (ids.get(ir.entry)?.kind !== "agent" || ids.get(ir.entry)?.mode !== "task") return false;
  if (!reviewers.every((reviewer) => ids.get(reviewer.independentFrom)?.kind === "agent" && ids.get(reviewer.independentFrom)?.mode === "task")) return false;
  const gateRequires = new Set(gates[0].requires);
  if (gateRequires.size !== gates[0].requires.length
    || !gates[0].requires.some((id) => ids.get(id)?.kind === "agent" && ids.get(id)?.mode === "review")
    || gates[0].requires.some((id) => ids.get(id)?.kind !== "check" && !(ids.get(id)?.kind === "agent" && ids.get(id)?.mode === "review"))) return false;
  if (agentInstructionIds.size !== agents.length) return false;

  if (!ir.instructions.every((section) => exact(section, ["id", "digest", "byteLength"]) && boundedSlug(section.id) && /^sha256:[a-f0-9]{64}$/.test(section.digest) && integer(section.byteLength, [1, 65536])) || new Set(ir.instructions.map((section) => section.id)).size !== ir.instructions.length || !same(ir.instructions.map((section) => section.id).sort(), [...agentInstructionIds].sort())) return false;

  for (const [outcome, state] of Object.entries({ error: "failed", timeout: "failed", cancelled: "stopped", lost: "needs-human", exhausted: "budget-exhausted" })) if (ids.get(ir.failurePolicy[outcome])?.state !== state) return false;
  const pairs = new Set();
  for (const edge of ir.edges) {
    if (!exact(edge, ["from", "on", "to", "maxVisits"]) || !boundedSlug(edge.from) || !boundedSlug(edge.to) || typeof edge.on !== "string" || edge.on.length > 64 || (edge.maxVisits !== null && !integer(edge.maxVisits, [1, 100]))) return false;
    const source = ids.get(edge.from), target = ids.get(edge.to), outcomeKey = `${edge.from}\0${edge.on}`;
    if (!source || !target || pairs.has(outcomeKey) || !outcomesFor(source).includes(edge.on) || !targetAllowed(source, edge.on, target)) return false;
    const back = backEdges(ir.nodes, ir.edges, ir.entry).has(`${edge.from}\0${edge.to}`);
    if ((edge.maxVisits !== null) !== back) return false;
    pairs.add(outcomeKey);
  }
  if (ir.nodes.filter((node) => node.kind !== "terminal").some((node) => outcomesFor(node).some((outcome) => !pairs.has(`${node.id}\0${outcome}`))) || ir.nodes.length < 2) return false;
  const normalized = normalizeIr(ir, outcomesFor);
  return same(ir.nodes, normalized.nodes) && same(ir.edges, normalized.edges) && same(ir.instructions, normalized.instructions);
}

/**
 * Frozen Runs are immutable evidence. Pre-H6 recipes did not carry execution
 * intent, so replay admits that closed historical shape without rewriting its
 * bytes or making it valid compiler output.
 */
export function validateReplayIr(ir) {
  if (validateClosedIr(ir)) return true;
  if (!ir || !Array.isArray(ir.nodes)
    || !ir.nodes.filter((node) => node?.kind === "agent").every((node) => !Object.hasOwn(node, "execution") && !Object.hasOwn(node, "intelligence"))) return false;
  const upgraded = {
    ...ir,
    nodes: ir.nodes.map((node) => node?.kind === "agent"
      ? { ...node, execution: "managed", intelligence: node.mode === "review" ? "strong" : "standard" }
      : node),
  };
  return validateClosedIr(upgraded);
}
