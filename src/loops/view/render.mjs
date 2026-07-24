import { outcomesFor } from "../dsl/grammar.mjs";
import { validateClosedIr } from "../dsl/ir-validate.mjs";

const SYSTEM = ["error", "timeout", "cancelled", "lost", "exhausted"];
const MODES = new Set(["UNPINNED", "ITEM-PINNED", "RUN-FROZEN"]);
const REVISION = /^(?:ls1|lp1|er1)-sha256:[a-f0-9]{64}$/u;
const MAX_ROWS = 1024;
const MAX_BYTES = 256 * 1024;

export class LoopViewError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = "LoopViewError"; this.code = code; }
}

function fail(code, message) { throw new LoopViewError(code, message); }
function utf8(value) { return Buffer.from(value, "utf8"); }
function compare(left, right) { return Buffer.compare(utf8(left), utf8(right)); }
function scalar(value, label) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value) || value.includes("\n") || value.includes("\r")) fail("ELOOP_VIEW_VALUE", `${label} is not a safe single-line value`);
  return value;
}
function revision(value, label, prefix) {
  if (typeof value !== "string" || !REVISION.test(value) || !value.startsWith(`${prefix}-`)) fail("ELOOP_VIEW_IR_INVALID", `${label} is invalid`);
  return value;
}
function recipe(value, label) {
  if (!value || typeof value !== "object" || !value.ir || !value.revisions) fail("ELOOP_VIEW_IR_INVALID", `${label} recipe is missing`);
  if (!validateClosedIr(value.ir)) fail("ELOOP_VIEW_IR_INVALID", `${label} recipe is not closed normalized Stage-1 IR`);
  const r = value.revisions;
  revision(r.source, `${label} source revision`, "ls1"); revision(r.package, `${label} package revision`, "lp1"); revision(r.executable, `${label} executable revision`, "er1");
  return value;
}
function currentRecipe(authority) { return authority.currentCompiled ?? authority.current ?? null; }
function provenance(recipeValue) { return recipeValue?.revisions ?? {}; }
function status(assigned, current, mode) {
  if (mode === "UNPINNED") return "not-applicable";
  if (mode === "RUN-FROZEN") return "not-checked";
  if (!current) return "unavailable";
  return assigned === current ? "match" : "drift";
}

function orderedNodes(ir) {
  return [...ir.nodes].sort((a, b) => a.id === ir.entry ? -1 : b.id === ir.entry ? 1 : compare(a.id, b.id));
}

function graph(ir) {
  const nodes = orderedNodes(ir), byId = new Map(nodes.map((node) => [node.id, node]));
  const declared = new Map(ir.edges.map((edge) => [`${edge.from}\0${edge.on}`, edge]));
  const expanded = [];
  for (const node of nodes) {
    if (node.kind === "terminal") continue;
    for (const on of outcomesFor(node)) { const edge = declared.get(`${node.id}\0${on}`); expanded.push({ from: node.id, on, to: edge.to, maxVisits: edge.maxVisits, className: "semantic" }); }
    for (const on of SYSTEM) expanded.push({ from: node.id, on, to: ir.failurePolicy[on], maxVisits: null, className: "system" });
  }
  if (expanded.length > MAX_ROWS) fail("ELOOP_VIEW_ADJACENCY_CAP", `expanded adjacency exceeds ${MAX_ROWS} rows`);
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of expanded) adjacency.get(edge.from).push(edge.to);
  // Tarjan follows the same byte-stable node and edge order as the view.
  const index = new Map(), low = new Map(), stack = [], onStack = new Set(), components = []; let next = 0;
  function visit(id) {
    index.set(id, next); low.set(id, next++); stack.push(id); onStack.add(id);
    const targets = [...new Set(adjacency.get(id))].sort(compare);
    for (const target of targets) {
      if (!index.has(target)) { visit(target); low.set(id, Math.min(low.get(id), low.get(target))); }
      else if (onStack.has(target)) low.set(id, Math.min(low.get(id), index.get(target)));
    }
    if (low.get(id) === index.get(id)) { const component = []; let item; do { item = stack.pop(); onStack.delete(item); component.push(item); } while (item !== id); components.push(component.sort(compare)); }
  }
  for (const node of nodes) if (!index.has(node.id)) visit(node.id);
  components.sort((a, b) => compare(a[0], b[0]));
  const scc = new Map(); components.forEach((component, i) => component.forEach((id) => scc.set(id, i + 1)));
  return { nodes, expanded, scc, byId };
}

