import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

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

function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const resize = () => setWidth(Math.max(320, Math.round(ref.current?.clientWidth ?? 640)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function ProgressChart({ history, mode }: { history: HistoryPoint[]; mode: "done" | "burn" }) {
  const { ref, width } = useElementWidth();
  const height = 180;
  const plot = { left: 34, top: 14, right: width - 10, bottom: height - 24 };
  const points = history.length ? history : [{ time: new Date().toISOString(), done: 0, remaining: 0, total: 0, percent: 0 }];
  const values = points.map((point) => mode === "done" ? point.percent : 100 - point.percent);
  const x = (index: number) => plot.left + (index / Math.max(1, points.length - 1)) * (plot.right - plot.left);
  const y = (value: number) => plot.bottom - (value / 100) * (plot.bottom - plot.top);
  let path = `M ${x(0)} ${y(values[0])}`;
  for (let index = 1; index < points.length; index += 1) path += ` H ${x(index)} V ${y(values[index])}`;
  const area = `${path} L ${x(points.length - 1)} ${plot.bottom} L ${x(0)} ${plot.bottom} Z`;
  return (
    <div className="chart-wrap" ref={ref}>
      <svg aria-label={`${mode === "done" ? "Done" : "Burn"} percentage over time`} className="chart" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line className="grid-line" x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} /><text className="axis-label" x={plot.left - 7} y={y(tick) + 4}>{tick}</text></g>)}
        <path className="progress-area" d={area} />
        <path className="progress-line" d={path} />
        {points.map((point, index) => <circle className="progress-dot" cx={x(index)} cy={y(values[index])} key={`${point.time}/${index}`} r="3" />)}
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
        <h2>Progress</h2>
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
            <summary className="tile-summary" onClick={(event) => { event.preventDefault(); if (mode === "active") setActiveIndex(index); else setAllOpenIndex(index); }}><span className="tile-marker">{item.id}</span><strong className="tile-title">{item.title}</strong><em className="tile-status">{item.state === "current" ? "Active" : item.state === "done" ? "Done" : "Pending"}</em></summary>
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
  return <div className="checklist-log"><div className="checklist-log-list">{rows.map((item) => <article className="log-row done" key={`${item.id}/${item.completedAt}`}><div className="log-meta"><time className="log-time">{new Date(item.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span className="log-age">{relativeAge(item.completedAt, data.generatedAt)}</span><strong className="log-title">Completed {item.id}</strong></div><div className="log-detail"><div className="log-detail-line lead">{item.title}</div>{item.detail && <div className="log-detail-line">{item.detail}</div>}</div></article>)}{!rows.length && <p className="target-empty">No completed events yet.</p>}</div></div>;
}

function WorkPanel({ data }: { data: ChecklistProgressData }) {
  const [tab, setTab] = useState<"timeline" | "target" | "log">("timeline");
  return <section className="panel work-panel" data-work-tab={tab}><div className="work-panel-head"><div className="label-toggle work-panel-tabs"><button className={tab === "timeline" ? "selected" : ""} onClick={() => setTab("timeline")}>Timeline</button><span className="sep">·</span><button className={tab === "target" ? "selected" : ""} onClick={() => setTab("target")}>Target</button><span className="sep">·</span><button className={tab === "log" ? "selected" : ""} onClick={() => setTab("log")}>Log</button></div></div><div className="work-panel-body">{tab === "timeline" ? <Timeline data={data} /> : tab === "target" ? <Target data={data} /> : <Log data={data} />}</div></section>;
}

function fileColor(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (["ts", "tsx"].includes(extension ?? "")) return "#5aa2ff";
  if (["js", "mjs", "jsx"].includes(extension ?? "")) return "#cb9d4a";
  if (extension === "css") return "#c66ed8";
  if (extension === "json") return "#61d394";
  if (extension === "md") return "#a8a8a8";
  return "#657080";
}

function RepoGraph({ repo, data, onData }: { repo: string; data: RepoMapData | null; onData: (data: RepoMapData) => void }) {
  const [scope, setScope] = useState("src");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/repo-map?repo=${encodeURIComponent(repo)}`, { cache: "no-store" }).then((response) => response.json()).then((payload) => { if (!cancelled) onData(payload); });
    return () => { cancelled = true; };
  }, [onData, repo]);
  const files = data?.workingFiles ?? [];
  const folders = useMemo(() => [...new Set(files.map((file) => file.path.split("/").slice(0, -1).join("/")).filter(Boolean))].sort((left, right) => left.localeCompare(right)).filter((folder) => folder === "src" || folder.startsWith("src/")), [files]);
  const visible = files.filter((file) => scope ? file.path.startsWith(`${scope}/`) : true);
  const columns = Math.max(1, Math.ceil(Math.sqrt(visible.length * 1.8)));
  const positions = new Map(visible.map((file, index) => [file.path, { x: 28 + (index % columns) * (944 / Math.max(1, columns - 1)), y: 36 + Math.floor(index / columns) * (440 / Math.max(1, Math.ceil(visible.length / columns) - 1)) }]));
  const edges = (data?.workingAllEdges ?? []).filter((edge) => positions.has(edge.source) && positions.has(edge.target));
  return <aside className="panel detail-repo-graph-panel"><div className="detail-repo-graph-head"><h2>Repo Graph</h2><div className="detail-repo-graph-controls"><select aria-label="Repo Graph folder" className="repo-map-scope" onChange={(event) => setScope(event.target.value)} value={scope}>{folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></div><div className="repo-map-meta">{visible.length} files</div></div>{data?.available === false ? <p className="target-empty">Repo Graph unavailable.</p> : <svg aria-label={`Repository graph for ${scope}`} className="repo-map detail-repo-map" role="img" viewBox="0 0 1000 500">{edges.map((edge, index) => { const source = positions.get(edge.source)!; const target = positions.get(edge.target)!; return <line className="repo-edge-import" key={`${edge.source}/${edge.target}/${index}`} x1={source.x} x2={target.x} y1={source.y} y2={target.y} />; })}{visible.map((file) => { const position = positions.get(file.path)!; const radius = 3 + Math.min(7, Math.log10(Math.max(10, file.size))); return <g key={file.path}><title>{file.path}</title><circle className={`repo-node-file ${file.dirty ? "active" : ""}`} cx={position.x} cy={position.y} fill={fileColor(file.path)} r={radius} style={{ "--repo-file-fill": fileColor(file.path) } as CSSProperties} />{file.recentlyEdited && <path className="repo-node-file-recent-symbol" d={`M ${position.x} ${position.y - 2.5} l 2.5 2.5 -2.5 2.5 -2.5 -2.5 Z`} />}</g>; })}</svg>}</aside>;
}

function Changes({ data }: { data: RepoMapData | null }) {
  const changed = (data?.workingFiles ?? []).filter((file) => file.dirty || file.active);
  return <section className="panel focused-functions-panel"><div className="focused-functions-head"><h2>Changes</h2><div className="focused-functions-meta">{changed.length} changed files</div></div><div className="focused-functions-list">{changed.length ? changed.map((file) => <article className="diff-file" key={file.path}><div className="diff-file-head"><span className="diff-file-icon">M</span><strong className="diff-file-path">{file.path}</strong><span className="diff-file-stats">{file.status || "modified"}</span></div></article>) : <p className="target-empty">No working tree changes.</p>}</div></section>;
}

export function ChecklistDashboard({ data, backHref }: { data: ChecklistProgressData; backHref: string }) {
  const [view, setView] = useState<"dashboard" | "changes">("dashboard");
  const [repoData, setRepoData] = useState<RepoMapData | null>(null);
  return <div className={`shell detail-view-shell ${view === "changes" ? "changes-tab-shell" : ""}`}><header><div className="title-row"><h1>{data.title}</h1><a aria-label="Back to Burnlists" className="back-link visible" href={backHref}>⌂</a></div><nav className="detail-tabs"><button className={view === "dashboard" ? "selected" : ""} onClick={() => setView("dashboard")}>Dashboard</button><span className="sep">·</span><button className={view === "changes" ? "selected" : ""} onClick={() => setView("changes")}>Changes</button></nav><div className="meta-row plan-meta-row"><code>{data.repo}/{data.planLabel}</code><span className="last-read-inline">Last read: {new Date(data.generatedAt).toLocaleString()}</span></div></header><main className="detail-view">{view === "changes" ? <div className="detail-workspace" data-detail-tab="changes"><Changes data={repoData} /></div> : <div className="detail-workspace" data-detail-tab="dashboard"><div className="detail-report-column"><section className="top"><ProgressPanel data={data} /><WorkPanel data={data} /></section></div><RepoGraph data={repoData} onData={setRepoData} repo={data.repo} /></div>}</main><footer className="detail-meta-footer meta-row plan-meta-row"><code>{data.repo}/{data.planLabel}</code><span className="last-read-inline">Last read: {new Date(data.generatedAt).toLocaleString()}</span></footer></div>;
}
