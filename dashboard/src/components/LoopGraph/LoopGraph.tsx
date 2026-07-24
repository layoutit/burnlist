import { useEffect, useRef, useState } from "react";
import { layoutAsciiGraph } from "./ascii-layout";
import "./LoopGraph.css";

export type LoopGraphNode = {
  id: string;
  kind: string;
  role?: string;
  authority?: "write" | "read";
  capability?: string;
  gateKind?: string;
  measure?: "test" | "metric" | "eval" | "boolean";
  target?: string;
  terminalState?: string;
  execution?: null | {
    profileId: string;
    model: string;
    effort: string;
    authority: "write" | "read";
  };
};
export type LoopGraphEdge = { from: string; on: string; to: string };
export type LoopGraphTransition = { sequence: number; from: string; outcome: string; to: string };
export type LoopGraphProjection = {
  itemRef?: string;
  loopId: string;
  state: string;
  currentNode: string;
  attempt: number;
  cycle: number;
  graph: { entry?: string; nodes: LoopGraphNode[]; edges: LoopGraphEdge[] };
  transitions?: LoopGraphTransition[];
  latestResult?: null | { kind: string; summary: string };
  budget?: {
    limits: { maxRounds: number; maxMinutes: number; maxAgentRuns: number; maxCheckRuns: number; maxTransitions: number; maxOutputBytes: number };
    counters: { rounds: number; agentRuns: number; checkRuns: number; transitions: number; outputBytes: number };
    elapsedMilliseconds: number;
    journal: { maximum: number; used: number; remaining: number };
  };
  latestMaker?: null | { summary: string; at: number; candidateId: string | null };
  latestCheck?: null | { summary: string; at: number; candidateId: string | null };
  latestReviewer?: null | { summary: string; at: number; candidateId: string | null };
};

export type LoopGraphProps = {
  run?: LoopGraphProjection | null;
  diagnostic?: "corrupt" | "stale";
  message?: string;
  title?: string;
};

function presentationState(run: LoopGraphProjection, diagnostic?: "corrupt" | "stale") {
  if (diagnostic === "corrupt") return "error";
  if (diagnostic === "stale") return "stale";
  if (["completed", "converged"].includes(run.state)) return "converged";
  if (["failed", "stopped", "needs-human", "budget-exhausted", "corrupt"].includes(run.state)) return "error";
  if (run.state === "prepared") return "prepared";
  if (run.state === "paused") return "paused";
  if (run.cycle > 0) return "repair";
  return "running";
}

function stateLabel(run: LoopGraphProjection, diagnostic?: "corrupt" | "stale") {
  if (diagnostic === "corrupt" || run.state === "corrupt") return "Corrupt projection";
  if (diagnostic === "stale") return "Stale projection";
  const labels: Record<string, string> = {
    paused: "Paused", failed: "Failed", stopped: "Stopped", "needs-human": "Needs human review",
    "budget-exhausted": "Budget exhausted", converged: "Converged", completed: "Completed",
  };
  return labels[run.state] ?? "Running";
}

function GraphCanvas({ run, label, state }: { run: LoopGraphProjection; label: string; state: string }) {
  const host = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLPreElement>(null);
  const [characters, setCharacters] = useState(72);
  useEffect(() => {
    if (!host.current || !text.current || typeof ResizeObserver === "undefined") return;
    const style = getComputedStyle(text.current);
    const context = document.createElement("canvas").getContext("2d");
    if (context) context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const characterWidth = Math.max(1, (context?.measureText("0000000000").width ?? 90) / 10);
    const observer = new ResizeObserver(([entry]) =>
      setCharacters(Math.max(36, Math.floor(entry.contentRect.width / characterWidth) - 2)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const layout = layoutAsciiGraph(run.graph, run.currentNode, characters);
  const active = run.graph.nodes.find((node) => node.id === run.currentNode);
  const execution = active?.execution ? `; model ${active.execution.model}; effort ${active.execution.effort}; authority ${active.execution.authority}` : "";
  const activeDetail = active?.execution
    ? `${active.execution.model} · ${active.execution.effort} · ${active.execution.authority}`
    : active?.kind === "check" ? `${active.measure ?? "test"} · ${active.capability ?? "deterministic"}`
      : active?.kind === "gate" ? `${active.measure ?? "gate"}${active.target ? ` · ${active.target}` : ""}`
        : active?.kind ?? "";
  return <div className="loop-graph__ascii-host" ref={host} aria-label={`Loop state: ${state}`}>
    <div className="loop-graph__active">ACTIVE: {run.currentNode.toUpperCase()}{activeDetail ? ` · ${activeDetail}` : ""}</div>
    <pre ref={text} className="loop-graph__ascii" role="img" aria-label={`${label}; current node ${run.currentNode}${execution}`}>
    {layout.lines.map((value, row) => {
      const current = layout.current;
      if (!current || row < current.y || row > current.y + 2)
        return <span className="loop-graph__ascii-line" key={row}>{value}{"\n"}</span>;
      return <span className="loop-graph__ascii-line" key={row}>
        {value.slice(0, current.x)}<mark aria-current={row === current.y + 1 ? "step" : undefined}>{value.slice(current.x, current.x + current.width)}</mark>{value.slice(current.x + current.width)}{"\n"}
      </span>;
    })}
    </pre>
  </div>;
}

export function LoopGraph({ run, diagnostic, message, title = "Loop Run" }: LoopGraphProps) {
  if (!run) {
    if (!diagnostic) return null;
    const diagnosticLabel = diagnostic === "corrupt" ? "Corrupt projection" : "Stale projection";
    return <pre className="loop-graph loop-graph--error loop-graph__diagnostic" aria-label="Loop run diagnostic" data-loop-state="error" role="alert">
      {`┌─ LOOP UNAVAILABLE ─┐\n│ ${diagnosticLabel}: ${message ?? "Projection unavailable."}\n└────────────────────┘`}
    </pre>;
  }

  const viewState = presentationState(run, diagnostic);
  return <div className={`loop-graph loop-graph--${viewState}`} data-loop-state={viewState}>
    <GraphCanvas label={title} run={run} state={stateLabel(run, diagnostic)} />
  </div>;
}
