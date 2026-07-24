import { compareUtf8 } from "./diagnostics.mjs";

const nodeKeyOrder = { agent: ["kind", "id", "mode", "role", "route", "authority", "instructions", "independentFrom", "requires"], check: ["kind", "id", "capability"], gate: ["kind", "id", "gateKind", "requires"], terminal: ["kind", "id", "state"] };
const topOrder = ["schema", "compiler", "id", "declaredVersion", "entry", "budget", "nodes", "failurePolicy", "edges", "instructions"];
const budgetOrder = ["maxRounds", "maxMinutes", "maxAgentRuns", "maxCheckRuns", "maxTransitions", "maxOutputBytes"];
const policyOrder = ["error", "timeout", "cancelled", "lost", "exhausted"];
const edgeOrder = ["from", "on", "to", "maxVisits"];

function quote(value) {
  if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) throw new TypeError("Canonical strings must be scalar Unicode");
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0);
    if (char === '"') out += '\\"'; else if (char === "\\") out += "\\\\";
    else if (char === "\b") out += "\\b"; else if (char === "\f") out += "\\f";
    else if (char === "\n") out += "\\n"; else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}"`;
}
function object(value, keys) { return `{${keys.map((key) => `${quote(key)}:${encode(value[key], key)}`).join(",")}}`; }
function encode(value, context = "") {
  if (value === null) return "null";
  if (typeof value === "string") return quote(value);
  if (typeof value === "number") { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Canonical numbers must be safe unsigned integers"); return String(value); }
  if (Array.isArray(value)) return `[${value.map((item) => encode(item)).join(",")}]`;
  if (!value || typeof value !== "object") throw new TypeError("Canonical IR contains an invalid value");
  if (context === "nodes[]") return object(value, nodeKeyOrder[value.kind]);
  if (context === "budget") return object(value, budgetOrder);
  if (context === "failurePolicy") return object(value, policyOrder);
  if (context === "edges[]") return object(value, edgeOrder);
  if (context === "instructions[]") return object(value, ["id", "digest", "byteLength"]);
  return object(value, topOrder);
}

export function canonicalIrBytes(ir) {
  const adjusted = { ...ir, nodes: ir.nodes.map((node) => ({ ...node })) };
  const json = `{${topOrder.map((key) => {
    const context = key === "nodes" ? "nodes[]" : key === "edges" ? "edges[]" : key === "instructions" ? "instructions[]" : key;
    const value = Array.isArray(adjusted[key]) ? `[${adjusted[key].map((item) => encode(item, context)).join(",")}]` : encode(adjusted[key], context);
    return `${quote(key)}:${value}`;
  }).join(",")}}\n`;
  return Buffer.from(json, "utf8");
}

export function normalizeIr(ir, outcomeOrder) {
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const nodes = [...ir.nodes].sort((left, right) => left.id === ir.entry ? -1 : right.id === ir.entry ? 1 : compareUtf8(left.id, right.id));
  const nodeRank = new Map(nodes.map((node, index) => [node.id, index]));
  const edges = [...ir.edges].sort((left, right) => (nodeRank.get(left.from) ?? Infinity) - (nodeRank.get(right.from) ?? Infinity) ||
    (outcomeOrder(nodeById.get(left.from))?.indexOf(left.on) ?? 99) - (outcomeOrder(nodeById.get(right.from))?.indexOf(right.on) ?? 99) || compareUtf8(left.to, right.to));
  const instructions = [...ir.instructions].sort((left, right) => compareUtf8(left.id, right.id));
  return { ...ir, nodes, edges, instructions };
}
