import { normalizeIr } from "./canonical.mjs";
import { outcomesFor } from "./grammar.mjs";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const route = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const semver = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
const states = ["converged", "needs-human", "failed", "stopped", "budget-exhausted"];
const top = ["schema", "compiler", "id", "declaredVersion", "entry", "budget", "nodes", "failurePolicy", "edges", "instructions"];
const budget = ["maxRounds", "maxMinutes", "maxAgentRuns", "maxCheckRuns", "maxTransitions", "maxOutputBytes"];
const policy = ["error", "timeout", "cancelled", "lost", "exhausted"];
const nodeKeys = { agent: ["kind", "id", "mode", "role", "route", "authority", "instructions", "independentFrom", "requires"], check: ["kind", "id", "capability"], gate: ["kind", "id", "gateKind", "requires"], terminal: ["kind", "id", "state"] };
const limits = { maxRounds: [1, 100], maxMinutes: [1, 1440], maxAgentRuns: [1, 100], maxCheckRuns: [1, 100], maxTransitions: [1, 1000], maxOutputBytes: [1024, 1048576] };

function exact(value, keys) { return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function boundedSlug(value) { return typeof value === "string" && value.length <= 65536 && slug.test(value); }
function integer(value, range = [0, Number.MAX_SAFE_INTEGER]) { return Number.isSafeInteger(value) && value >= range[0] && value <= range[1]; }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function validNode(node) {
  if (!exact(node, nodeKeys[node?.kind] ?? []) || !boundedSlug(node.id)) return false;
  if (node.kind === "agent") return ["task", "review"].includes(node.mode) && ["maker", "reviewer"].includes(node.role) && route.test(node.route) && ["read", "write"].includes(node.authority) && boundedSlug(node.instructions) && (node.independentFrom === null || boundedSlug(node.independentFrom)) && Array.isArray(node.requires) && node.requires.every((item) => typeof item === "string" && item.length <= 128);
  if (node.kind === "check") return boundedSlug(node.capability);
  if (node.kind === "gate") return node.gateKind === "convergence" && Array.isArray(node.requires) && node.requires.every(boundedSlug);
  return states.includes(node.state);
}
function targetAllowed(source, outcome, target) {
  return (source.kind === "agent" && source.mode === "task" && outcome === "complete" && target.kind === "check") ||
    (source.kind === "check" && outcome === "pass" && target.kind === "agent" && target.mode === "review") ||
    (source.kind === "check" && outcome === "fail" && target.kind === "agent" && target.mode === "task") ||
    (source.kind === "agent" && source.mode === "review" && outcome === "reject" && target.kind === "agent" && target.mode === "task") ||
    (source.kind === "agent" && source.mode === "review" && outcome === "approve" && target.kind === "gate") ||
    (source.kind === "agent" && source.mode === "review" && outcome === "escalate" && target.kind === "terminal" && target.state === "needs-human") ||
    (source.kind === "gate" && outcome === "pass" && target.kind === "terminal" && target.state === "converged") ||
    (source.kind === "gate" && outcome === "fail" && target.kind === "terminal" && target.state === "needs-human");
}

/** Rejects every noncanonical or unsupported symbolic IR before frozen replay. */
export function validateClosedIr(ir) {
  if (!exact(ir, top) || ir.schema !== "burnlist-loop-ir@1" || ir.compiler !== "burnlist-loop-compiler@1" || !boundedSlug(ir.id) || !semver.test(ir.declaredVersion) || !boundedSlug(ir.entry) || !exact(ir.budget, budget) || !Object.entries(limits).every(([key, range]) => integer(ir.budget[key], range)) || !exact(ir.failurePolicy, policy) || !Object.values(ir.failurePolicy).every(boundedSlug) || !Array.isArray(ir.nodes) || ir.nodes.length > 64 || !ir.nodes.every(validNode) || !Array.isArray(ir.edges) || ir.edges.length > 512 || !Array.isArray(ir.instructions) || ir.instructions.length > 2) return false;
  const ids = new Map(ir.nodes.map((node) => [node.id, node]));
  if (ids.size !== ir.nodes.length || !ids.has(ir.entry)) return false;
  const agents = ir.nodes.filter((node) => node.kind === "agent"), makers = agents.filter((node) => node.mode === "task" && node.role === "maker" && node.authority === "write"), reviewers = agents.filter((node) => node.mode === "review" && node.role === "reviewer" && node.authority === "read"), checks = ir.nodes.filter((node) => node.kind === "check"), gates = ir.nodes.filter((node) => node.kind === "gate"), terminals = ir.nodes.filter((node) => node.kind === "terminal"), agentInstructionIds = new Set(agents.map((agent) => agent.instructions));
  if (agents.length !== 2 || makers.length !== 1 || reviewers.length !== 1 || checks.length !== 1 || gates.length !== 1 || ir.entry !== makers[0].id || states.some((state) => terminals.filter((node) => node.state === state).length !== 1) || reviewers[0].independentFrom !== makers[0].id || !same(reviewers[0].requires, ["fresh-session:enforced", "filesystem-write-deny:supervised"]) || makers[0].independentFrom !== null || makers[0].requires.length || !same(gates[0].requires, [checks[0].id, reviewers[0].id])) return false;
  if (agentInstructionIds.size !== 2) return false;
  if (!ir.instructions.every((section) => exact(section, ["id", "digest", "byteLength"]) && boundedSlug(section.id) && /^sha256:[a-f0-9]{64}$/.test(section.digest) && integer(section.byteLength, [1, 65536])) || new Set(ir.instructions.map((section) => section.id)).size !== ir.instructions.length || !same(ir.instructions.map((section) => section.id).sort(), [makers[0].instructions, reviewers[0].instructions].sort())) return false;
  for (const [outcome, state] of Object.entries({ error: "failed", timeout: "failed", cancelled: "stopped", lost: "needs-human", exhausted: "budget-exhausted" })) if (ids.get(ir.failurePolicy[outcome])?.state !== state) return false;
  const pairs = new Set();
  for (const edge of ir.edges) {
    if (!exact(edge, ["from", "on", "to", "maxVisits"]) || !boundedSlug(edge.from) || !boundedSlug(edge.to) || typeof edge.on !== "string" || edge.on.length > 64 || (edge.maxVisits !== null && !integer(edge.maxVisits, [1, 100]))) return false;
    const source = ids.get(edge.from), target = ids.get(edge.to), key = `${edge.from}\0${edge.on}`;
    if (!source || !target || pairs.has(key) || !outcomesFor(source).includes(edge.on) || !targetAllowed(source, edge.on, target)) return false;
    const back = (source.kind === "check" && edge.on === "fail") || (source.kind === "agent" && source.mode === "review" && edge.on === "reject");
    if ((edge.maxVisits !== null) !== back) return false;
    pairs.add(key);
  }
  if (ir.edges.length !== 8 || ir.nodes.filter((node) => node.kind !== "terminal").some((node) => outcomesFor(node).some((outcome) => !pairs.has(`${node.id}\0${outcome}`)))) return false;
  const normalized = normalizeIr(ir, outcomesFor);
  return same(ir.nodes, normalized.nodes) && same(ir.edges, normalized.edges) && same(ir.instructions, normalized.instructions);
}
