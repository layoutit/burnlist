import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Clock3, Gauge, TimerReset } from "lucide-react";
import type { ChecklistProgressData, HistoryPoint } from "@lib";
import { checklistEventDetailFields, compactAge, eventRows, formatDuration, progressHistory, timing } from "@lib/checklist-adapter";
export { checklistEventDetailFields } from "@lib/checklist-adapter";
import "./ChecklistDashboard.css";
import { buildChecklistProgressChart, KpiItem, KpiStrip, LogTable, ProgressDonut, SectionHeader } from "@oven";

function ChecklistKpis({ data }: { data: ChecklistProgressData }) {
  const durations = timing(data);
  const current = data.active[0];
  const metrics = [
    { icon: Clock3, heading: "Elapsed", value: formatDuration(durations.elapsed) },
    { icon: Gauge, heading: "Avg pace", value: formatDuration(durations.pace) },
    { icon: TimerReset, heading: "Time left", value: formatDuration(durations.timeLeft) },
  ];
  return <KpiStrip ariaLabel="Burnlist progress KPIs" className="driving-parity-kpi-strip has-burns checklist-kpi-strip">
    <KpiItem className="driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current" title={current?.title ?? "No active task"} visual={<ClipboardList aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" />} heading="Current" value={current ? `${current.id} · Active` : "Complete"} />
    <KpiItem className="driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress" title={`${data.done} of ${data.total} tasks complete`} visual={<ProgressDonut percent={data.percent} />} heading="Progress" value={<><span className="pass">{data.done}</span><span className="separator">·</span><span className="total">{data.total}</span> <span className="pass">({data.percent}%)</span></>} />
    {metrics.map(({ icon: Icon, heading, value }) => <KpiItem className="driving-parity-kpi-item driving-parity-kpi-section" heading={heading} key={heading} value={value} visual={<Icon aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" />} />)}
  </KpiStrip>;
}

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 260 });
  useEffect(() => {
    if (!ref.current) return;
    const resize = () => setSize({ width: Math.max(360, Math.round(ref.current?.clientWidth ?? 640)), height: Math.max(200, Math.round(ref.current?.clientHeight ?? 260)) });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

export function ProgressChart({ history }: { history: HistoryPoint[] }) {
  const { ref, width, height } = useElementSize();
  const chart = useMemo(() => buildChecklistProgressChart(history, "done", { width, height }), [height, history, width]);
  const formatTick = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return <div className="chart-wrap" ref={ref}><svg aria-label="Completion percentage over time" className="chart checklist-progress-chart" role="img" viewBox={`0 0 ${chart.width} ${chart.height}`}>
    {chart.yTicks.map((tick) => <g key={tick.value}><line className="grid-line" x1={chart.plot.left} x2={chart.plot.right} y1={tick.y} y2={tick.y} />{tick.value > 0 && <><rect className="label-backdrop" height="16" width="44" x={chart.width - 44} y={Math.max(0, Math.min(chart.height - 16, tick.y - 8))} /><text className="axis-label y-axis-label" dominantBaseline="central" textAnchor="end" x={chart.width - 4} y={Math.max(8, Math.min(chart.height - 8, tick.y))}>{tick.label}</text></>}</g>)}
    {chart.xTicks.map((tick, index) => index > 0 && index < chart.xTicks.length - 1 ? <g key={`${tick.time}/${index}`}><line className="grid-line x-grid-line" x1={tick.x} x2={tick.x} y1={chart.plot.top} y2={chart.plot.bottom} /><text className="axis-label x-axis-label" textAnchor="middle" x={tick.x} y={chart.height - 6}>{formatTick(tick.time)}</text></g> : null)}
    <path className="progress-area" d={chart.area} /><path className="progress-line" d={chart.path} />
    {chart.markers.map((marker, index) => <text className={marker.type === "split" ? "split-marker" : "completion-marker"} key={`${marker.type}/${marker.x}/${index}`} x={marker.x} y={marker.y}>{marker.type === "split" ? "▲" : "▼"}<title>{marker.title}</title></text>)}
    <circle className="progress-dot" cx={chart.last.x} cy={chart.last.y} r="4" />
  </svg></div>;
}

export function ProgressPanel({ data }: { data: ChecklistProgressData }) {
  return <section className="panel progress-panel"><div className="panel-title-row"><span className="burn-chart-label">Completion</span></div><div className="score"><ProgressChart history={progressHistory(data)} /></div></section>;
}

export function ProgressLedger({ data }: { data: ChecklistProgressData }) {
  const rows = eventRows(data).slice(0, 8);
  return <section className="panel work-panel event-ledger-panel"><div className="work-panel-head"><div className="work-panel-title">Progress</div></div><div className="work-panel-body"><div className="checklist-log"><LogTable
    columns={["Age", "Event", "Result", "Delta", "Done"]}
    rows={rows.map((item) => ({
      key: `${item.id}/${item.completedAt}`,
      className: "log-row log-table-row",
      cells: [
        { className: "log-table-cell age", content: compactAge(item.completedAt, data.generatedAt) },
        { className: "log-table-cell event", content: item.id },
        { className: "log-table-cell result improved", content: "Done" },
        { className: "log-table-cell delta improved", content: "+1" },
        { className: "log-table-cell done", content: <>{item.percent}%</> },
      ],
    }))}
    emptyState={<div className="event-ledger-empty">No completed events</div>}
  /></div></div></section>;
}

function EventDetail({ detail }: { detail: string }) {
  const fields = checklistEventDetailFields(detail).filter((field) => field.label !== "Completed" && field.values.length);
  return <div className="event-card-fields">{fields.map((field) => {
    const collapsible = field.label === "Changed" || field.label === "Proof";
    if (collapsible) return <details className="event-card-field event-card-field-collapsible" key={field.label}><summary><span>{field.label}</span><span className="event-card-field-count">{field.values.length}</span></summary><ul>{field.values.map((value, index) => <li key={`${field.label}/${index}`}>{value}</li>)}</ul></details>;
    const label = field.label === "Detail" ? "Outcome" : field.label;
    return <div className="event-card-field" key={field.label}><div className="event-card-field-label">{label}</div><div className="event-card-field-value">{field.values.map((value, index) => <p key={`${field.label}/${index}`}>{value}</p>)}</div></div>;
  })}</div>;
}

export function EventCardList({ data }: { data: ChecklistProgressData }) {
  const rows = eventRows(data);
  return <section className="checklist-events-section"><div className="checklist-events-head"><SectionHeader title="Events" count={rows.length} /></div><div className="event-card-list">{rows.map((item) => {
    const key = `${item.id}/${item.completedAt}`;
    const fields = item.detail ? checklistEventDetailFields(item.detail) : [];
    const hasDetail = fields.some((field) => field.label !== "Completed" && field.values.length);
    return <article className="event-card" data-event-card="true" key={key}>
      <header className="event-card-summary"><span className="event-card-id">{item.id}</span><span className="event-card-title">{item.title}</span><span className="event-card-meta"><time dateTime={item.completedAt} title={new Date(item.completedAt).toLocaleString()}>{compactAge(item.completedAt, data.generatedAt)}</time><span className="separator">·</span><span>{item.percent}%</span></span></header>
      <div className="event-card-description">{item.detail && hasDetail ? <EventDetail detail={item.detail} /> : <div className="event-card-field"><div className="event-card-field-label">Outcome</div><div className="event-card-field-value"><p>Completed.</p></div></div>}</div>
    </article>;
  })}{!rows.length && <p className="target-empty">No completed events yet.</p>}</div></section>;
}

export function LoopRunPanel({ data }: { data: ChecklistProgressData }) {
  const run = data.loopRun;
  if (!run) return data.loopProjectionDiagnostic ? <section className="panel checklist-loop-run" aria-label="Loop run diagnostic" role="alert">
    <div className="work-panel-head"><div className="work-panel-title">Loop Run</div><span className="checklist-loop-state">Corrupt projection</span></div>
    <p className="checklist-loop-result">{data.loopProjectionMessage || "The Loop projection is corrupt. Progress remains available while the dashboard waits for a verified projection."}</p>
  </section> : null;
  const stateLabel: Record<string, string> = {
    paused: "Paused", failed: "Failed", stopped: "Stopped", "needs-human": "Needs human review",
    "budget-exhausted": "Budget exhausted", corrupt: "Corrupt projection", stale: "Stale projection", converged: "Converged", completed: "Completed",
  };
  const state = run.diagnostic === "corrupt" ? "Corrupt projection" : run.diagnostic === "stale" ? "Stale projection" : stateLabel[run.state] ?? run.state;
  const budget = run.budget;
  const nodeById = new Map(run.graph.nodes.map((node) => [node.id, node]));
  const orderedEdges = [...run.graph.edges].sort((left, right) => {
    const stage = (edge: typeof left) => edge.from === "implement" ? 0 : edge.from === "verify" ? 1 : edge.from === "review" ? 2 : edge.from === "converged" ? 3 : 4;
    return stage(left) - stage(right) || left.from.localeCompare(right.from) || left.on.localeCompare(right.on);
  });
  const roleResults = [
    ["Maker", run.latestMaker], ["Check", run.latestCheck], ["Reviewer", run.latestReviewer],
  ] as const;
  return <section className="panel checklist-loop-run" aria-label="Loop run">
    <div className="work-panel-head"><div className="work-panel-title">Loop Run</div>
      <span className="checklist-loop-state" aria-label={`Loop state: ${state}`}>{state}</span></div>
    <p className="checklist-loop-identity"><strong>{run.loopId}</strong>{run.loopRevision && <code>{run.loopRevision}</code>} <time dateTime={new Date(run.createdAt).toISOString()}>started {new Date(run.createdAt).toLocaleString()}</time> <time dateTime={new Date(run.updatedAt).toISOString()}>updated {new Date(run.updatedAt).toLocaleString()}</time></p>
    <div className="checklist-loop-current"><strong>Current</strong> {run.currentNode} · attempt {run.attempt} · cycle {run.cycle}</div>
    <dl className="checklist-loop-budget" aria-label="Loop budget">
      <div><dt>Elapsed</dt><dd>{formatDuration(budget.elapsedMilliseconds)}</dd></div>
      <div><dt>Rounds</dt><dd>{budget.counters.rounds}/{budget.limits.maxRounds}</dd></div>
      <div><dt>Agent runs</dt><dd>{budget.counters.agentRuns}/{budget.limits.maxAgentRuns}</dd></div>
      <div><dt>Checks</dt><dd>{budget.counters.checkRuns}/{budget.limits.maxCheckRuns}</dd></div>
      <div><dt>Transitions</dt><dd>{budget.counters.transitions}/{budget.limits.maxTransitions}</dd></div>
    </dl>
    <ol className="checklist-loop-graph" aria-label="Loop nodes">{run.graph.nodes.map((node) =>
      <li aria-current={node.id === run.currentNode ? "step" : undefined} className={node.id === run.currentNode ? "current" : ""} key={node.id}>
        <span>{node.id}</span><small>{node.kind}</small>
      </li>)}</ol>
    <ol className="checklist-loop-edges" aria-label="Loop graph edges">{orderedEdges.map((edge) =>
      <li key={`${edge.from}:${edge.on}:${edge.to}`}><strong>{nodeById.get(edge.from)?.id ?? edge.from}</strong> <span>—{edge.on}→</span> <strong>{nodeById.get(edge.to)?.id ?? edge.to}</strong></li>)}</ol>
    {roleResults.some(([, result]) => result) && <dl className="checklist-loop-results" aria-label="Latest role evidence">{roleResults.map(([role, result]) => result &&
      <div key={role}><dt>{role}</dt><dd>{result.summary} <time dateTime={new Date(result.at).toISOString()}>{new Date(result.at).toLocaleString()}</time>{result.candidateId && <small>candidate {result.candidateId}</small>}</dd></div>)}</dl>}
    {run.latestResult && <p className="checklist-loop-result"><strong>Latest</strong> {run.latestResult.kind} · {run.latestResult.summary}</p>}
    <ol className="checklist-loop-transitions">{run.transitions.map((transition) =>
      <li key={transition.sequence}>{transition.from} <span>—{transition.outcome}→</span> {transition.to}</li>)}</ol>
  </section>;
}

export function ChecklistDashboard({ data }: { data: ChecklistProgressData }) {
  useEffect(() => {
    document.body.classList.add("driving-parity-view", "checklist-detail-view");
    return () => document.body.classList.remove("driving-parity-view", "checklist-detail-view");
  }, []);
  return <div className="shell detail-view-shell driving-parity-view checklist-detail-shell"><main className="detail-view" id="burnlist-detail"><section className="differential-overview checklist-overview"><ChecklistKpis data={data} /></section><LoopRunPanel data={data} /><div className="detail-workspace checklist-progress-workspace" data-detail-tab="dashboard"><ProgressLedger data={data} /><ProgressPanel data={data} /></div><EventCardList data={data} /></main></div>;
}
