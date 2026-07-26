import type { LoopRunProjection } from "../../lib/types";

export function itemTopologyProjection(run: LoopRunProjection): LoopRunProjection {
  const exceptional = new Set(run.graph.nodes
    .filter((node) => node.kind === "terminal" && node.terminalState !== "converged")
    .map((node) => node.id));
  const nodes = run.graph.nodes.filter((node) => !exceptional.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = run.graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const hasStart = nodes.some((node) => node.id === "start");
  return {
    ...run,
    graph: {
      ...run.graph,
      entry: hasStart ? run.graph.entry ?? "start" : "start",
      nodes: hasStart ? nodes : [{ id: "start", kind: "terminal" }, ...nodes],
      edges: hasStart ? edges : [{ from: "start", on: "begin", to: run.graph.entry ?? nodes[0]?.id ?? "burn" }, ...edges],
    },
  };
}