function authorityRecipe(authority) {
  if (!authority || typeof authority !== "object") fail("ELOOP_VIEW_AUTHORITY", "authority is required");
  const mode = authority.authority;
  if (!MODES.has(mode)) fail("ELOOP_VIEW_AUTHORITY", "unknown authority mode");
  const selected = mode === "UNPINNED" ? authority.compiled : mode === "ITEM-PINNED" ? authority.artifact?.frozen : authority.frozen;
  return { mode, selected: recipe(selected, mode.toLowerCase()), current: mode === "ITEM-PINNED" ? currentRecipe(authority) : mode === "UNPINNED" ? authority.compiled : null };
}

export function renderResolvedLoopView(authority) {
  const { mode, selected, current } = authorityRecipe(authority), ir = selected.ir;
  const currentValid = current ? (() => { try { return recipe(current, "current"); } catch { return null; } })() : null;
  const selectedRevisions = provenance(selected), currentRevisions = provenance(currentValid);
  const selector = scalar(authority.selector, "selector"), loop = scalar(authority.loopRef ?? `loop:builtin:${ir.id}`, "loop selector");
  const sourceAssigned = mode === "UNPINNED" ? "-" : scalar(selectedRevisions.source, "assigned source revision");
  const packageAssigned = mode === "UNPINNED" ? "-" : scalar(selectedRevisions.package, "assigned package revision");
  const sourceCurrent = mode === "RUN-FROZEN" ? "not-checked" : currentValid ? scalar(currentRevisions.source, "current source revision") : mode === "UNPINNED" ? scalar(selectedRevisions.source, "current source revision") : "unavailable";
  const packageCurrent = mode === "RUN-FROZEN" ? "not-checked" : currentValid ? scalar(currentRevisions.package, "current package revision") : mode === "UNPINNED" ? scalar(selectedRevisions.package, "current package revision") : "unavailable";
  const executionAssigned = mode === "UNPINNED" ? "-" : scalar(selectedRevisions.executable, "assigned execution revision");
  const executionCurrent = mode === "RUN-FROZEN" ? "not-checked" : currentValid ? scalar(currentRevisions.executable, "current execution revision") : mode === "UNPINNED" ? scalar(selectedRevisions.executable, "current execution revision") : "unavailable";
  const g = graph(ir);
  const lines = ["BURNLIST LOOP VIEW @1", `MODE: ${mode}`, `SELECTOR: ${selector}`, `LOOP: ${loop}`, `DECLARED-VERSION: ${scalar(ir.declaredVersion, "declared version")}`, `COMPILER: ${scalar(ir.compiler, "compiler contract")}`, `EXECUTION: assigned=${executionAssigned} current=${executionCurrent} status=${status(executionAssigned, executionCurrent === "unavailable" ? null : executionCurrent, mode)}`, `SOURCE: assigned=${sourceAssigned} current=${sourceCurrent} status=${status(sourceAssigned, sourceCurrent === "unavailable" ? null : sourceCurrent, mode)}`, `PACKAGE: assigned=${packageAssigned} current=${packageCurrent} status=${status(packageAssigned, packageCurrent === "unavailable" ? null : packageCurrent, mode)}`, `PIN: ${mode === "UNPINNED" ? "unpinned" : mode === "ITEM-PINNED" ? "item-pinned" : "run-frozen"}`, "DRAWING (DECORATIVE):"];
  for (const edge of g.expanded.filter((item) => item.className === "semantic"))
    lines.push(`  ${edge.from === ir.entry ? "* " : "  "}${edge.from} --${edge.on}--> ${edge.to}`);
  lines.push("ADJACENCY (AUTHORITATIVE):");
  for (const node of g.nodes) {
    lines.push(`${node.id} [kind=${node.kind} scc=${g.scc.get(node.id)}]`);
    for (const edge of g.expanded.filter((item) => item.from === node.id)) lines.push(`  ${edge.on} -> ${edge.to} [class=${edge.className} max-visits=${edge.maxVisits ?? "-"}]`);
  }
  lines.push("COMPLETION:", "  converged -> cli-completion -> completed|completion-needs-human", "END");
  const output = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(output, "utf8") > MAX_BYTES) fail("ELOOP_VIEW_OUTPUT_CAP", `rendered output exceeds ${MAX_BYTES} bytes`);
  return output;
}
