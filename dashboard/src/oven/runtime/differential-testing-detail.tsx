import type { ReactNode } from "react";

type DetailProps = {
  payload: Record<string, unknown>;
  progressMode: string;
  onProgressModeChange?: (mode: "progress" | "failed" | "delta") => void;
  refresh: ReactNode;
  kpis: ReactNode;
  chart: ReactNode;
  log: ReactNode;
};

function OverviewTime({ value }: { value: unknown }) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return <time id="differential-overview-time">{String(value ?? "")}</time>;
  const day = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
  return <time id="differential-overview-time" className="label-toggle differential-tabs" {...{ datetime: String(value) }}>
    <span>{day}</span><span className="sep" aria-hidden="true">·</span><span>{time}</span>
  </time>;
}

export function DifferentialTestingDetail({ payload, progressMode, onProgressModeChange, refresh, kpis, chart, log }: DetailProps) {
  const chartTitle = String(payload.primaryChartTitle || "Parity Progress");
  const historyTitle = String(payload.historyTitle || "Parity Progress");
  return <>
    <main id="burnlist-detail" className="detail-view">
      <section className="differential-overview" id="differential-overview">
        <div className="work-panel-head differential-overview-head">
          <div className="differential-overview-meta">{refresh}<OverviewTime value={payload.publishedAt} /></div>
        </div>
        {kpis}
      </section>
      <div className="detail-workspace" id="detail-workspace" data-detail-tab="dashboard">
        <div className="detail-report-column">
          <section className="top" id="detail-top-stack">
            <div className="panel progress-panel">
              <div className="panel-title-row">
                <div className="progress-title-group">
                  <h2 id="progress-panel-title">{chartTitle}</h2>
                  <span id="driving-parity-progress-summary" className="driving-parity-summary driving-parity-progress-summary" hidden />
                </div>
                <div className="chart-tools">
                  <div className="label-toggle progress-chart-toggle differential-tabs" aria-label="Burnlist progress chart view">
                    <button type="button" className="standard-progress-mode" data-progress-chart-mode="progress" onClick={() => onProgressModeChange?.("progress")}>Progress</button>
                    <span className="sep progress-chart-mode-sep standard-progress-sep" aria-hidden="true">|</span>
                    <button type="button" data-progress-chart-mode="failed" aria-pressed={progressMode === "failed"} onClick={() => onProgressModeChange?.("failed")}>
                      <span className="standard-failed-label">Failed</span><span className="driving-parity-progress-label">Value</span>
                    </button>
                    <span className="sep progress-chart-mode-sep driving-parity-progress-only" aria-hidden="true">·</span>
                    <button type="button" className="driving-parity-progress-only" data-progress-chart-mode="delta" aria-pressed={progressMode === "delta"} onClick={() => onProgressModeChange?.("delta")}>Delta</button>
                  </div>
                  <div className="label-toggle progress-time-scale-toggle" aria-label="Burn progress time scale">
                    <button type="button" data-progress-time-scale="all" title="Show elapsed time">All</button>
                    <span className="sep" aria-hidden="true">·</span>
                    <button type="button" data-progress-time-scale="compact" title="Compress inactive time">Compact</button>
                  </div>
                  <button type="button" className="chart-reset" id="chart-reset" hidden>Reset</button>
                </div>
              </div>
              <div className="score">
                <div className="progress-topline">
                  <div className="stat"><div className="stat-label">Tasks</div><div className="headline" id="progress-headline">0/0</div></div>
                  <div className="stat center" title="Elapsed wall-clock time since the first available tracker snapshot.">
                    <div className="stat-label">Elapsed</div><div className="elapsed" id="elapsed-time">--</div>
                  </div>
                  <div className="stat center" title="Average item pace from completed ledger intervals plus the current active item age as an in-progress sample. Uses B0 as the start anchor when present.">
                    <div className="stat-label">Pace</div><div className="pace" id="avg-pace">--</div>
                  </div>
                  <div className="stat right"><div className="stat-label">Done</div><div className="percent" id="progress-percent">0%</div></div>
                </div>
                <div className="warnings" id="warnings" hidden />
                <div className="bar" id="bar" aria-label="Burnlist completion segments" />
                <div className="chart-wrap">{chart}<div className="completion-confetti" id="completion-confetti" aria-hidden="true" /></div>
              </div>
            </div>
            <section className="panel work-panel" id="detail-work-panel" data-work-tab="log">
              <div className="work-panel-head">
                <div className="work-panel-title">{historyTitle}</div>
                <div className="label-toggle work-panel-tabs" aria-label="Burnlist work panel">
                  <button type="button" data-work-panel-tab="timeline">Timeline</button>
                  <span className="sep timeline-tab-sep" aria-hidden="true">|</span>
                  <button type="button" data-work-panel-tab="target">Target</button>
                  <span className="sep" aria-hidden="true">|</span>
                  <button type="button" data-work-panel-tab="log">Log</button>
                </div>
                <div className="work-panel-tools">
                  <div className="work-tab-tools timeline-tab-tools">
                    <div className="timeline-step" aria-label="Active item navigation">
                      <button type="button" data-timeline-step="-1">Prev</button><span className="sep" aria-hidden="true">|</span><button type="button" data-timeline-step="1">Next</button>
                    </div>
                    <div className="label-toggle timeline-controls" aria-label="Burnlist timeline view">
                      <button type="button" data-timeline-mode="all">All</button><span className="sep" aria-hidden="true">|</span><button type="button" data-timeline-mode="active">Active</button>
                    </div>
                  </div>
                  <div className="work-tab-tools target-tab-tools">
                    <label className="log-file-toggle" title="Run delayed code-change summaries and show them in Target."><input type="checkbox" id="target-summaries-toggle" /><span>Summaries</span></label>
                  </div>
                  <div className="work-tab-tools log-tab-tools">
                    <label className="log-file-toggle" title="Show file-created, file-changed, and file-deleted log rows."><input type="checkbox" id="log-file-changes-toggle" /><span>File changes</span></label>
                  </div>
                </div>
              </div>
              <div className="work-panel-body">
                <div className="work-tab-pane" data-work-tab-pane="timeline" hidden><div className="timeline" id="timeline" /></div>
                <div className="work-tab-pane" data-work-tab-pane="target" hidden><div className="target-panel" id="active-context-target" /></div>
                <div className="work-tab-pane" data-work-tab-pane="log"><div className="checklist-log" id="checklist-log">{log}</div></div>
              </div>
            </section>
          </section>
        </div>
        <aside className="panel detail-repo-graph-panel" id="detail-repo-graph-panel" hidden>
          <div className="detail-repo-graph-head">
            <h2>Repo Graph</h2>
            <div className="detail-repo-graph-controls"><select className="repo-map-scope" id="detail-repo-map-scope" aria-label="Detail repo graph folder focus" /></div>
            <select className="repo-map-zoom" id="detail-repo-map-zoom" aria-label="Detail repo graph zoom">
              <option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option>
            </select>
            <label className="repo-map-label-toggle" title="Show file-name labels for file bubbles"><input type="checkbox" className="repo-map-label-checkbox" id="detail-repo-map-labels" /> Labels</label>
            <div className="repo-map-meta" id="detail-repo-map-meta" />
          </div>
          <svg className="repo-map detail-repo-map" id="detail-repo-map" viewBox="0 0 1000 520" role="img" aria-label="Repository file graph focused on src" />
        </aside>
        <section className="panel focused-functions-panel" id="focused-functions-panel" hidden>
          <div className="focused-functions-head">
            <h2>Changes</h2>
            <div className="focused-functions-actions">
              <select className="changes-show" id="changes-show" aria-label="Changes shown"><option value="all">All</option><option value="10">Last 10</option><option value="30">Last 30</option></select>
              <button className="changes-collapse-all" id="changes-collapse-all" type="button">Collapse all</button>
              <div className="focused-functions-meta" id="focused-functions-meta" />
            </div>
          </div>
          <div className="focused-functions-list" id="focused-functions-list" />
        </section>
      </div>
    </main>
    <footer className="detail-meta-footer meta-row plan-meta-row" id="detail-meta-footer">
      <code id="detail-plan-label" /><span className="last-read-inline">Last read: <span id="detail-last-read">...</span></span>
    </footer>
  </>;
}
