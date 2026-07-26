import type { LoopGraphProjection } from "./LoopGraph";
import { loopSymbols } from "./loop-symbols";
import "./LoopGraph.css";

export type LoopLegendProps = {
  run?: LoopGraphProjection | null;
  title?: string;
  symbols?: Record<string, string>;
};

function description(node: LoopGraphProjection["graph"]["nodes"][number]) {
  if (node.id === "start") return "item input";
  if (node.execution) {
    return `${node.execution.model} · ${node.execution.effort} · ${node.execution.authority}`;
  }
  if (node.kind === "check") return `${node.measure ?? "test"} · ${node.capability ?? "deterministic"}`;
  if (node.kind === "gate") return `${node.measure ?? "gate"}${node.target ? ` · ${node.target}` : ""}`;
  if (node.kind === "terminal") return node.terminalState === "converged" ? "burn output" : "output";
  return node.role ?? node.kind;
}

export function LoopLegend({ run, title = "Loop legend", symbols: overrides }: LoopLegendProps) {
  if (!run) return null;
  const symbols = loopSymbols(run.graph.nodes, overrides);
  return <dl className="loop-legend" aria-label={title}>
    {run.graph.nodes.map((node) => <div className="loop-legend__row" key={node.id}>
      <dt>{symbols.get(node.id)}</dt>
      <dd><strong>{node.id.toUpperCase()}</strong> · {description(node)}</dd>
    </div>)}
  </dl>;
}
