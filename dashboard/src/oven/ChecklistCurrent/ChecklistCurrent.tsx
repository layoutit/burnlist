import type { ChecklistProgressData } from "@lib";
import { itemTopologyProjection, LoopCompact } from "@/components/LoopGraph";
import { loopPrimaryPath, loopSymbols } from "@/components/LoopGraph/loop-symbols";
import "./ChecklistCurrent.css";

function nodeLabel(id: string, kind: string, terminalState?: string) {
  if (id === "start") return "Start";
  if (kind === "terminal" && terminalState === "converged") return "Burn";
  return id.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function ChecklistCurrent({ data }: { data: ChecklistProgressData }) {
  const item = data.active[0];
  if (!item?.loop) return null;
  const run = data.loopRun?.itemRef.endsWith(`#${item.id}`) ? data.loopRun : null;
  const topology = run ? itemTopologyProjection(run) : null;
  const symbols = topology ? loopSymbols(topology.graph.nodes, {
    start: "S",
    ...Object.fromEntries(topology.graph.nodes
      .filter((node) => node.kind === "terminal" && node.terminalState === "converged")
      .map((node) => [node.id, "B"])),
  }) : null;
  const primaryIds = topology ? loopPrimaryPath(topology.graph) : [];
  const orderedNodes = topology ? [
    ...primaryIds.map((id) => topology.graph.nodes.find((node) => node.id === id)).filter((node) => node !== undefined),
    ...topology.graph.nodes.filter((node) => !primaryIds.includes(node.id)),
  ] : [];
  return <section className="panel checklist-current" id={item.id} aria-label={`Loop for item ${item.id}`}>
    <header className="panel-title-row checklist-current__header">
      <span className="burn-chart-label">Loop <span aria-hidden="true">·</span> {item.id} <span aria-hidden="true">·</span> {run?.currentNode ?? (item.loop ? "Ready" : "Direct")}</span>
    </header>
    {run
      ? <div className="checklist-current__visual">
        <LoopCompact run={run} labels="hidden" title={`${item.id} ${item.loop?.selector ?? "direct"}`} variant={item.loop?.graph ? "topology" : "burn-cycle"} />
        <div className="checklist-current__legend" aria-label="Loop symbols">
          {orderedNodes.map((node) => <span key={node.id}>
            <b>{symbols?.get(node.id)}</b> {nodeLabel(node.id, node.kind, node.terminalState)}
          </span>)}
        </div>
      </div>
      : item.loop ? <span className="checklist-current__pending">Assigned · not started</span> : null}
  </section>;
}
