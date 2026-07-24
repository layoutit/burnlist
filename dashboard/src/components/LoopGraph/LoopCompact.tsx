import type { LoopGraphProjection } from "./LoopGraph";
import { layoutCompactLoop } from "./compact-layout";
import "./LoopGraph.css";

export type LoopCompactProps = {
  run?: LoopGraphProjection | null;
  title?: string;
  labels?: "hidden" | "outcomes";
  symbols?: Record<string, string>;
  variant?: "topology" | "burn-cycle";
};

function semanticTopology(run: LoopGraphProjection) {
  const convergence = new Set(run.graph.nodes
    .filter((node) => node.kind === "gate" && node.gateKind === "convergence")
    .map((node) => node.id));
  const exceptional = new Set(run.graph.nodes
    .filter((node) => node.kind === "terminal" && node.terminalState !== "converged")
    .map((node) => node.id));
  const passTarget = new Map([...convergence].map((id) => [
    id,
    run.graph.edges.find((edge) => edge.from === id && edge.on === "pass")?.to,
  ]));
  const nodes = run.graph.nodes.filter((node) => !convergence.has(node.id) && !exceptional.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = run.graph.edges.flatMap((edge) => {
    if (convergence.has(edge.from) || exceptional.has(edge.from) || exceptional.has(edge.to)) return [];
    const to = convergence.has(edge.to) ? passTarget.get(edge.to) : edge.to;
    return to && nodeIds.has(edge.from) && nodeIds.has(to) ? [{ ...edge, to }] : [];
  });
  const currentNode = convergence.has(run.currentNode)
    ? passTarget.get(run.currentNode) ?? run.currentNode
    : run.currentNode;
  return { graph: { ...run.graph, nodes, edges }, currentNode };
}

export function itemTopologyProjection(run: LoopGraphProjection): LoopGraphProjection {
  const semantic = semanticTopology(run);
  return {
    ...run,
    currentNode: semantic.currentNode,
    graph: {
      ...semantic.graph,
      entry: "start",
      nodes: [{ id: "start", kind: "terminal" }, ...semantic.graph.nodes],
      edges: [{ from: "start", on: "begin", to: semantic.graph.entry ?? semantic.graph.nodes[0]?.id ?? "burn" }, ...semantic.graph.edges],
    },
  };
}

export function LoopCompact({
  run, title = "Compact Loop topology", labels = "hidden", symbols, variant = "topology",
}: LoopCompactProps) {
  if (!run) return null;
  const topologyRun = variant === "topology" ? itemTopologyProjection(run) : null;
  const displayRun = variant === "burn-cycle" ? {
    ...run,
    currentNode: run.currentNode === "implement" ? "implement"
      : run.currentNode === "completed" ? "burn"
        : "verify",
    graph: {
      entry: "start",
      nodes: [
        { id: "start", kind: "terminal" },
        { id: "implement", kind: "agent", authority: "write" as const },
        { id: "verify", kind: "check" },
        { id: "burn", kind: "terminal", terminalState: "converged" },
      ],
      edges: [
        { from: "start", on: "begin", to: "implement" },
        { from: "implement", on: "done", to: "verify" },
        { from: "verify", on: "pass", to: "burn" },
        { from: "verify", on: "fail", to: "implement" },
      ],
    },
  } : topologyRun!;
  const displaySymbols = variant === "burn-cycle"
    ? { start: "S", implement: "I", verify: "V", burn: "B", ...symbols }
    : {
      start: "S",
      ...Object.fromEntries(run.graph.nodes.filter((node) => node.kind === "terminal" && node.terminalState === "converged").map((node) => [node.id, "B"])),
      ...symbols,
    };
  const layout = layoutCompactLoop(displayRun, { showLabels: labels === "outcomes", symbols: displaySymbols });
  const current = layout.positions.get(displayRun.currentNode);
  const drawing = layout.lines.join("\n");
  const offset = current
    ? layout.lines.slice(0, current.y).reduce((total, line) => total + line.length + 1, 0) + current.x
    : -1;
  return <pre className="loop-compact" aria-label={title} role="img">
    <code className="loop-compact__drawing">{offset >= 0
      ? <>{drawing.slice(0, offset)}<mark aria-current="step">{drawing[offset]}</mark>{drawing.slice(offset + 1)}</>
      : drawing}</code>
  </pre>;
}
