import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Clock3, Gauge, TimerReset } from "lucide-react";
// @ts-expect-error The checklist chart model is plain ESM so the dashboard and Node tests share it.
import { buildChecklistProgressChart } from "../checklist-progress-chart.js";
// @ts-expect-error The deterministic graph layout is plain ESM so the dashboard and Node tests share it.
import { layoutRepoGraph } from "../repo-graph-layout.js";

type ChecklistItem = { id: string; title: string; fields: Record<string, string> };
type CompletedItem = { id: string; title: string; completedAt: string; detail: string };
type Warning = { severity: "error" | "warning"; message: string };
type HistoryPoint = { time: string; done: number; remaining: number; total: number; percent: number };

export type ChecklistProgressData = {
  generatedAt: string;
  title: string;
  repo: string;
  planLabel: string;
  total: number;
  done: number;
  remaining: number;
  percent: number;
  warnings: Warning[];
  active: ChecklistItem[];
  completed: CompletedItem[];
  history: HistoryPoint[];
};

type RepoFile = {
  path: string;
  size: number;
  dirty: boolean;
  active: boolean;
  recentlyEdited: boolean;
  status: string;
};

type RepoEdge = { source: string; target: string; type: string };
type RepoMapData = {
  available: boolean;
  workingFiles: RepoFile[];
  workingAllEdges: RepoEdge[];
  importScan?: { bounded?: boolean; availableResolvedEdges?: number };
};
type RepoGraphNode = RepoFile & { group: string; x: number; y: number; r: number; color: string };
type RepoGraphGroup = { id: string; label: string; cx: number; cy: number; r: number; dirty: boolean; count: number };
type RepoGraphLayout = { nodes: RepoGraphNode[]; edges: RepoEdge[]; groups: RepoGraphGroup[] };

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

function relativeAge(value: string, now: string) {
  const delta = Math.max(0, Date.parse(now) - Date.parse(value));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  const value = Math.max(0, Math.min(100, percent));
  return (
    <svg aria-hidden="true" className="driving-parity-kpi-progress-donut" viewBox="0 0 40 40">
      <circle className="driving-parity-kpi-progress-donut-track" cx="20" cy="20" r="15.9155" />
      <circle className="driving-parity-kpi-progress-donut-segment" cx="20" cy="20" r="15.9155" pathLength="100" strokeDasharray={`${value} ${100 - value}`} transform="rotate(-90 20 20)" />
    </svg>
  );
}

