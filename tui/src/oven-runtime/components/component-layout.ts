import type { TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";

export type ComponentRoot = Readonly<{ path: string; node: TerminalNode }>;
const source = Object.freeze({ offset: 0, line: 1, column: 1 });
const row = (): TerminalNode => ({ kind: "text", attributes: { text: " " }, bindings: {}, children: [], source });
const visualRows = (node: TerminalNode, width: number) => node.children.some((child) => child.kind === "progress-donut")
  ? 2
  : node.children.some((child) => child.kind === "waffle-metric")
    ? width - 4 >= 5 ? 4 : 3
    : 1;
const kpiRows = (node: TerminalNode, width: number) => node.children.some((child) => ["progress-donut", "waffle-metric"].includes(child.kind))
  ? visualRows(node, width)
  : visualRows(node, width) + 2;

function reserve(node: TerminalNode, width: number, viewportHeight?: number): TerminalNode {
  if (node.kind === "log-table") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(3, Math.min(10, Math.floor(width / 8))) }, row), source: node.source };
  if (node.kind === "ascii-block") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(3, Math.min(16, viewportHeight ?? 8)) }, row), source: node.source };
  if (node.kind === "alert") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 2 }, row), source: node.source };
  if (node.kind === "agent-monitor-activity-chart") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 5 }, row), source: node.source };
  if (node.kind === "agent-monitor-event-card") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(4, Math.min(12, viewportHeight ?? 8)) }, row), source: node.source };
  if (node.kind === "kpi-item") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: kpiRows(node, width) }, row), source: node.source };
  if (["section-header", "refresh-status", "domain-note", "differential-empty-state"].includes(node.kind)) return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: node.kind === "refresh-status" ? 1 : 2 }, row), source: node.source };
  if (["metric-tiles", "frame-card", "domain-tabs", "verdict-header"].includes(node.kind)) {
    const rows = ["domain-tabs", "verdict-header"].includes(node.kind) ? 1 : node.kind === "metric-tiles" ? width < 48 ? 4 : 2 : viewportHeight
      ? Math.max(12, viewportHeight - (width < 48 ? 10 : 8))
      : Math.max(12, Math.min(24, Math.floor(width / 6)));
    return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: rows }, row), source: node.source };
  }
  if (node.kind === "streaming-diff-heading") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 2 }, row), source: node.source };
  if (node.kind === "differential-kpi-strip") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: width < 56 ? 6 : 3 }, row), source: node.source };
  if (node.kind === "differential-log-table") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: width < 56 ? 1 : 3 }, row), source: node.source };
  if (node.kind === "field-list") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 15 }, row), source: node.source };
  if (["progress-chart", "frame-delta-chart"].includes(node.kind)) return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 4 }, row), source: node.source };
  if (node.kind === "diff-card") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(5, Math.min(14, Math.floor(width / 4))) }, row), source: node.source };
  if (node.kind === "checklist-ledger") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 4 }, row), source: node.source };
  if (node.kind === "checklist-burn-panel") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 2 }, row), source: node.source };
  if (node.kind === "checklist-current") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 3 }, row), source: node.source };
  if (node.kind === "checklist-workspace") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 5 }, row), source: node.source };
  if (node.kind === "checklist-tabs") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(8, (viewportHeight ?? 14) - 7) }, row), source: node.source };
  if (node.kind === "checklist-event-cards") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(3, Math.min(6, Math.floor(width / 10))) }, row), source: node.source };
  if (node.kind === "loop-graph") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(8, Math.min(18, Math.floor(width / 7))) }, row), source: node.source };
  if (node.kind === "loop-progress") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(12, Math.min(22, Math.floor(width / 6))) }, row), source: node.source };
  if (node.kind === "model-lab-view") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: Math.max(14, Math.min(24, Math.floor(width / 3))) }, row), source: node.source };
  if (node.kind !== "kpi-strip") return node;
  const items = node.children.filter((child) => child.kind === "kpi-item");
  const metadata = node.attributes.title || node.attributes.ariaLabel ? 1 : 0;
  const narrow = width < items.length * 12, itemWidth = Math.max(8, Math.floor(width / Math.max(1, items.length)));
  const height = Math.max(1, metadata + (narrow
    ? items.length
    : Math.max(3, ...items.map((item) => kpiRows(item, itemWidth)))));
  return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: height }, row), source: node.source };
}

