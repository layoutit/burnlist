const keys = ["maxRounds", "maxMinutes", "maxAgentRuns", "maxCheckRuns", "maxTransitions", "maxOutputBytes"];
const exact = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = (message) => { throw Object.assign(new Error(`Run budgets: ${message}`), { code: "EBUDGET" }); };
export function validateBudget(value) { if (!exact(value) || !keys.every((key) => Number.isSafeInteger(value[key]) && value[key] > 0)) fail("invalid limits"); return Object.freeze({ ...value }); }
export function foldBudgets({ records, graph }) {
  const budget = validateBudget(graph.budget), nodes = new Map(graph.nodes.map((node) => [node.id, node])), counters = { rounds: 0, agentRuns: 0, checkRuns: 0, transitions: 0, outputBytes: 0 };
  const visits = {}; let elapsedMilliseconds = 0, previous = records[0]?.value?.at;
  for (const record of records) {
    if (!Number.isSafeInteger(record.value.at) || record.value.at < previous) fail("clock regressed"); elapsedMilliseconds += record.value.at - previous; previous = record.value.at;
    const { type, payload } = record.value;
    if (type === "node-started") { const node = nodes.get(payload.nodeId); if (node.kind === "agent") { counters.agentRuns += 1; if (node.mode === "task") counters.rounds += 1; } else if (node.kind === "check") counters.checkRuns += 1; }
    if (type === "edge-taken") { counters.transitions += 1; const key = `${payload.from}\0${payload.on}`, edge = graph.edges.find((item) => item.from === payload.from && item.on === payload.on); visits[key] = (visits[key] ?? 0) + 1; if (edge?.maxVisits !== null && visits[key] > edge.maxVisits) fail("edge visit exceeds limit"); }
    if (type === "invocation-result") counters.outputBytes += payload.outputBytes;
  }
  if (counters.rounds > budget.maxRounds || counters.agentRuns > budget.maxAgentRuns || counters.checkRuns > budget.maxCheckRuns || counters.transitions > budget.maxTransitions || counters.outputBytes > budget.maxOutputBytes) fail("inclusive limit exceeded");
  return Object.freeze({ counters: Object.freeze(counters), visits: Object.freeze(visits), elapsedMilliseconds, timeExceeded: elapsedMilliseconds > budget.maxMinutes * 60_000, journal: Object.freeze({ maximum: MAX_JOURNAL_RECORDS, used: records.length, remaining: MAX_JOURNAL_RECORDS - records.length }) });
}
export function budgetReason({ folded, graph, node = null, edge = null, outputBytes = 0 }) {
  const b = validateBudget(graph.budget), c = folded.counters;
  if (folded.elapsedMilliseconds >= b.maxMinutes * 60_000) return "minutes";
  if (edge && (c.transitions >= b.maxTransitions || edge.maxVisits !== null && (folded.visits[`${edge.from}\0${edge.on}`] ?? 0) >= edge.maxVisits)) return "transitions";
  if (node?.kind === "agent" && c.agentRuns >= b.maxAgentRuns) return "agent-runs";
  if (node?.kind === "agent" && node.mode === "task" && c.rounds >= b.maxRounds) return "rounds";
  if (node?.kind === "check" && c.checkRuns >= b.maxCheckRuns) return "check-runs";
  if (!Number.isSafeInteger(outputBytes) || outputBytes < 0 || c.outputBytes + outputBytes > b.maxOutputBytes) return "output-bytes";
  return null;
}
import { MAX_JOURNAL_RECORDS } from "./run-journal.mjs";
