import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { ChartLine, LayoutGrid, Table2, Triangle } from "lucide-react";

type MetricSummary = {
  label: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  uniqueTicks?: number;
  status?: string | null;
};

type CompareSample = [tick: number, reference: unknown, candidate: unknown, state: number];

type CompareField = {
  id: string;
  label: string;
  sourceOwner: string | null;
  semantics: { kind?: string; meaning?: string } | null;
  unit: string | null;
  tolerance: number;
  trustStatus: string;
  driftClass: string | null;
  driftReason: string | null;
  sampleCount: number;
  failedSampleCount: number;
  missingSampleCount: number;
  firstFailingTick: number | null;
  maxDelta: number | null;
  samples: CompareSample[];
};

type ProgressPoint = {
  timestamp: string;
  value: number;
  result: string;
  failedFieldCount: number;
};

type LogEntry = {
  timestamp: string;
  result: string;
  value: number;
  delta: number | null;
  failedFieldCount: number;
  firstFailingTick: number | null;
  firstFailingLabel: string | null;
};

type ComparePayload = {
  schema: string;
  generatedAt: string;
  title: string;
  subtitle: string;
  trust: {
    status: string;
    reportStatus: string | null;
    blockers: string[];
  };
  summary: {
    runs: MetricSummary;
    fields: MetricSummary;
    frames: MetricSummary;
  };
  progress: ProgressPoint[];
  log: LogEntry[];
  fields: CompareField[];
};

type OvenCell = {
  id: string;
  title: string;
  widget: string;
  source: string;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
};

type CompareOven = {
  detail: {
    columns: number;
    rows: number;
    rowHeight: number;
    cells: OvenCell[];
  };
};

type ViewMode = "cards" | "table";
type ChartMode = "current" | "delta";
type FieldFilter = "all" | "failing" | "passing";
type SortMode = "default" | "failing" | "name" | "drift";

const WIDTH = 960;
const HEIGHT = 88;
const GREEN = "#61d394";
const RED = "#ff3b45";
const GRID = "#282828";

function finitePlotValue(value: unknown, categories: Map<string, number>) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    if (!categories.has(value)) categories.set(value, categories.size);
    return categories.get(value)!;
  }
  return null;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function compactCount(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  if (Number.isInteger(value)) return formatCount(value);
  return value.toFixed(Math.abs(value) < 0.1 ? 6 : 4);
}

function nonPassSampleCount(field: CompareField) {
  return field.failedSampleCount + field.missingSampleCount;
}

function fieldResult(field: CompareField) {
  if (field.trustStatus === "blocked" || field.missingSampleCount > 0) return "BLOCKED";
  return field.failedSampleCount > 0 ? "FAIL" : "PASS";
}

