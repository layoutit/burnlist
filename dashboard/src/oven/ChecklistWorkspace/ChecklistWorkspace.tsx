import type { ChecklistItem, ChecklistProgressData, CompletedItem, LoopRunProjection } from "@lib";
import { checklistEventDetailFields, compactAge, eventRows } from "@lib/checklist-adapter";
import { itemTopologyProjection, LoopCompact, LoopLegend } from "@/components/LoopGraph";
import "./ChecklistWorkspace.css";

type ItemSelection =
  | { status: "active"; item: ChecklistItem; index: number }
  | { status: "completed"; item: CompletedItem; index: number };

function inspectedItem(data: ChecklistProgressData): ItemSelection | null {
  const activeIndex = data.active.findIndex((item) => item.id === data.selectedItemId);
  if (activeIndex >= 0) return { status: "active", item: data.active[activeIndex], index: activeIndex };
  const completed = eventRows(data);
  const completedIndex = completed.findIndex((item) => item.id === data.selectedItemId);
  if (completedIndex >= 0) return { status: "completed", item: completed[completedIndex], index: completedIndex };
  if (data.active[0]) return { status: "active", item: data.active[0], index: 0 };
  return completed[0] ? { status: "completed", item: completed[0], index: 0 } : null;
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

function ItemsColumn({ data, selected }: { data: ChecklistProgressData; selected: ItemSelection | null }) {
  const completed = eventRows(data);
  return <section className="checklist-workspace__column checklist-workspace__items" aria-label="All items">
    <header className="checklist-workspace__heading"><span>Items</span><span>{data.total}</span></header>
    <nav className="checklist-workspace__item-list">
      {data.active.map((item, index) => {
        const current = index === 0;
        const inspected = selected?.status === "active" && item.id === selected.item.id;
        return <a className={`checklist-workspace__item${current ? " is-current" : ""}${inspected ? " is-selected" : ""}`} href={`#${encodeURIComponent(item.id)}`} key={item.id} aria-current={inspected ? "true" : undefined}>
          <span className="checklist-workspace__item-marker">{current ? "●" : "○"}</span>
          <span className="checklist-workspace__item-copy"><b>{item.id}</b><span>{item.title}</span></span>
          <span className="checklist-workspace__loop-label">{current ? "current" : item.loop?.selector.replace(/^loop:builtin:/u, "") ?? "pending"}</span>
        </a>;
      })}
      {!!data.active.length && !!completed.length && <div className="checklist-workspace__divider"><span>Completed</span><span>{completed.length}</span></div>}
      {completed.map((item) => {
        const inspected = selected?.status === "completed" && item.id === selected.item.id;
        return <a className={`checklist-workspace__item is-completed${inspected ? " is-selected" : ""}`} href={`#${encodeURIComponent(item.id)}`} key={`${item.id}/${item.completedAt}`} aria-current={inspected ? "true" : undefined}>
          <span className="checklist-workspace__item-marker">✓</span>
          <span className="checklist-workspace__item-copy"><b>{item.id}</b><span>{item.title}</span></span>
          <span className="checklist-workspace__loop-label">{compactAge(item.completedAt, data.generatedAt)}</span>
        </a>;
      })}
      {!data.total && <p className="checklist-workspace__empty">No items</p>}
    </nav>
  </section>;
}

const detailFields = [
  ["Action", "Action"],
  ["Done when", "Done/delete when"],
  ["Validate", "Validate"],
  ["Files", "Files/search"],
] as const;

function ActiveDetail({ data, item }: { data: ChecklistProgressData; item: ChecklistItem }) {
  const run = previewRun(item, data);
  const topology = item.loop?.graph ? itemTopologyProjection(run) : null;
  const legendSymbols = topology ? {
    start: "S",
    ...Object.fromEntries(topology.graph.nodes.filter((node) => node.kind === "terminal" && node.terminalState === "converged").map((node) => [node.id, "B"])),
  } : undefined;
  return <div className="checklist-workspace__detail-body">
      <div className="checklist-workspace__detail-title"><span>{item.id}</span><h2>{item.title}</h2></div>
      <dl className="checklist-workspace__fields">{detailFields.map(([label, key]) => item.fields[key] ? <div key={key}><dt>{label}</dt><dd>{item.fields[key]}</dd></div> : null)}</dl>
      {item.loop ? <div className="checklist-workspace__detail-loop">
        <div className="checklist-workspace__loop-head"><span>Loop</span><span>{item.loop.selector}</span></div>
        <LoopCompact run={run} labels="outcomes" title={`Loop for ${item.id}`} variant={item.loop.graph ? "topology" : "burn-cycle"} />
        {topology && <LoopLegend run={topology} symbols={legendSymbols} title={`Loop symbols for ${item.id}`} />}
      </div> : <div className="checklist-workspace__direct">Direct implementation · no Loop assigned</div>}
    </div>;
}

function CompletedDetail({ item }: { item: CompletedItem }) {
  const fields = checklistEventDetailFields(item.detail).filter((field) => field.label !== "Completed" && field.values.length);
  return <div className="checklist-workspace__detail-body">
    <div className="checklist-workspace__detail-title is-completed"><span>✓</span><h2>{item.id} · {item.title}</h2></div>
    <dl className="checklist-workspace__fields">
      <div><dt>Status</dt><dd>Completed</dd></div>
      <div><dt>Completed</dt><dd><time dateTime={item.completedAt}>{new Date(item.completedAt).toLocaleString()}</time></dd></div>
      {fields.map((field) => <div key={field.label}><dt>{field.label === "Detail" ? "Outcome" : field.label}</dt><dd>{field.values.join(" · ")}</dd></div>)}
    </dl>
  </div>;
}

function DetailColumn({ data, selected }: { data: ChecklistProgressData; selected: ItemSelection | null }) {
  const status = !selected ? "Empty" : selected.status === "completed" ? "Completed" : selected.index === 0 ? "Current" : "Pending";
  return <section className="checklist-workspace__column checklist-workspace__detail" aria-label={selected ? `Item ${selected.item.id} detail` : "Item detail"}>
    <header className="checklist-workspace__heading"><span>Item detail</span><span>{status}</span></header>
    {!selected ? <p className="checklist-workspace__empty">No items</p>
      : selected.status === "active" ? <ActiveDetail data={data} item={selected.item} />
        : <CompletedDetail item={selected.item} />}
  </section>;
}

export function ChecklistWorkspace({ data }: { data: ChecklistProgressData }) {
  const selected = inspectedItem(data);
  return <section className="checklist-workspace" aria-label="Burnlist work queue">
    <ItemsColumn data={data} selected={selected} />
    <DetailColumn data={data} selected={selected} />
  </section>;
}
