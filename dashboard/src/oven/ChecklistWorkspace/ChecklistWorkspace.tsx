import type { ChecklistItem, ChecklistProgressData, LoopRunProjection } from "@lib";
import { compactAge, eventRows } from "@lib/checklist-adapter";
import { itemTopologyProjection, LoopCompact, LoopLegend } from "@/components/LoopGraph";
import "./ChecklistWorkspace.css";

function inspectedItem(data: ChecklistProgressData) {
  return data.active.find((item) => item.id === data.selectedItemId) ?? data.active[0] ?? null;
}

function previewRun(item: ChecklistItem, data: ChecklistProgressData): LoopRunProjection {
  const live = data.loopRun?.itemRef.endsWith(`#${item.id}`) ? data.loopRun : null;
  if (live) return live;
  return {
    schema: "burnlist-loop-read-projection@1",
    runId: "preview",
    itemRef: `item:preview#${item.id}`,
    loopId: item.loop?.selector ?? "direct",
    loopRevision: null,
    createdAt: 0,
    updatedAt: 0,
    state: "prepared",
    currentNode: "start",
    attempt: 0,
    cycle: 0,
    revision: "preview",
    budget: {
      limits: { maxRounds: 0, maxMinutes: 0, maxAgentRuns: 0, maxCheckRuns: 0, maxTransitions: 0, maxOutputBytes: 0 },
      counters: { rounds: 0, agentRuns: 0, checkRuns: 0, transitions: 0, outputBytes: 0 },
      elapsedMilliseconds: 0,
      journal: { maximum: 0, used: 0, remaining: 0 },
    },
    latestResult: null,
    graph: item.loop?.graph ?? { entry: "start", nodes: [], edges: [] },
    transitions: [],
  };
}

function EventsColumn({ data }: { data: ChecklistProgressData }) {
  const rows = eventRows(data).slice(0, 10);
  return <section className="checklist-workspace__column checklist-workspace__events" aria-label="Completed events">
    <header className="checklist-workspace__heading"><span>Events</span><span>{rows.length}</span></header>
    <div className="checklist-workspace__event-list">
      {rows.map((item) => <article className="checklist-workspace__event" key={`${item.id}/${item.completedAt}`}>
        <span className="checklist-workspace__event-id">{item.id}</span>
        <span className="checklist-workspace__event-title">{item.title}</span>
        <span className="checklist-workspace__meta">{compactAge(item.completedAt, data.generatedAt)} · {item.percent}%</span>
      </article>)}
      {!rows.length && <p className="checklist-workspace__empty">No completed events</p>}
    </div>
  </section>;
}

function ItemsColumn({ data, selected }: { data: ChecklistProgressData; selected: ChecklistItem | null }) {
  return <section className="checklist-workspace__column checklist-workspace__items" aria-label="Remaining items">
    <header className="checklist-workspace__heading"><span>Items</span><span>{data.active.length}</span></header>
    <nav className="checklist-workspace__item-list">
      {data.active.map((item, index) => {
        const current = index === 0;
        const inspected = item.id === selected?.id;
        return <a className={`checklist-workspace__item${inspected ? " is-selected" : ""}`} href={`#${encodeURIComponent(item.id)}`} key={item.id} aria-current={inspected ? "true" : undefined}>
          <span className="checklist-workspace__item-marker">{current ? "●" : index === 1 ? "→" : `+${index}`}</span>
          <span className="checklist-workspace__item-copy"><b>{item.id}</b><span>{item.title}</span></span>
          <span className="checklist-workspace__loop-label">{item.loop?.selector.replace(/^loop:builtin:/u, "") ?? "direct"}</span>
        </a>;
      })}
    </nav>
  </section>;
}

const detailFields = [
  ["Action", "Action"],
  ["Done when", "Done/delete when"],
  ["Validate", "Validate"],
  ["Files", "Files/search"],
] as const;

function DetailColumn({ data, item }: { data: ChecklistProgressData; item: ChecklistItem | null }) {
  if (!item) return <section className="checklist-workspace__column checklist-workspace__detail"><p className="checklist-workspace__empty">No active item</p></section>;
  const run = previewRun(item, data);
  const topology = item.loop?.graph ? itemTopologyProjection(run) : null;
  const legendSymbols = topology ? {
    start: "S",
    ...Object.fromEntries(topology.graph.nodes.filter((node) => node.kind === "terminal" && node.terminalState === "converged").map((node) => [node.id, "B"])),
  } : undefined;
  return <section className="checklist-workspace__column checklist-workspace__detail" aria-label={`Item ${item.id} detail`}>
    <header className="checklist-workspace__heading"><span>Item detail</span><span>{item.id}</span></header>
    <div className="checklist-workspace__detail-body">
      <div className="checklist-workspace__detail-title"><span>{item.id}</span><h2>{item.title}</h2></div>
      <dl className="checklist-workspace__fields">{detailFields.map(([label, key]) => item.fields[key] ? <div key={key}><dt>{label}</dt><dd>{item.fields[key]}</dd></div> : null)}</dl>
      {item.loop ? <div className="checklist-workspace__detail-loop">
        <div className="checklist-workspace__loop-head"><span>Loop</span><span>{item.loop.selector}</span></div>
        <LoopCompact run={run} labels="outcomes" title={`Loop for ${item.id}`} variant={item.loop.graph ? "topology" : "burn-cycle"} />
        {topology && <LoopLegend run={topology} symbols={legendSymbols} title={`Loop symbols for ${item.id}`} />}
      </div> : <div className="checklist-workspace__direct">Direct implementation · no Loop assigned</div>}
    </div>
  </section>;
}

export function ChecklistWorkspace({ data }: { data: ChecklistProgressData }) {
  const selected = inspectedItem(data);
  return <section className="checklist-workspace" aria-label="Burnlist work queue">
    <EventsColumn data={data} />
    <ItemsColumn data={data} selected={selected} />
    <DetailColumn data={data} item={selected} />
  </section>;
}
