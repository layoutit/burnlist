import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Clock3, Gauge, TimerReset } from "lucide-react";
import type { ChecklistProgressData, HistoryPoint } from "@lib";
import { checklistEventDetailFields, compactAge, eventRows, formatDuration, progressHistory, timing } from "@lib/checklist-adapter";
export { checklistEventDetailFields } from "@lib/checklist-adapter";
import "./ChecklistDashboard.css";
import { buildChecklistProgressChart, KpiItem, KpiStrip, LogTable, ProgressDonut, SectionHeader } from "@oven";
import { LoopGraph } from "@/components/LoopGraph";
import { ChecklistWorkspace } from "@/oven/ChecklistWorkspace";

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
  return <LoopGraph
    run={data.loopRun}
    diagnostic={data.loopRun?.diagnostic ?? data.loopProjectionDiagnostic}
    message={data.loopProjectionMessage}
    title="Current item Loop"
  />;
}

export function ChecklistDashboard({ data }: { data: ChecklistProgressData }) {
  useEffect(() => {
    document.body.classList.add("driving-parity-view", "checklist-detail-view");
    return () => document.body.classList.remove("driving-parity-view", "checklist-detail-view");
  }, []);
  return <div className="shell detail-view-shell driving-parity-view checklist-detail-shell"><main className="detail-view" id="burnlist-detail"><section className="differential-overview checklist-overview"><ChecklistKpis data={data} /></section><div className="detail-workspace checklist-progress-workspace" data-detail-tab="dashboard"><ProgressLedger data={data} /><ProgressPanel data={data} /></div><ChecklistWorkspace data={data} /></main></div>;
}