function relativeAge(timestamp: string) {
  const milliseconds = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) return timestamp;
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeOnly(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function Gauge({ metric }: { metric: MetricSummary }) {
  const ratio = metric.total > 0 ? metric.passed / metric.total : 0;
  const pathLength = 69.12;
  return (
    <svg aria-hidden="true" className="compare-gauge" viewBox="0 0 56 32">
      <path d="M6 28a22 22 0 0 1 44 0" fill="none" stroke="#244f3d" strokeWidth="7" />
      <path
        d="M6 28a22 22 0 0 1 44 0"
        fill="none"
        pathLength={pathLength}
        stroke={metric.failed || metric.blocked ? RED : GREEN}
        strokeDasharray={`${Math.max(0, pathLength * (1 - ratio))} ${pathLength}`}
        strokeDashoffset={-pathLength * ratio}
        strokeWidth="7"
      />
    </svg>
  );
}

function Metric({ metric }: { metric: MetricSummary }) {
  const nonPassed = metric.failed + metric.blocked;
  return (
    <div className="compare-metric">
      <Gauge metric={metric} />
      <div className="compare-metric-copy">
        <strong>{metric.label}</strong>
        <span>
          {formatCount(metric.total)} total / <b className="compare-bad">{formatCount(nonPassed)}</b> / <b className="compare-good">{formatCount(metric.passed)}</b>
        </span>
      </div>
    </div>
  );
}

function ProgressChart({ points }: { points: ProgressPoint[] }) {
  if (!points.length) return <div className="compare-empty">No comparable history.</div>;
  const width = 560;
  const height = 230;
  const pad = { left: 8, right: 54, top: 18, bottom: 24 };
  const values = points.map((point) => Math.max(0, point.value));
  const max = Math.max(1, ...values);
  const x = (index: number) => pad.left + (index / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  let path = `M${x(0)},${y(values[0])}`;
  for (let index = 1; index < values.length; index += 1) {
    path += `H${x(index)}V${y(values[index])}`;
  }
  const baseline = height - pad.bottom;
  const area = `${path}V${baseline}H${x(0)}Z`;
  const latest = points.at(-1)!;
  return (
    <svg className="compare-progress-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {[0, 0.33, 0.66, 1].map((fraction) => {
        const lineY = pad.top + fraction * (height - pad.top - pad.bottom);
        return <line key={fraction} x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke={GRID} strokeWidth="1" />;
      })}
      <path d={area} fill={latest.value === 0 ? GREEN : RED} opacity="0.11" />
      <path d={path} fill="none" stroke={latest.value === 0 ? GREEN : RED} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} fill={latest.value === 0 ? GREEN : RED} r="4" />
      <text x={width - pad.right + 8} y={y(values.at(-1)!) + 4} fill={latest.value === 0 ? GREEN : RED}>{formatCount(latest.value)}</text>
      <text x={pad.left} y={height - 5} fill="#888">{timeOnly(points[0].timestamp)}</text>
      <text x={width - pad.right} y={height - 5} fill="#888" textAnchor="end">{timeOnly(latest.timestamp)}</text>
    </svg>
  );
}

function BurnLog({ entries }: { entries: LogEntry[] }) {
  return (
    <div className="compare-log-list">
      <div className="compare-log-head"><span>Age</span><span>Result</span><span>Value</span><span>Delta</span><span>Timestamp</span></div>
      {entries.slice(0, 8).map((entry, index) => (
        <div className="compare-log-row" key={`${entry.timestamp}-${index}`} title={entry.firstFailingLabel ?? undefined}>
          <span>{relativeAge(entry.timestamp)}</span>
          <strong className={`compare-result ${entry.result}`}>{entry.result}</strong>
          <span>{formatCount(entry.value)}</span>
          <span>{entry.delta === null ? "" : `${entry.delta > 0 ? "+" : ""}${formatCount(entry.delta)}`}</span>
          <time>{timeOnly(entry.timestamp)}</time>
        </div>
      ))}
    </div>
  );
}

function contiguousPaths(points: Array<[number, number] | null>) {
  const paths: string[] = [];
  let current = "";
  for (const point of points) {
    if (!point) {
      if (current) paths.push(current);
      current = "";
      continue;
    }
    current += `${current ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`;
  }
  if (current) paths.push(current);
  return paths;
}

