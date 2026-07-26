import { useEffect, useRef, useState } from "react";
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
  const exceptional = new Set(run.graph.nodes
    .filter((node) => node.kind === "terminal" && node.terminalState !== "converged")
    .map((node) => node.id));
  const nodes = run.graph.nodes.filter((node) => !exceptional.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = run.graph.edges.filter((edge) =>
    nodeIds.has(edge.from) && nodeIds.has(edge.to));
  return { graph: { ...run.graph, nodes, edges }, currentNode: run.currentNode };
}

export function itemTopologyProjection(run: LoopGraphProjection): LoopGraphProjection {
  const semantic = semanticTopology(run);
  const hasStart = semantic.graph.nodes.some((node) => node.id === "start");
  return {
    ...run,
    currentNode: semantic.currentNode,
    graph: {
      ...semantic.graph,
      entry: hasStart ? semantic.graph.entry ?? "start" : "start",
      nodes: hasStart ? semantic.graph.nodes : [{ id: "start", kind: "terminal" }, ...semantic.graph.nodes],
      edges: hasStart ? semantic.graph.edges : [{ from: "start", on: "begin", to: semantic.graph.entry ?? semantic.graph.nodes[0]?.id ?? "burn" }, ...semantic.graph.edges],
    },
  };
}

export function LoopCompact({
  run, title = "Compact Loop topology", labels = "hidden", symbols, variant = "topology",
}: LoopCompactProps) {
  const host = useRef<HTMLPreElement>(null);
  const [characters, setCharacters] = useState(72);
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === "undefined") return;
    const style = getComputedStyle(host.current);
    const context = document.createElement("canvas").getContext("2d");
    if (context) context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const characterWidth = Math.max(1, (context?.measureText("0000000000").width ?? 90) / 10);
    const observer = new ResizeObserver(([entry]) =>
      setCharacters(Math.max(24, Math.floor(entry.contentRect.width / characterWidth) - 1)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
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
  const layout = layoutCompactLoop(displayRun, {
    availableCharacters: characters, showLabels: labels === "outcomes", symbols: displaySymbols,
  });
  const current = layout.positions.get(displayRun.currentNode);
  const drawing = layout.lines.join("\n");
  const offset = current
    ? layout.lines.slice(0, current.y).reduce((total, line) => total + line.length + 1, 0) + current.x
    : -1;
  return <pre className="loop-compact" ref={host} aria-label={title} role="img">
    <code className="loop-compact__drawing">{offset >= 0
      ? <>{drawing.slice(0, offset)}<mark aria-current="step">{drawing[offset]}</mark>{drawing.slice(offset + 1)}</>
      : drawing}</code>
  </pre>;
}
