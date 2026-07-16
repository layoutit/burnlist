import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Clock3, Gauge, TimerReset } from "lucide-react";
import type { ChecklistProgressData, CompletedItem, HistoryPoint } from "@lib";
import "./ChecklistDashboard.css";
// @ts-expect-error The chart model is plain ESM so the dashboard and Node tests share it.
import { buildChecklistProgressChart } from "../../lib/checklist-progress-chart.js";

function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--";
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function compactAge(value: string, now: string) {
  const delta = Math.max(0, Date.parse(now) - Date.parse(value));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function timing(data: ChecklistProgressData) {
  const points = data.history.filter((point) => Number.isFinite(Date.parse(point.time)));
  const completedTimes = data.completed.map((item) => Date.parse(item.completedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const start = points.length ? Date.parse(points[0].time) : completedTimes[0] ?? Date.parse(data.generatedAt);
  const lastCompletion = completedTimes.at(-1) ?? start;
  const end = data.remaining === 0 && completedTimes.length ? lastCompletion : Date.parse(data.generatedAt);
  const intervals = completedTimes.map((time, index) => time - (index ? completedTimes[index - 1] : start)).filter((value) => value >= 0);
  if (data.remaining > 0) intervals.push(Math.max(0, end - lastCompletion));
  const pace = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
  const currentAge = Math.max(0, end - lastCompletion);
  const timeLeft = data.remaining ? Math.max(pace, currentAge) + Math.max(0, data.remaining - 1) * pace : 0;
  return { elapsed: end - start, pace, timeLeft };
}

function ProgressDonut({ percent }: { percent: number }) {
  const donePercent = Math.max(0, Math.min(100, percent));
  const remainingPercent = Math.max(0, 100 - donePercent);
  return <svg aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-progress-donut" viewBox="0 0 58 58"><circle className="driving-parity-kpi-progress-donut-track" cx="29" cy="29" r="21" /><circle className="driving-parity-kpi-progress-donut-segment" cx="29" cy="29" r="21" pathLength="100" strokeDasharray={`${donePercent.toFixed(3)} ${remainingPercent.toFixed(3)}`} transform="rotate(-90 29 29)" /></svg>;
}

function ChecklistKpis({ data }: { data: ChecklistProgressData }) {
  const durations = timing(data);
  const current = data.active[0];
  const metrics = [
    { icon: Clock3, heading: "Elapsed", value: formatDuration(durations.elapsed) },
    { icon: Gauge, heading: "Avg pace", value: formatDuration(durations.pace) },
    { icon: TimerReset, heading: "Time left", value: formatDuration(durations.timeLeft) },
  ];
  return <div aria-label="Burnlist progress KPIs" className="driving-parity-kpi-strip has-burns checklist-kpi-strip">
    <div className="driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current" title={current?.title ?? "No active task"}><ClipboardList aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" /><div className="driving-parity-kpi-text"><div className="driving-parity-kpi-heading">Current</div><div className="driving-parity-kpi-ratio">{current ? `${current.id} · Active` : "Complete"}</div></div></div>
    <div className="driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress" title={`${data.done} of ${data.total} tasks complete`}><ProgressDonut percent={data.percent} /><div className="driving-parity-kpi-text"><div className="driving-parity-kpi-heading">Progress</div><div className="driving-parity-kpi-ratio"><span className="pass">{data.done}</span><span className="separator">·</span><span className="total">{data.total}</span> <span className="pass">({data.percent}%)</span></div></div></div>
    {metrics.map(({ icon: Icon, heading, value }) => <div className="driving-parity-kpi-item driving-parity-kpi-section" key={heading}><Icon aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" /><div className="driving-parity-kpi-text"><div className="driving-parity-kpi-heading">{heading}</div><div className="driving-parity-kpi-ratio">{value}</div></div></div>)}
  </div>;
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

function ProgressChart({ history }: { history: HistoryPoint[] }) {
  const { ref, width, height } = useElementSize();
  const chart = useMemo(() => buildChecklistProgressChart(history, "burn", { width, height }), [height, history, width]);
  const formatTick = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return <div className="chart-wrap" ref={ref}><svg aria-label="Remaining items over time" className="chart checklist-progress-chart" role="img" viewBox={`0 0 ${chart.width} ${chart.height}`}>
    {chart.yTicks.map((tick) => <g key={tick.value}><line className="grid-line" x1={chart.plot.left} x2={chart.plot.right} y1={tick.y} y2={tick.y} />{tick.value > 0 && <><rect className="label-backdrop" height="16" width="44" x={chart.width - 44} y={Math.max(0, Math.min(chart.height - 16, tick.y - 8))} /><text className="axis-label y-axis-label" dominantBaseline="central" textAnchor="end" x={chart.width - 4} y={Math.max(8, Math.min(chart.height - 8, tick.y))}>{tick.label}</text></>}</g>)}
    {chart.xTicks.map((tick, index) => index > 0 && index < chart.xTicks.length - 1 ? <g key={`${tick.time}/${index}`}><line className="grid-line x-grid-line" x1={tick.x} x2={tick.x} y1={chart.plot.top} y2={chart.plot.bottom} /><text className="axis-label x-axis-label" textAnchor="middle" x={tick.x} y={chart.height - 6}>{formatTick(tick.time)}</text></g> : null)}
    <path className="progress-area" d={chart.area} /><path className="progress-line" d={chart.path} />
    {chart.markers.map((marker, index) => <text className={marker.type === "split" ? "split-marker" : "completion-marker"} key={`${marker.type}/${marker.x}/${index}`} x={marker.x} y={marker.y}>{marker.type === "split" ? "▲" : "▼"}<title>{marker.title}</title></text>)}
    <circle className="progress-dot" cx={chart.last.x} cy={chart.last.y} r="4" />
  </svg></div>;
}

function ProgressPanel({ data }: { data: ChecklistProgressData }) {
  return <section className="panel progress-panel"><div className="panel-title-row"><span className="burn-chart-label">Burn</span></div><div className="score"><ProgressChart history={progressHistory(data)} /></div></section>;
}

type EventRow = CompletedItem & { ordinal: number; percent: number };
type EventDetailField = { label: string; values: string[] };

const EVENT_DETAIL_LABELS = new Set(["Completed", "Changed", "Proof", "Outcome", "Follow-up"]);

export function checklistEventDetailFields(detail: string): EventDetailField[] {
  const fields: EventDetailField[] = [];
  let current: EventDetailField | null = null;
  for (const rawLine of detail.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^([^:]+):(?:\s*(.*))?$/u);
    if (heading && EVENT_DETAIL_LABELS.has(heading[1])) {
      current = { label: heading[1], values: [] };
      fields.push(current);
      if (heading[2]) current.values.push(heading[2]);
      continue;
    }
    if (!current) {
      current = { label: "Detail", values: [] };
      fields.push(current);
    }
    current.values.push(line.replace(/^-\s+/u, ""));
  }
  return fields;
}

function eventRows(data: ChecklistProgressData): EventRow[] {
  const total = Math.max(1, data.total);
  return [...data.completed]
    .sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt))
    .map((item, index) => ({ ...item, ordinal: index + 1, percent: Math.min(100, Math.round(((index + 1) / total) * 100)) }))
    .reverse();
}

function progressHistory(data: ChecklistProgressData): HistoryPoint[] {
  const provided = data.history
    .filter((point) => Number.isFinite(Date.parse(point.time)))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const monotonic = provided.every((point, index) => index === 0 || point.done >= provided[index - 1].done);
  if (provided.length && monotonic && provided.at(-1)?.done === data.done) return provided;
  const total = Math.max(1, data.total);
  const rebuilt = [...data.completed]
    .sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt))
    .map((item, index) => ({ time: item.completedAt, done: index + 1, remaining: Math.max(0, total - index - 1), total, percent: Math.min(100, Math.round(((index + 1) / total) * 100)) }));
  if (data.remaining > 0 && (!rebuilt.length || Date.parse(data.generatedAt) > Date.parse(rebuilt.at(-1)!.time))) rebuilt.push({ time: data.generatedAt, done: data.done, remaining: data.remaining, total, percent: data.percent });
  return rebuilt;
}

function ProgressLedger({ data }: { data: ChecklistProgressData }) {
  const rows = eventRows(data).slice(0, 8);
  return <section className="panel work-panel event-ledger-panel"><div className="work-panel-head"><div className="work-panel-title">Progress</div></div><div className="work-panel-body"><div className="checklist-log"><div className="checklist-log-list"><div className="checklist-log-table-header"><span>Age</span><span>Event</span><span>Result</span><span>Delta</span><span>Done</span></div>{rows.map((item) => <article className="log-row log-table-row" key={`${item.id}/${item.completedAt}`}><span className="log-table-cell age">{compactAge(item.completedAt, data.generatedAt)}</span><span className="log-table-cell event">{item.id}</span><span className="log-table-cell result improved">Done</span><span className="log-table-cell delta improved">+1</span><span className="log-table-cell done">{item.percent}%</span></article>)}{!rows.length && <div className="event-ledger-empty">No completed events</div>}</div></div></div></section>;
}

function EventDetail({ detail }: { detail: string }) {
  const fields = checklistEventDetailFields(detail).filter((field) => !["Completed", "Outcome", "Detail"].includes(field.label) && field.values.length);
  return <div className="event-card-fields" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{fields.map((field) => {
    const collapsible = field.label === "Changed" || field.label === "Proof";
    if (collapsible) return <details className="event-card-field event-card-field-collapsible" key={field.label}><summary><span>{field.label}</span><span className="event-card-field-count">{field.values.length}</span></summary><ul>{field.values.map((value, index) => <li key={`${field.label}/${index}`}>{value}</li>)}</ul></details>;
    return <div className="event-card-field" key={field.label}><div className="event-card-field-label">{field.label}</div><div className="event-card-field-value">{field.values.map((value, index) => <p key={`${field.label}/${index}`}>{value}</p>)}</div></div>;
  })}</div>;
}

function EventCardList({ data }: { data: ChecklistProgressData }) {
  const rows = eventRows(data);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  return <section className="checklist-events-section"><div className="checklist-events-head"><h2>Events <span className="field-list-count">({rows.length})</span></h2></div><div className="event-card-list">{rows.map((item) => {
    const key = `${item.id}/${item.completedAt}`;
    const fields = item.detail ? checklistEventDetailFields(item.detail) : [];
    const outcome = fields.find((field) => field.label === "Outcome") ?? fields.find((field) => field.label === "Detail");
    const expandable = fields.some((field) => !["Completed", "Outcome", "Detail"].includes(field.label) && field.values.length);
    const expanded = expandable && expandedKey === key;
    const toggle = () => expandable && setExpandedKey((current) => current === key ? null : key);
    return <article aria-expanded={expandable ? expanded : undefined} className={`event-card${expandable ? " expandable" : ""}${expanded ? " expanded" : ""}`} data-event-card="true" key={key} onClick={toggle} onKeyDown={(event) => {
      if (expandable && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        toggle();
      }
    }} role={expandable ? "button" : undefined} tabIndex={expandable ? 0 : undefined}>
      <span className="event-card-cell event-card-identity"><span className="event-card-title">{item.title}</span><span className="event-card-footer"><span className="event-card-id">{item.id}</span><span className="event-card-meta"><time dateTime={item.completedAt} title={new Date(item.completedAt).toLocaleString()}>{compactAge(item.completedAt, data.generatedAt)}</time><span>{item.percent}%</span></span></span></span>
      <div className="event-card-content"><div className="event-card-outcome"><div className="event-card-field-label">Outcome</div><div className="event-card-field-value">{outcome?.values.length ? outcome.values.map((value, index) => <p key={`outcome/${index}`}>{value}</p>) : <p>Completed.</p>}</div></div>{expanded && item.detail && <EventDetail detail={item.detail} />}{expandable && <span aria-hidden="true" className="event-card-expand">{expanded ? "−" : "+"}</span>}</div>
    </article>;
  })}{!rows.length && <p className="target-empty">No completed events yet.</p>}</div></section>;
}

export function ChecklistDashboard({ data }: { data: ChecklistProgressData }) {
  useEffect(() => {
    document.body.classList.add("driving-parity-view", "checklist-detail-view");
    return () => document.body.classList.remove("driving-parity-view", "checklist-detail-view");
  }, []);
  return <div className="shell detail-view-shell driving-parity-view checklist-detail-shell"><main className="detail-view" id="burnlist-detail"><section className="differential-overview checklist-overview"><ChecklistKpis data={data} /></section><div className="detail-workspace checklist-progress-workspace" data-detail-tab="dashboard"><ProgressLedger data={data} /><ProgressPanel data={data} /></div><EventCardList data={data} /></main></div>;
}
