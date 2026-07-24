import type { TerminalNode } from "../terminal-contract";

export type ComponentRoot = Readonly<{ path: string; node: TerminalNode }>;
const source = Object.freeze({ offset: 0, line: 1, column: 1 });
const row = (): TerminalNode => ({ kind: "text", attributes: { text: " " }, bindings: {}, children: [], source });

function reserve(node: TerminalNode, width: number): TerminalNode {
  if (node.kind === "kpi-item") return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: 3 }, row), source: node.source };
  if (node.kind !== "kpi-strip") return node;
  const items = node.children.filter((child) => child.kind === "kpi-item").length;
  const metadata = node.attributes.title || node.attributes.ariaLabel ? 1 : 0;
  const narrow = width < items * 18, height = Math.max(1, metadata + (narrow ? items * 3 : 3));
  return { kind: "stack", attributes: {}, bindings: {}, children: Array.from({ length: height }, row), source: node.source };
}

/** Projects component roots to measured structural rows while retaining paths. */
export function projectComponentLayout(nodes: readonly TerminalNode[], width: number): Readonly<{ nodes: readonly TerminalNode[]; roots: readonly ComponentRoot[] }> {
  const roots: ComponentRoot[] = [];
  const visit = (node: TerminalNode, path: string): TerminalNode => {
    if (node.kind === "kpi-strip" || node.kind === "kpi-item") { roots.push({ path, node }); return reserve(node, width); }
    return { ...node, children: node.children.map((child, index) => visit(child, `${path}/${index}`)) };
  };
  return { nodes: nodes.map((node, index) => visit(node, `root/${index}`)), roots };
}