function ChecklistKpis({ data }: { data: ChecklistProgressData }) {
  const durations = timing(data);
  const current = data.active[0];
  const metrics = [
    { icon: Clock3, heading: "Elapsed", value: formatDuration(durations.elapsed) },
    { icon: Gauge, heading: "Avg pace", value: formatDuration(durations.pace) },
    { icon: TimerReset, heading: "Time left", value: formatDuration(durations.timeLeft) },
  ];
  return (
    <div aria-label="Burnlist progress KPIs" className="driving-parity-kpi-strip has-burns checklist-kpi-strip">
      <div className="driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current" title={current?.title ?? "No active task"}>
        <ClipboardList aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" />
        <div className="driving-parity-kpi-text"><div className="driving-parity-kpi-heading">Current</div><div className="driving-parity-kpi-ratio">{current ? `${current.id} · Active` : "Complete"}</div></div>
      </div>
      <div className="driving-parity-kpi-item driving-parity-kpi-section" title={`${data.done} of ${data.total} tasks complete`}>
        <ProgressDonut percent={data.percent} />
        <div className="driving-parity-kpi-text"><div className="driving-parity-kpi-heading">Progress</div><div className="driving-parity-kpi-ratio"><span className="pass">{data.done}</span><span className="separator">·</span><span className="total">{data.total}</span> <span className="pass">({data.percent}%)</span></div></div>
      </div>
      {metrics.map(({ icon: Icon, heading, value }) => (
        <div className="driving-parity-kpi-item driving-parity-kpi-section" key={heading}>
          <Icon aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" />
          <div className="driving-parity-kpi-text"><div className="driving-parity-kpi-heading">{heading}</div><div className="driving-parity-kpi-ratio">{value}</div></div>
        </div>
      ))}
    </div>
  );
}

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(180);
  useEffect(() => {
    if (!ref.current) return;
    const resize = () => {
      setWidth(Math.max(320, Math.round(ref.current?.clientWidth ?? 640)));
      setHeight(Math.max(160, Math.round(ref.current?.clientHeight ?? 180)));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width, height };
}

function ProgressChart({ history, mode }: { history: HistoryPoint[]; mode: "done" | "burn" }) {
  const { ref, width, height } = useElementSize();
  const chart = useMemo(() => buildChecklistProgressChart(history, mode, { width, height }), [height, history, mode, width]);
  const formatTick = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="chart-wrap" ref={ref}>
      <svg aria-label={mode === "done" ? "Completion percentage over time" : "Remaining items over time"} className="chart checklist-progress-chart" data-chart-mode={mode} data-plot-bottom={chart.plot.bottom} data-plot-left={chart.plot.left} data-plot-right={chart.plot.right} data-plot-top={chart.plot.top} data-time-scale={chart.timeScale} role="img" viewBox={`0 0 ${chart.width} ${chart.height}`}>
        {chart.yTicks.map((tick) => <g key={tick.value}><line className="grid-line" x1={chart.plot.left} x2={chart.plot.right} y1={tick.y} y2={tick.y} />{tick.value > 0 && <><rect className="label-backdrop" height="16" width="44" x={chart.width - 44} y={Math.max(0, Math.min(chart.height - 16, tick.y - 8))} /><text className="axis-label y-axis-label" dominantBaseline="central" textAnchor="end" x={chart.width - 4} y={Math.max(8, Math.min(chart.height - 8, tick.y))}>{tick.label}</text></>}</g>)}
        {chart.xTicks.map((tick, index) => index > 0 && index < chart.xTicks.length - 1 ? <g key={`${tick.time}/${index}`}><line className="grid-line x-grid-line" x1={tick.x} x2={tick.x} y1={chart.plot.top} y2={chart.height - 22} /><text className="axis-label x-axis-label" textAnchor="middle" x={tick.x} y={chart.height - 6}>{formatTick(tick.time)}</text></g> : null)}
        <path className="progress-area" d={chart.area} />
        <path className="progress-line" d={chart.path} />
        {chart.markers.map((marker, index) => <text className={marker.type === "split" ? "split-marker" : "completion-marker"} key={`${marker.type}/${marker.x}/${index}`} x={marker.x} y={marker.y}>{marker.type === "split" ? "▲" : "▼"}<title>{marker.title}</title></text>)}
        <circle className="progress-dot" cx={chart.last.x} cy={chart.last.y} r="4"><title>{mode === "done" ? `${Math.round(chart.last.value)}% complete` : `${Math.round(chart.last.value)} items remaining`}</title></circle>
      </svg>
    </div>
  );
}

function ProgressPanel({ data }: { data: ChecklistProgressData }) {
  const [mode, setMode] = useState<"done" | "burn">("done");
  const durations = timing(data);
  return (
    <section className="panel progress-panel">
      <div className="panel-title-row">
        <div className="label-toggle" aria-label="Burnlist progress chart view">
          <button className={mode === "done" ? "selected" : ""} onClick={() => setMode("done")}>Done</button><span className="sep">·</span>
          <button className={mode === "burn" ? "selected" : ""} onClick={() => setMode("burn")}>Burn</button>
        </div>
      </div>
      <div className="score">
        <div className="progress-topline">
          <div className="stat"><div className="stat-label">Tasks</div><div className="headline">{data.done}/{data.total}</div></div>
          <div className="stat center"><div className="stat-label">Elapsed</div><div className="elapsed">{formatDuration(durations.elapsed)}</div></div>
          <div className="stat center"><div className="stat-label">Avg pace</div><div className="pace">{formatDuration(durations.pace)}</div></div>
          <div className="stat right"><div className="stat-label">Time left</div><div className="percent">{formatDuration(durations.timeLeft)}</div></div>
        </div>
        <div className="bar" style={{ "--total": Math.max(1, data.total) } as CSSProperties}>
          {Array.from({ length: Math.max(1, data.total) }, (_, index) => <span className={`bar-cell ${index < data.done ? "complete" : ""}`} key={index} />)}
        </div>
        <ProgressChart history={data.history} mode={mode} />
      </div>
    </section>
  );
}