/** Projects component roots to measured structural rows while retaining paths. */
export function projectComponentLayout(nodes: readonly TerminalNode[], width: number, payload?: unknown, controls: Readonly<Record<string, string | boolean>> = {}, viewportHeight?: number): Readonly<{ nodes: readonly TerminalNode[]; roots: readonly ComponentRoot[] }> {
  const roots: ComponentRoot[] = [];
  const visit = (node: TerminalNode, path: string): TerminalNode => {
    if (node.kind === "switch") {
      const sourced = typeof node.attributes.source === "string" ? resolveOvenPointer(payload, node.attributes.source) : undefined;
      const emptyCatalog = sourced === undefined && payload && typeof payload === "object" && !Array.isArray(payload) && (() => { const catalog = (payload as Record<string, unknown>).scenarioCatalog; return !!catalog && typeof catalog === "object" && !Array.isArray(catalog) && (catalog as Record<string, unknown>).selectedScenarioId === null; })();
      const selected = typeof node.attributes.modeFrom === "string" ? controls[node.attributes.modeFrom] : sourced ?? (emptyCatalog ? "empty" : "detail");
      const branch = node.children.find((child) => child.kind === "case" && child.attributes.value === selected)
        ?? node.children.find((child) => child.kind === "case" && child.attributes.default === true);
      return { ...node, children: branch ? branch.children.map((child, index) => visit(child, `${path}/${index}`)) : [] };
    }
    if (node.kind === "case") return { ...node, children: [] };
    if (node.kind === "field-toolbar" || node.kind === "pagination" || node.kind === "mode-toggle") return { ...node, children: [] };
    if (node.kind === "collection") {
      const template = node.children.find((child) => child.kind === "each")?.children.find((child) => child.kind === "agent-monitor-event-card");
      if (template) {
        const aggregate = { ...template, attributes: { ...template.attributes, source: node.attributes.source, filterFrom: node.attributes.filterFrom, collectionFrom: node.attributes.id } };
        roots.push({ path, node: aggregate });
        return reserve(aggregate, width, viewportHeight);
      }
      return { ...node, children: node.children.filter((child) => child.kind === "field-list").map((child, index) => visit(child, `${path}/${index}`)) };
    }
    if (["ascii-block", "alert", "agent-monitor-activity-chart", "kpi-strip", "kpi-item", "log-table", "section-header", "refresh-status", "domain-note", "differential-empty-state", "differential-kpi-strip", "differential-log-table", "progress-chart", "frame-delta-chart", "field-list", "verdict-header", "metric-tiles", "frame-card", "domain-tabs", "streaming-diff-heading", "diff-card", "checklist-current", "checklist-workspace", "checklist-tabs", "checklist-ledger", "checklist-burn-panel", "checklist-event-cards", "loop-graph", "loop-progress", "model-lab-view"].includes(node.kind)) { roots.push({ path, node }); return reserve(node, width, viewportHeight); }
    return { ...node, children: node.children.map((child, index) => visit(child, `${path}/${index}`)) };
  };
  return { nodes: nodes.map((node, index) => visit(node, `root/${index}`)), roots };
}

/** Finds a measured component root without coupling callers to an Oven's tree indices. */
export function componentRootPath(nodes: readonly TerminalNode[], width: number, kind: string, payload?: unknown, controls: Readonly<Record<string, string | boolean>> = {}): string | undefined {
  return projectComponentLayout(nodes, width, payload, controls).roots.find((root) => root.node.kind === kind)?.path;
}