function FieldChart({ field, mode }: { field: CompareField; mode: ChartMode }) {
  const categories = new Map<string, number>();
  const rows = field.samples.map(([tick, reference, candidate, state]) => ({
    tick,
    reference: finitePlotValue(reference, categories),
    candidate: finitePlotValue(candidate, categories),
    state,
  }));
  const values = mode === "delta"
    ? rows.map((row) => row.reference === null || row.candidate === null ? null : Math.abs(row.reference - row.candidate))
    : rows.flatMap((row) => [row.reference, row.candidate]).filter((value): value is number => value !== null);
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const min = mode === "delta" ? 0 : Math.min(...finiteValues, 0);
  const rawMax = Math.max(...finiteValues, 0);
  const max = rawMax === min ? min + 1 : rawMax;
  const minTick = rows[0]?.tick ?? 0;
  const maxTick = rows.at(-1)?.tick ?? minTick + 1;
  const x = (tick: number) => ((tick - minTick) / Math.max(1, maxTick - minTick)) * WIDTH;
  const y = (value: number) => 8 + (1 - (value - min) / (max - min)) * (HEIGHT - 16);
  const referencePoints = mode === "current" ? rows.map((row) => row.reference === null ? null : [x(row.tick), y(row.reference)] as [number, number]) : [];
  const candidatePoints = mode === "current" ? rows.map((row) => row.candidate === null ? null : [x(row.tick), y(row.candidate)] as [number, number]) : [];
  const deltaPoints = mode === "delta" ? rows.map((row) => row.reference === null || row.candidate === null ? null : [x(row.tick), y(Math.abs(row.reference - row.candidate))] as [number, number]) : [];
  const failureBands: Array<{ x: number; width: number }> = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].state === 0) continue;
    const start = index;
    while (index + 1 < rows.length && rows[index + 1].state !== 0) index += 1;
    const x1 = x(rows[start].tick);
    const x2 = x(rows[index].tick);
    failureBands.push({ x: x1, width: Math.max(1, x2 - x1) });
  }
  const ticks = Array.from({ length: 6 }, (_, index) => minTick + ((maxTick - minTick) * index) / 5);
  return (
    <svg className="compare-field-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
      {ticks.map((tick) => <line key={tick} x1={x(tick)} x2={x(tick)} y1="0" y2={HEIGHT} stroke={GRID} strokeWidth="1" />)}
      {failureBands.map((band, index) => <rect fill={RED} height={HEIGHT} key={`${band.x}-${index}`} opacity="0.12" width={band.width} x={band.x} y="0" />)}
      {mode === "delta" && <line x1="0" x2={WIDTH} y1={y(0)} y2={y(0)} stroke={GREEN} strokeDasharray="5 4" strokeWidth="1" />}
      {contiguousPaths(referencePoints).map((path, index) => <path d={path} fill="none" key={`r-${index}`} opacity="0.9" stroke={GREEN} strokeDasharray="5 4" strokeWidth="1.35" vectorEffect="non-scaling-stroke" />)}
      {contiguousPaths(candidatePoints).map((path, index) => <path d={path} fill="none" key={`c-${index}`} opacity="0.9" stroke={nonPassSampleCount(field) ? RED : GREEN} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
      {contiguousPaths(deltaPoints).map((path, index) => <path d={path} fill="none" key={`d-${index}`} opacity="0.9" stroke={nonPassSampleCount(field) ? RED : GREEN} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
      {ticks.map((tick) => <text fill="#777" fontSize="8" key={`t-${tick}`} textAnchor="middle" x={x(tick)} y="8">{Math.round(tick)}</text>)}
    </svg>
  );
}

function FieldLabel({ field }: { field: CompareField }) {
  const description = field.semantics?.meaning ?? field.driftReason ?? field.sourceOwner ?? "";
  const result = fieldResult(field);
  const nonPass = nonPassSampleCount(field);
  return (
    <div className="compare-field-label">
      <strong title={field.label}>{field.label}</strong>
      <b className={nonPass ? "compare-bad" : "compare-good"}>
        {nonPass ? `${formatCount(nonPass)} ${result.toLowerCase()}` : result}
      </b>
      <span title={description}>{description}</span>
      <small>{formatValue(field.maxDelta)}</small>
    </div>
  );
}

function FieldCards({ fields, chartMode }: { fields: CompareField[]; chartMode: ChartMode }) {
  return <div className="compare-field-rows">{fields.map((field) => <div className={`compare-field-row ${nonPassSampleCount(field) ? "fail" : "pass"}`} key={field.id}><FieldLabel field={field} /><FieldChart field={field} mode={chartMode} /></div>)}</div>;
}

function FieldTable({ fields, chartMode }: { fields: CompareField[]; chartMode: ChartMode }) {
  return (
    <div className="compare-field-table-wrap">
      <table className="compare-field-table">
        <thead><tr><th>Field</th><th>Status</th><th>Non-pass</th><th>Max delta</th><th>Trace</th></tr></thead>
        <tbody>{fields.map((field) => <tr key={field.id}><td>{field.label}</td><td className={nonPassSampleCount(field) ? "compare-bad" : "compare-good"}>{fieldResult(field)}</td><td>{formatCount(nonPassSampleCount(field))}</td><td>{formatValue(field.maxDelta)}</td><td><FieldChart field={field} mode={chartMode} /></td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Cell({ cell, rowHeight, children, className = "" }: { cell: OvenCell; rowHeight: number; children: React.ReactNode; className?: string }) {
  const style: CSSProperties = {
    gridColumn: `${cell.column} / span ${cell.columnSpan}`,
    gridRow: `${cell.row} / span ${cell.rowSpan}`,
    minHeight: cell.rowSpan * rowHeight,
  };
  return <section className={className} style={style}>{children}</section>;
}

function CompareContent({ oven, payload }: { oven: CompareOven; payload: ComparePayload }) {
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [chartMode, setChartMode] = useState<ChartMode>("current");
  const [filter, setFilter] = useState<FieldFilter>("all");
  const [sort, setSort] = useState<SortMode>("default");
  const [search, setSearch] = useState("");
  const cells = new Map(oven.detail.cells.map((cell) => [cell.id, cell]));
  const visibleFields = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = payload.fields.filter((field) => {
      if (filter === "failing" && nonPassSampleCount(field) === 0) return false;
      if (filter === "passing" && nonPassSampleCount(field) > 0) return false;
      return !query || [field.label, field.sourceOwner, field.driftClass].some((value) => String(value ?? "").toLowerCase().includes(query));
    });
    return filtered.toSorted((left, right) => {
      if (sort === "name") return left.label.localeCompare(right.label);
      if (sort === "failing") return nonPassSampleCount(right) - nonPassSampleCount(left) || left.label.localeCompare(right.label);
      if (sort === "drift") return String(left.driftClass).localeCompare(String(right.driftClass)) || left.label.localeCompare(right.label);
      return payload.fields.indexOf(left) - payload.fields.indexOf(right);
    });
  }, [filter, payload.fields, search, sort]);
  const metricCells = [cells.get("runs"), cells.get("fields"), cells.get("frames")];
  const progressCell = cells.get("progress");
  const logCell = cells.get("log");
  const fieldsCell = cells.get("field-details");
  if (metricCells.some((cell) => !cell) || !progressCell || !logCell || !fieldsCell) return <div className="compare-empty">Compare Oven layout is incomplete.</div>;
  const gridStyle = { gridTemplateColumns: `repeat(${oven.detail.columns}, minmax(0, 1fr))`, gridAutoRows: `${oven.detail.rowHeight}px` };
  return (
    <div className="compare-oven-grid" style={gridStyle}>
      <Cell cell={metricCells[0]!} className="compare-metric-cell first" rowHeight={oven.detail.rowHeight}><Metric metric={payload.summary.runs} /></Cell>
      <Cell cell={metricCells[1]!} className="compare-metric-cell" rowHeight={oven.detail.rowHeight}><Metric metric={payload.summary.fields} /></Cell>
      <Cell cell={metricCells[2]!} className="compare-metric-cell last" rowHeight={oven.detail.rowHeight}><Metric metric={payload.summary.frames} /></Cell>
      <Cell cell={progressCell} className="compare-panel compare-progress-panel" rowHeight={oven.detail.rowHeight}><h2>{progressCell.title}</h2><ProgressChart points={payload.progress} /></Cell>
      <Cell cell={logCell} className="compare-panel compare-log-panel" rowHeight={oven.detail.rowHeight}><h2>{logCell.title}</h2><BurnLog entries={payload.log} /></Cell>
      <Cell cell={fieldsCell} className="compare-fields-cell" rowHeight={oven.detail.rowHeight}>
        <div className="compare-fields-toolbar">
          <h2>{fieldsCell.title}</h2>
          <div className="compare-controls">
            <button aria-label="Cards view" aria-pressed={viewMode === "cards"} onClick={() => setViewMode("cards")} title="Cards view"><LayoutGrid /></button>
            <button aria-label="Table view" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")} title="Table view"><Table2 /></button>
            <button aria-label="Current traces" aria-pressed={chartMode === "current"} onClick={() => setChartMode("current")} title="Current traces"><ChartLine /></button>
            <button aria-label="Delta traces" aria-pressed={chartMode === "delta"} onClick={() => setChartMode("delta")} title="Delta traces"><Triangle /></button>
            <select aria-label="Sort fields" onChange={(event) => setSort(event.target.value as SortMode)} value={sort}><option value="default">Default</option><option value="failing">Failing</option><option value="name">Name</option><option value="drift">Drift</option></select>
            <select aria-label="Filter fields" onChange={(event) => setFilter(event.target.value as FieldFilter)} value={filter}><option value="all">All</option><option value="failing">Failing</option><option value="passing">Passing</option></select>
            <input aria-label="Search fields" onChange={(event) => setSearch(event.target.value)} placeholder="Search..." type="search" value={search} />
          </div>
        </div>
        <div className="compare-fields-summary">{formatCount(visibleFields.length)} / {formatCount(payload.fields.length)} fields · {formatCount(payload.summary.frames.uniqueTicks ?? 0)} aligned ticks · trust {payload.trust.status}</div>
        {viewMode === "cards" ? <FieldCards chartMode={chartMode} fields={visibleFields} /> : <FieldTable chartMode={chartMode} fields={visibleFields} />}
      </Cell>
    </div>
  );
}

export function CompareOvenPage() {
  const [payload, setPayload] = useState<ComparePayload | null>(null);
  const [oven, setOven] = useState<CompareOven | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    document.body.classList.add("compare-oven-body");
    return () => document.body.classList.remove("compare-oven-body");
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [ovenResponse, dataResponse] = await Promise.all([
          fetch("/api/ovens/compare", { cache: "no-store" }),
          fetch("/api/oven-data/compare", { cache: "no-store" }),
        ]);
        const ovenJson = await ovenResponse.json();
        const dataJson = await dataResponse.json();
        if (!ovenResponse.ok) throw new Error(ovenJson.error ?? "Could not load Compare Oven.");
        if (!dataResponse.ok) throw new Error(dataJson.error ?? "Could not load Compare data.");
        if (cancelled) return;
        setOven(ovenJson.oven);
        setPayload(dataJson.payload);
        setError("");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Compare dashboard.");
      }
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return (
    <div className="compare-oven-page">
      <nav className="compare-nav"><a href="/">Burnlists</a><span>Compare</span></nav>
      <header className="compare-header">
        <div><h1>{payload?.title ?? "Compare"}</h1><p>{payload?.subtitle ?? "Loading normalized comparison data"}</p></div>
        <div className="compare-header-status">{payload ? <><span className={payload.trust.status === "pass" ? "compare-good" : "compare-bad"}>trust {payload.trust.status}</span> / <span className={payload.trust.reportStatus === "pass" ? "compare-good" : "compare-bad"}>report {payload.trust.reportStatus}</span></> : "loading"}</div>
      </header>
      {error ? <div className="compare-error">{error}</div> : oven && payload ? <CompareContent oven={oven} payload={payload} /> : <div className="compare-empty">Loading Compare Oven.</div>}
    </div>
  );
}
