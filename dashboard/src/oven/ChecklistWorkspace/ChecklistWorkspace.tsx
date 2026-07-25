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
    currentNode: item.loop?.graph?.entry ?? "start",
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

function compactDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function latestEvidence(run: LoopRunProjection) {
  const timed = [run.latestReviewer, run.latestCheck, run.latestMaker]
    .filter((value): value is NonNullable<typeof value> => !!value)
    .sort((left, right) => right.at - left.at);
  return timed[0] ?? run.latestResult;
}

function ActiveDetail({ data, item }: { data: ChecklistProgressData; item: ChecklistItem }) {
  const run = previewRun(item, data);
  const topology = item.loop?.graph ? itemTopologyProjection(run) : null;
  const activeNode = run.graph.nodes.find((node) => node.id === run.currentNode);
  const evidence = latestEvidence(run);
  const observedAgent = run.execution?.telemetry;
  const legendSymbols = topology ? {
    start: "S",
    ...Object.fromEntries(topology.graph.nodes.filter((node) => node.kind === "terminal" && node.terminalState === "converged").map((node) => [node.id, "B"])),
  } : undefined;
  return <div className="checklist-workspace__detail-body">
      <div className="checklist-workspace__detail-title"><span>{item.id}</span><h2>{item.title}</h2></div>
      <dl className="checklist-workspace__fields">{detailFields.map(([label, key]) => item.fields[key] ? <div key={key}><dt>{label}</dt><dd>{item.fields[key]}</dd></div> : null)}</dl>
      {item.loop ? <div className="checklist-workspace__detail-loop">
        <div className="checklist-workspace__loop-head"><span>Loop</span><span>{item.loop.selector}</span></div>
        {run.runId !== "preview" ? <dl className="checklist-workspace__run-facts" aria-label="Current Loop execution">
          <div><dt>Node</dt><dd>{run.currentNode} · attempt {run.attempt || 1}</dd></div>
          <div><dt>Mode</dt><dd>{run.execution?.mode ?? "unavailable"}</dd></div>
          <div><dt>Agent</dt><dd>{activeNode?.execution
            ? `${observedAgent?.model ?? activeNode.execution.model} · ${observedAgent?.effort ?? activeNode.execution.effort}${observedAgent ? " · host-reported" : " · declared"}`
            : activeNode?.kind === "agent" ? "model and effort unavailable" : "not an agent node"}</dd></div>
          <div><dt>Elapsed</dt><dd>{compactDuration(run.budget.elapsedMilliseconds)}</dd></div>
          <div><dt>Usage</dt><dd>{run.execution?.usage ?? "unavailable"}</dd></div>
          <div><dt>Evidence</dt><dd>{evidence?.summary ?? "unavailable"}</dd></div>
        </dl> : null}
        <LoopCompact run={run} labels="outcomes" title={`Loop for ${item.id}`} variant={item.loop.graph ? "topology" : "burn-cycle"} />
        {topology && <LoopLegend run={topology} symbols={legendSymbols} title={`Loop symbols for ${item.id}`} />}
        {run.activity ? <div className="checklist-workspace__activity" aria-label="Recent Loop activity">
          <div className="checklist-workspace__loop-head"><span>Activity</span><span>hooks {run.activity.hooks}</span></div>
          {run.activity.records.length ? <ol>{run.activity.records.slice().reverse().map((record, index) => <li key={`${record.at}/${record.kind}/${index}`}>
            <b>{record.origin}</b>
            <time dateTime={new Date(record.at).toISOString()}>{compactAge(new Date(record.at).toISOString(), data.generatedAt)}</time>
            {record.provider ? <span>{record.provider}</span> : null}
            {record.mode ? <span>{record.mode}</span> : null}
            <span>{record.kind}{record.truncated ? " · truncated" : ""}</span>
            {record.nodeId ? <span>{record.nodeId}{record.attempt ? ` #${record.attempt}` : ""}</span> : null}{record.outcome ? <span>{record.outcome}</span> : null}{record.capability ? <span>{record.capability}</span> : null}{record.subagentId ? <span>↳ {record.parentAgentId ? `${record.parentAgentId}/` : ""}{record.subagentId}</span> : null}{record.tool ? <span>{record.tool}</span> : null}{record.observedPath ? <span>{record.observedPath}</span> : null}
          </li>)}</ol> : <p>Runner activity will appear after the first committed transition.</p>}
        </div> : null}
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