function Timeline({ data }: { data: ChecklistProgressData }) {
  const [mode, setMode] = useState<"all" | "active">("active");
  const [activeIndex, setActiveIndex] = useState(0);
  const [allOpenIndex, setAllOpenIndex] = useState(data.completed.length);
  const all = [
    ...data.completed.map((item) => ({ ...item, state: "done" as const, fields: {} as Record<string, string> })),
    ...data.active.map((item, index) => ({ ...item, state: index === 0 ? "current" as const : "pending" as const, completedAt: "", detail: "" })),
  ];
  const shown = mode === "active" ? data.active.map((item, index) => ({ ...item, state: index === 0 ? "current" as const : "pending" as const, completedAt: "", detail: "" })) : all;
  const selected = mode === "active" ? Math.min(activeIndex, Math.max(0, shown.length - 1)) : -1;
  return (
    <div className="work-tab-pane">
      <div className="work-tab-tools timeline-tab-tools">
        {mode === "active" && <div className="timeline-step"><button disabled={selected <= 0} onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}>Prev</button><span className="sep">·</span><button disabled={selected >= shown.length - 1} onClick={() => setActiveIndex((value) => Math.min(shown.length - 1, value + 1))}>Next</button></div>}
        <div className="label-toggle timeline-controls"><button className={mode === "all" ? "selected" : ""} onClick={() => setMode("all")}>All</button><span className="sep">·</span><button className={mode === "active" ? "selected" : ""} onClick={() => setMode("active")}>Active</button></div>
      </div>
      <div className="timeline">
        {shown.map((item, index) => (
          <details className={`tile focused ${item.state === "done" ? "done" : item.state === "current" ? "current active" : "active"}`} key={`${item.state}/${item.id}/${item.title}`} open={mode === "active" ? index === selected : index === allOpenIndex}>
            <summary className="tile-summary" onClick={(event) => { event.preventDefault(); if (mode === "active") setActiveIndex(index); else setAllOpenIndex(index); }}><span className="tile-marker">{item.id}</span><span className="tile-title">{item.title}</span><em className="tile-status">{item.state === "current" ? "Active" : item.state === "done" ? "Done" : "Pending"}</em></summary>
            <div className="tile-description">
              {item.detail && <p>{item.detail}</p>}
              {Object.entries(item.fields).map(([label, value]) => <details className="tile-field" key={label} open={!/^(files|changed|proof)$/iu.test(label)}><summary className="tile-field-summary">{label}</summary><p>{value}</p></details>)}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function Target({ data }: { data: ChecklistProgressData }) {
  const item = data.active[0];
  if (!item) return <p className="target-empty">No active target.</p>;
  return <div className="target-panel"><div className="target-meta">{item.id} · current active item</div><div className="target-current"><h3>{item.title}</h3>{Object.entries(item.fields).map(([label, value]) => <section key={label}><h4>{label}</h4><p>{value}</p></section>)}</div></div>;
}

function Log({ data }: { data: ChecklistProgressData }) {
  const rows = [...data.completed].reverse();
  return <div className="checklist-log"><div className="checklist-log-list">{rows.map((item) => <article className="log-row done" key={`${item.id}/${item.completedAt}`}><div className="log-meta"><time className="log-time">{new Date(item.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span className="log-age">{relativeAge(item.completedAt, data.generatedAt)}</span><span className="log-title">Completed {item.id}</span></div><div className="log-detail"><div className="log-detail-line lead">{item.title}</div>{item.detail && <div className="log-detail-line">{item.detail}</div>}</div></article>)}{!rows.length && <p className="target-empty">No completed events yet.</p>}</div></div>;
}

function WorkPanel({ data }: { data: ChecklistProgressData }) {
  const [tab, setTab] = useState<"timeline" | "target" | "log">("timeline");
  return <section className="panel work-panel" data-work-tab={tab}><div className="work-panel-head"><div className="work-panel-title">Progress</div><div className="label-toggle work-panel-tabs"><button className={tab === "timeline" ? "selected" : ""} onClick={() => setTab("timeline")}>Timeline</button><span className="sep">·</span><button className={tab === "target" ? "selected" : ""} onClick={() => setTab("target")}>Target</button><span className="sep">·</span><button className={tab === "log" ? "selected" : ""} onClick={() => setTab("log")}>Log</button></div></div><div className="work-panel-body">{tab === "timeline" ? <Timeline data={data} /> : tab === "target" ? <Target data={data} /> : <Log data={data} />}</div></section>;
}

function RepoGraph({ repo, data, onData }: { repo: string; data: RepoMapData | null; onData: (data: RepoMapData) => void }) {
  const [scope, setScope] = useState("src");
  const [selectedPath, setSelectedPath] = useState("");
  const [showLabels, setShowLabels] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/repo-map?repo=${encodeURIComponent(repo)}`, { cache: "no-store" }).then((response) => response.json()).then((payload) => { if (!cancelled) onData(payload); });
    return () => { cancelled = true; };
  }, [onData, repo]);
  const files = data?.workingFiles ?? [];
  const folders = useMemo(() => [...new Set(files.map((file) => file.path.split("/").slice(0, -1).join("/")).filter(Boolean))].sort((left, right) => left.localeCompare(right)).filter((folder) => folder === "src" || folder.startsWith("src/")), [files]);
  const graph = useMemo(() => layoutRepoGraph(files, data?.workingAllEdges ?? [], scope, { width: 1000, height: 500 }) as RepoGraphLayout, [data?.workingAllEdges, files, scope]);
  const nodesByPath = useMemo(() => new Map(graph.nodes.map((node) => [node.path, node])), [graph.nodes]);
  const connectedPaths = useMemo(() => {
    const connected = new Set(selectedPath ? [selectedPath] : []);
    for (const edge of graph.edges) {
      if (edge.source === selectedPath) connected.add(edge.target);
      if (edge.target === selectedPath) connected.add(edge.source);
    }
    return connected;
  }, [graph.edges, selectedPath]);
  const selectScope = (nextScope: string) => { setScope(nextScope); setSelectedPath(""); };
  return <aside className="panel detail-repo-graph-panel"><div className="detail-repo-graph-head"><h2>Repo Graph</h2><div className="detail-repo-graph-controls"><select aria-label="Repo Graph folder" className="repo-map-scope" onChange={(event) => selectScope(event.target.value)} value={scope}>{folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></div><label className="repo-map-label-toggle"><input checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} type="checkbox" />Labels</label><div className="repo-map-meta">{graph.nodes.length} files · {graph.edges.length} links</div></div>{data?.available === false ? <p className="target-empty">Repo Graph unavailable.</p> : <svg aria-label={`Repository graph for ${scope}`} className="repo-map detail-repo-map proper-repo-graph" onClick={() => setSelectedPath("")} role="img" viewBox="0 0 1000 500">{graph.groups.map((group) => <g key={group.id}><circle className={`repo-folder-boundary ${group.dirty ? "dirty" : ""}`} cx={group.cx} cy={group.cy} r={group.r}><title>{group.id}: {group.count} files</title></circle><text className="repo-label repo-folder-label" textAnchor="middle" x={group.cx} y={group.cy + group.r + 18}>{group.label}</text></g>)}{graph.edges.map((edge, index) => { const source = nodesByPath.get(edge.source); const target = nodesByPath.get(edge.target); if (!source || !target) return null; const connected = selectedPath && (edge.source === selectedPath || edge.target === selectedPath); return <line className={`repo-edge-import ${connected ? "connected" : ""}`} key={`${edge.source}/${edge.target}/${index}`} x1={source.x} x2={target.x} y1={source.y} y2={target.y}><title>{edge.source} imports {edge.target}</title></line>; })}{graph.nodes.map((node) => { const selected = node.path === selectedPath; const connected = !selected && connectedPaths.has(node.path); const label = node.path.split("/").at(-1); return <g aria-label={node.path} key={node.path} onClick={(event) => { event.stopPropagation(); setSelectedPath(selected ? "" : node.path); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedPath(selected ? "" : node.path); } }} role="button" tabIndex={0}><title>{node.status ? `${node.status} ` : ""}{node.path}</title><circle className={`repo-node-file ${node.dirty ? "active" : ""} ${selected ? "selected" : connected ? "connected" : ""}`} cx={node.x} cy={node.y} r={node.r} style={{ "--repo-file-fill": node.color } as CSSProperties} />{node.recentlyEdited && <path className="repo-node-file-recent-symbol" d={`M ${node.x} ${node.y - 2.5} l 2.5 2.5 -2.5 2.5 -2.5 -2.5 Z`} />}{(showLabels || selected) && <text className="repo-file-label" textAnchor="middle" x={node.x} y={node.y + node.r + 14}>{label}</text>}</g>; })}</svg>}</aside>;
}

function Changes({ data }: { data: RepoMapData | null }) {
  const changed = (data?.workingFiles ?? []).filter((file) => file.dirty || file.active);
  return <section className="panel focused-functions-panel"><div className="focused-functions-head"><h2>Changes</h2><div className="focused-functions-meta">{changed.length} changed files</div></div><div className="focused-functions-list">{changed.length ? changed.map((file) => <article className="diff-file" key={file.path}><div className="diff-file-head"><span className="diff-file-icon">M</span><span className="diff-file-path">{file.path}</span><span className="diff-file-stats">{file.status || "modified"}</span></div></article>) : <p className="target-empty">No working tree changes.</p>}</div></section>;
}

export function ChecklistDashboard({ data }: { data: ChecklistProgressData }) {
  const [view, setView] = useState<"dashboard" | "changes">("dashboard");
  const [repoData, setRepoData] = useState<RepoMapData | null>(null);
  useEffect(() => {
    document.body.classList.add("driving-parity-view", "checklist-detail-view");
    return () => document.body.classList.remove("driving-parity-view", "checklist-detail-view");
  }, []);
  return <div className={`shell detail-view-shell driving-parity-view checklist-detail-shell ${view === "changes" ? "changes-tab-shell" : ""}`}><main className="detail-view" id="burnlist-detail"><section className="differential-overview checklist-overview"><div className="work-panel-head differential-overview-head checklist-overview-head"><nav aria-label="Burnlist detail view" className="label-toggle differential-tabs detail-tabs"><button aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}>Dashboard</button><span className="sep">·</span><button aria-pressed={view === "changes"} onClick={() => setView("changes")}>Changes</button></nav></div><ChecklistKpis data={data} /></section>{view === "changes" ? <div className="detail-workspace checklist-changes-workspace" data-detail-tab="changes"><Changes data={repoData} /></div> : <><div className="detail-workspace checklist-progress-workspace" data-detail-tab="dashboard"><div className="detail-report-column"><section className="top"><ProgressPanel data={data} /><WorkPanel data={data} /></section></div></div><RepoGraph data={repoData} onData={setRepoData} repo={data.repo} /></>}</main></div>;
}
