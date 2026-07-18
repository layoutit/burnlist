import {
  renderDifferentialTestingFrameDeltaChart,
  renderDifferentialTestingProgressChart,
} from "./differential-testing-progress-chart.js";
import {
  escapeHtml,
  count,
  kpiTotal,
  percent,
  value,
  compact,
  blockers,
  unique,
  timeOnly,
  dateTime,
  overviewTime,
  formatLogRelativeMinutes,
  kpiItem,
  burnDonut,
  progressDonut,
  waffleMetric,
  log,
  chart,
  fieldRows,
  visibleFields,
  GREEN,
  RED,
} from "./differential-testing-render.js";
// The canonical minute age display remains: return minutes === 0 ? "now" : minutes + "m";

export { differentialSampleStateIsNonPass } from "./differential-testing-render.js";

export function differentialTestingLoadingMarkup() {
  const title = `<div class="driving-parity-kpi-item driving-parity-kpi-title-item">
      <span class="driving-parity-kpi-heading differential-scenario-heading">Scenario</span>
      <span class="driving-parity-kpi-title-subtitle"><span class="differential-scenario-control"><select aria-label="Differential Testing scenario" disabled><option selected>Loading scenario…</option></select></span></span>
    </div>`;
  const template = differentialTestingDashboardTemplateMarkup()
    .replace('<main id="burnlist-detail" class="detail-view" hidden>', '<main id="burnlist-detail" class="detail-view">')
    .replace('<section class="differential-overview" id="differential-overview" hidden>', '<section class="differential-overview" id="differential-overview">')
    .replace('<div class="driving-parity-kpi-strip" id="driving-parity-kpi-strip" aria-label="Differential Testing field KPIs"></div>', `<div class="driving-parity-kpi-strip" id="driving-parity-kpi-strip" aria-label="Differential Testing field KPIs">${title}</div>`)
    .replace('<h2 id="progress-panel-title">Progress</h2>', '<h2 id="progress-panel-title">Parity Progress</h2>')
    .replace('<button type="button" data-progress-chart-mode="failed">', '<button type="button" data-progress-chart-mode="failed" aria-pressed="false">')
    .replace('<button type="button" class="driving-parity-progress-only" data-progress-chart-mode="delta">', '<button type="button" class="driving-parity-progress-only" data-progress-chart-mode="delta" aria-pressed="true">')
    .replace('<main id="driving-parity-page" class="driving-parity-page" hidden>', '<main id="driving-parity-page" class="driving-parity-page">')
    .replace('<h2 id="driving-parity-summary" class="driving-parity-summary" hidden></h2>', '<h2 id="driving-parity-summary" class="driving-parity-summary">Fields List</h2>')
    .replace('<div id="driving-parity-controls" class="driving-parity-controls" hidden>', '<div id="driving-parity-controls" class="driving-parity-controls">');
  return `<div class="differential-testing-loading" aria-busy="true">
    <span class="differential-loading-sr" role="status">Loading Differential Testing</span>
    <div class="differential-testing-loading-visual" aria-hidden="true" inert>${template}</div>
  </div>`;
}

function differentialTestingDashboardTemplateMarkup() {
  return mountDifferentialTestingDashboard(null, null, null, { templateOnly: true });
}

export function differentialPayloadRevision(payload) {
  return JSON.stringify(payload ?? null);
}

export function differentialRefreshStatusLabel(refresh, clientStatus = null) {
  if (clientStatus === "loading") return "Loading";
  if (clientStatus === "queued") return "Queued";
  if (clientStatus === "running") return "Updating";
  if (clientStatus === "failed") return "Update failed";
  if (refresh?.status === "queued") return "Queued";
  if (refresh?.status === "running") return "Updating";
  if (refresh?.status === "failed") return "Update failed";
  return "";
}

export function differentialHistoryPoints(points) {
  return Array.isArray(points) ? points.slice() : [];
}

export function differentialProgressChartHistory(payload, { mode = "value" } = {}) {
  const points = differentialHistoryPoints(payload?.progress);
  return points.map((point) => {
    const total = Math.max(0, Number(point.frames) || 0);
    const rawValue = mode === "delta" ? point.frameDelta : point.frame;
    const value = rawValue === null || rawValue === undefined ? 0 : Math.max(0, Number(rawValue) || 0);
    return {
      time: point.timestamp,
      percent: total ? value / total * 100 : 0,
      done: value,
      remaining: Math.max(0, total - value),
      total,
    };
  });
}

export function differentialExactPrefixFrameDeltaMetrics(payload, metrics) {
  const ratios = metrics?.frameDeviationRatios;
  const latest = Array.isArray(payload?.progress) ? payload.progress.at(-1) : null;
  const clearedFrame = Number(latest?.frame);
  const frameCount = Number(latest?.frames);
  if (!Array.isArray(ratios) || !Number.isSafeInteger(clearedFrame) || !Number.isSafeInteger(frameCount)
    || frameCount !== ratios.length || clearedFrame < 0 || clearedFrame > frameCount
    || ratios.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) return null;
  return {
    ...metrics,
    frameDeviationRatios: ratios.map((value, frame) => frame < clearedFrame ? 0 : Number(value)),
    firstFailingFrame: clearedFrame < frameCount ? clearedFrame : -1,
  };
}

export function differentialTelemetryFieldMap(payload) {
  if (payload?.telemetry?.status !== "comparable" || !Array.isArray(payload.telemetry.fields)) return new Map();
  return new Map(payload.telemetry.fields.map((field) => [field.id, field]));
}

export function differentialPagedPayload(payload, fieldPage) {
  if (!fieldPage) return payload;
  const fields = Array.isArray(fieldPage.fields) ? fieldPage.fields : [];
  const next = { ...payload, fields };
  if (payload?.telemetry?.status === "comparable") {
    next.telemetry = {
      ...payload.telemetry,
      fields: Array.isArray(fieldPage.telemetryFields) ? fieldPage.telemetryFields : [],
    };
  }
  return next;
}

export function differentialTelemetryAvailability(payload) {
  const telemetry = payload?.telemetry;
  if (telemetry?.status === "comparable" && Array.isArray(telemetry.fields)) {
    return { status: "comparable", reason: "" };
  }
  if (telemetry?.status === "blocked") {
    return {
      status: "blocked",
      reason: Array.isArray(telemetry.blockers) && telemetry.blockers.length
        ? telemetry.blockers.join(" · ")
        : "Changed is unavailable because transition telemetry is blocked.",
    };
  }
  return {
    status: "unavailable",
    reason: "Changed is unavailable until comparable transition telemetry is published.",
  };
}

export function differentialExactTarget(payload) {
  const exact = payload?.exactSession;
  if (!exact) return { mode: "aggregate", status: "absent", fieldId: null, label: null, reason: "" };
  if (exact.strategy !== "exact-first") {
    return { mode: "exact", status: "blocked", fieldId: null, label: null, reason: "The published exact session has an invalid strategy." };
  }
  if (exact.status !== "ready") {
    return {
      mode: "exact",
      status: exact.status === "complete" ? "complete" : "blocked",
      fieldId: null,
      label: null,
      reason: exact.status === "complete"
        ? "Exact contract is complete; scenario PASS or FAIL is reported separately."
        : exact.blockers?.[0] || "Exact target authority is blocked.",
    };
  }
  const decision = exact.decision;
  if (decision?.kind !== "runtime-change" || !decision?.targetFieldId) {
    return { mode: "exact", status: "no-target", fieldId: null, label: null, reason: decision?.nextAction || "The checked exact session names no target." };
  }
  return { mode: "exact", status: "ready", fieldId: decision.targetFieldId, label: decision.targetLabel, reason: decision.nextAction };
}

export function mountDifferentialTestingDashboard(root, oven, payload, {
  onScenarioChange = () => {},
  onFieldViewChange = () => {},
  fieldPage = null,
  frameDeltaMetrics = null,
  initialChart = "delta",
  initialProgressChart = "delta",
  templateOnly = false,
} = {}) {
  if (templateOnly) return templateHtml();
  const telemetryAvailability = differentialTelemetryAvailability(payload);
  const state = {
    chart: initialChart === "current" ? "current" : "delta",
    progressChart: initialProgressChart,
    sort: fieldPage?.sort ?? (telemetryAvailability.status === "comparable" ? "changed" : "default"),
    filter: fieldPage?.filter ?? "all",
    search: fieldPage?.search ?? "",
    pageIndex: fieldPage?.page ?? 0,
    pageSize: fieldPage?.pageSize ?? 25,
    expanded: new Set(),
    telemetryByField: differentialTelemetryFieldMap(payload),
    telemetryAvailability,
    clientRefreshStatus: null,
    pendingScenarioId: null,
    oven,
    payload,
    fieldPage,
    frameDeltaMetrics,
  };
  let inputRenderTimer = 0;
  let fieldOrder = new Map(payload.fields.map((field, index) => [field, index]));

  root.className = "shell driving-parity-view";

  function trustBlockerSummaries(payload) {
    const result = [];
    const append = (label, status, entries) => {
      if (status !== "blocked") return;
      const reasons = blockers(entries);
      result.push(`${label} blocked${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
    };
    append("primary", payload?.trust?.status, payload?.trust?.blockers);
    append("telemetry", payload?.telemetry?.status, payload?.telemetry?.blockers);
    append("exact", payload?.exactSession?.status, payload?.exactSession?.blockers);
    return unique(result);
  }
  function scenarioSelector() {
    const catalog = state.payload.scenarioCatalog;
    const scenarios = Array.isArray(catalog?.scenarios) ? catalog.scenarios : [];
    const selected = state.pendingScenarioId || catalog?.selectedScenarioId || "";
    const options = scenarios.map((scenario) => `<option value="${escapeHtml(scenario.id)}"${scenario.id === selected ? " selected" : ""}>${escapeHtml(scenario.id)}</option>`).join("");
    return `<span class="differential-scenario-control"><select id="differential-scenario-selector" aria-label="Differential Testing scenario"${scenarios.length < 2 ? " disabled" : ""}>${options}</select></span>`;
  }
  function refreshStatus() {
    const status = differentialRefreshStatusLabel(state.payload.refresh, state.clientRefreshStatus);
    const statusTitle = state.payload.refresh?.status === "failed" ? state.payload.refresh.error || status : status;
    return `<span id="differential-refresh-status" class="differential-refresh-status ${escapeHtml(state.clientRefreshStatus || state.payload.refresh?.status || "")}" title="${escapeHtml(statusTitle)}"${status ? "" : " hidden"}>${escapeHtml(status)}</span>`;
  }
  function paintWaffles() {
    const scale = window.devicePixelRatio || 1;
    root.querySelectorAll("canvas.driving-parity-kpi-waffle").forEach((waffle) => {
      waffle.style.transform = "";
      const box = waffle.getBoundingClientRect();
      const dx = Math.round(box.x * scale) / scale - box.x;
      const dy = Math.round(box.y * scale) / scale - box.y;
      if (Math.abs(dx) > .001 || Math.abs(dy) > .001) waffle.style.transform = `translate(${dx.toFixed(3)}px, ${dy.toFixed(3)}px)`;
      const cssWidth = Math.max(1, Math.round(box.width));
      const cssHeight = Math.max(1, Math.round(box.height));
      const bitmapWidth = Math.max(1, Math.round(cssWidth * scale));
      const bitmapHeight = Math.max(1, Math.round(cssHeight * scale));
      if (waffle.width !== bitmapWidth) waffle.width = bitmapWidth;
      if (waffle.height !== bitmapHeight) waffle.height = bitmapHeight;
      const context = waffle.getContext("2d");
      if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
      const failedCells = Math.max(0, Math.min(80, Number(waffle.dataset.failedCells) || 0));
      const styles = getComputedStyle(document.documentElement);
      const passColor = styles.getPropertyValue("--driving-parity-kpi-green").trim() || GREEN;
      const failColor = styles.getPropertyValue("--driving-parity-kpi-red").trim() || RED;
      for (let index = 0; index < 80; index += 1) {
        const row = Math.floor(index / 10);
        const column = index % 10;
        const rightColumnRank = (9 - column) * 8 + (7 - row);
        const empty = waffle.dataset.empty === "true";
        context.globalAlpha = empty ? .2 : rightColumnRank < failedCells ? 1 : .34;
        context.fillStyle = empty ? "rgb(168,168,168)" : rightColumnRank < failedCells ? failColor : passColor;
        context.fillRect(Math.max(0, cssWidth - 39) + column * 4, Math.max(0, Math.floor((cssHeight - 31) / 2)) + row * 4, 3, 3);
      }
      context.globalAlpha = 1;
      context.setTransform(1, 0, 0, 1, 0, 0);
    });
  }
  function progress() {
    return `<svg class="chart" id="progress-chart" viewBox="0 0 640 200" role="img" aria-label="Completion percentage over time"></svg>`;
  }
  function paginationState(total) {
    const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
    state.pageIndex = Math.max(0, Math.min(state.pageIndex, pageCount - 1));
    const start = total ? state.pageIndex * state.pageSize + 1 : 0;
    const end = Math.min(total, (state.pageIndex + 1) * state.pageSize);
    return { pageCount, start, end };
  }
  function renderProgressChart() {
    const progressChart = root.querySelector("#progress-chart");
    if (!progressChart) return;
    if (state.payload.primaryChartField) return;
    if (state.progressChart === "delta") {
      const exactMetrics = differentialExactPrefixFrameDeltaMetrics(state.payload, state.frameDeltaMetrics);
      if (!exactMetrics) {
        progressChart.replaceChildren?.();
        progressChart.setAttribute?.("aria-label", "Exact-prefix frame delta metrics unavailable");
        return;
      }
      renderDifferentialTestingFrameDeltaChart(progressChart, exactMetrics);
      return;
    }
    renderDifferentialTestingProgressChart(
      progressChart,
      differentialProgressChartHistory(state.payload, { mode: "value" }),
      { mode: "progress", timeScale: "compact" },
    );
    progressChart.setAttribute?.("aria-label", "Cumulative cleared frames per report");
  }
  function templateHtml() {
    return `  <main id="burnlist-detail" class="detail-view" hidden>
    <section class="differential-overview" id="differential-overview" hidden>
      <div class="work-panel-head differential-overview-head"><div class="differential-overview-meta"><span id="differential-refresh-status" class="differential-refresh-status" hidden></span><time id="differential-overview-time"></time></div></div>
      <div class="driving-parity-kpi-strip" id="driving-parity-kpi-strip" aria-label="Differential Testing field KPIs"></div>
    </section>
    <div class="detail-workspace" id="detail-workspace" data-detail-tab="dashboard">
      <div class="detail-report-column">
        <section class="top" id="detail-top-stack">
          <div class="panel progress-panel">
            <div class="panel-title-row">
              <div class="progress-title-group">
                <h2 id="progress-panel-title">Progress</h2>
                <span id="driving-parity-progress-summary" class="driving-parity-summary driving-parity-progress-summary" hidden></span>
              </div>
              <div class="chart-tools">
                <div class="label-toggle progress-chart-toggle differential-tabs" aria-label="Burnlist progress chart view">
                  <button type="button" class="standard-progress-mode" data-progress-chart-mode="progress">Progress</button>
                  <span class="sep progress-chart-mode-sep standard-progress-sep" aria-hidden="true">|</span>
                  <button type="button" data-progress-chart-mode="failed"><span class="standard-failed-label">Failed</span><span class="driving-parity-progress-label">Value</span></button>
                  <span class="sep progress-chart-mode-sep driving-parity-progress-only" aria-hidden="true">·</span>
                  <button type="button" class="driving-parity-progress-only" data-progress-chart-mode="delta">Delta</button>
                </div>
                <div class="label-toggle progress-time-scale-toggle" aria-label="Burn progress time scale">
                  <button type="button" data-progress-time-scale="all" title="Show elapsed time">All</button>
                  <span class="sep" aria-hidden="true">·</span>
                  <button type="button" data-progress-time-scale="compact" title="Compress inactive time">Compact</button>
                </div>
                <button type="button" class="chart-reset" id="chart-reset" hidden>Reset</button>
              </div>
            </div>
            <div class="score">
              <div class="progress-topline">
                <div class="stat">
                  <div class="stat-label">Tasks</div>
                  <div class="headline" id="progress-headline">0/0</div>
                </div>
                <div class="stat center" title="Elapsed wall-clock time since the first available tracker snapshot.">
                  <div class="stat-label">Elapsed</div>
                  <div class="elapsed" id="elapsed-time">--</div>
                </div>
                <div class="stat center" title="Average item pace from completed ledger intervals plus the current active item age as an in-progress sample. Uses B0 as the start anchor when present.">
                  <div class="stat-label">Pace</div>
                  <div class="pace" id="avg-pace">--</div>
                </div>
                <div class="stat right">
                  <div class="stat-label">Done</div>
                  <div class="percent" id="progress-percent">0%</div>
                </div>
              </div>
              <div class="warnings" id="warnings" hidden></div>
              <div class="bar" id="bar" aria-label="Burnlist completion segments"></div>
              <div class="chart-wrap">
                <svg class="chart" id="progress-chart" viewBox="0 0 640 200" role="img" aria-label="Completion percentage over time"></svg>
                <div class="completion-confetti" id="completion-confetti" aria-hidden="true"></div>
              </div>
            </div>
          </div>
          <section class="panel work-panel" id="detail-work-panel" data-work-tab="log">
            <div class="work-panel-head">
              <div class="work-panel-title">Parity Progress</div>
              <div class="label-toggle work-panel-tabs" aria-label="Burnlist work panel">
                <button type="button" data-work-panel-tab="timeline">Timeline</button>
                <span class="sep timeline-tab-sep" aria-hidden="true">|</span>
                <button type="button" data-work-panel-tab="target">Target</button>
                <span class="sep" aria-hidden="true">|</span>
                <button type="button" data-work-panel-tab="log">Log</button>
              </div>
              <div class="work-panel-tools">
                <div class="work-tab-tools timeline-tab-tools">
                  <div class="timeline-step" aria-label="Active item navigation">
                    <button type="button" data-timeline-step="-1">Prev</button>
                    <span class="sep" aria-hidden="true">|</span>
                    <button type="button" data-timeline-step="1">Next</button>
                  </div>
                  <div class="label-toggle timeline-controls" aria-label="Burnlist timeline view">
                    <button type="button" data-timeline-mode="all">All</button>
                    <span class="sep" aria-hidden="true">|</span>
                    <button type="button" data-timeline-mode="active">Active</button>
                  </div>
                </div>
                <div class="work-tab-tools target-tab-tools">
                  <label class="log-file-toggle" title="Run delayed code-change summaries and show them in Target.">
                    <input type="checkbox" id="target-summaries-toggle" />
                    <span>Summaries</span>
                  </label>
                </div>
                <div class="work-tab-tools log-tab-tools">
                  <label class="log-file-toggle" title="Show file-created, file-changed, and file-deleted log rows.">
                    <input type="checkbox" id="log-file-changes-toggle" />
                    <span>File changes</span>
                  </label>
                </div>
              </div>
            </div>
            <div class="work-panel-body">
              <div class="work-tab-pane" data-work-tab-pane="timeline" hidden>
                <div class="timeline" id="timeline"></div>
              </div>
              <div class="work-tab-pane" data-work-tab-pane="target" hidden>
                <div class="target-panel" id="active-context-target"></div>
              </div>
              <div class="work-tab-pane" data-work-tab-pane="log">
                <div class="checklist-log" id="checklist-log"></div>
              </div>
            </div>
          </section>
        </section>
      </div>
      <aside class="panel detail-repo-graph-panel" id="detail-repo-graph-panel" hidden>
        <div class="detail-repo-graph-head">
          <h2>Repo Graph</h2>
          <div class="detail-repo-graph-controls">
            <select class="repo-map-scope" id="detail-repo-map-scope" aria-label="Detail repo graph folder focus"></select>
          </div>
          <select class="repo-map-zoom" id="detail-repo-map-zoom" aria-label="Detail repo graph zoom">
            <option value="1">1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <label class="repo-map-label-toggle" title="Show file-name labels for file bubbles">
            <input type="checkbox" class="repo-map-label-checkbox" id="detail-repo-map-labels">
            Labels
          </label>
          <div class="repo-map-meta" id="detail-repo-map-meta"></div>
        </div>
        <svg class="repo-map detail-repo-map" id="detail-repo-map" viewBox="0 0 1000 520" role="img" aria-label="Repository file graph focused on src"></svg>
      </aside>
      <section class="panel focused-functions-panel" id="focused-functions-panel" hidden>
        <div class="focused-functions-head">
          <h2>Changes</h2>
          <div class="focused-functions-actions">
            <select class="changes-show" id="changes-show" aria-label="Changes shown">
              <option value="all">All</option>
              <option value="10">Last 10</option>
              <option value="30">Last 30</option>
            </select>
            <button class="changes-collapse-all" id="changes-collapse-all" type="button">Collapse all</button>
            <div class="focused-functions-meta" id="focused-functions-meta"></div>
          </div>
        </div>
        <div class="focused-functions-list" id="focused-functions-list"></div>
      </section>
    </div>
  </main>
  <footer class="detail-meta-footer meta-row plan-meta-row" id="detail-meta-footer">
    <code id="detail-plan-label"></code>
    <span class="last-read-inline">Last read: <span id="detail-last-read">...</span></span>
  </footer>
  <main id="driving-parity-page" class="driving-parity-page" hidden>
    <div class="driving-parity-toolbar meta-row plan-meta-row">
      <h2 id="driving-parity-summary" class="driving-parity-summary" hidden></h2>
      <div id="driving-parity-controls" class="driving-parity-controls" hidden>
	        <input id="driving-parity-field-search" type="search" placeholder="Search Fields..." aria-label="Differential Testing search fields">
	        <span class="control-sep" aria-hidden="true">|</span>
	        <div id="driving-parity-chart-toggle" class="chart-toggle differential-tabs" role="group" aria-label="Differential Testing chart mode">
	          <button type="button" data-driving-parity-chart="current" aria-label="Value chart view" title="Value chart view" aria-pressed="false">Value</button>
	          <span class="sep" aria-hidden="true">·</span>
	          <button type="button" data-driving-parity-chart="delta" aria-label="Delta chart view" title="Delta chart view" aria-pressed="true">Delta</button>
	        </div>
	        <span class="control-sep" aria-hidden="true">|</span>
	        <div id="driving-parity-sort-toggle" class="chart-toggle sort-toggle differential-tabs" role="group" aria-label="Differential Testing sort">
	          <button type="button" data-driving-parity-sort="improved" aria-pressed="true">Changed</button>
        </div>
        <span class="control-sep" aria-hidden="true">|</span>
	        <div id="driving-parity-filter-toggle" class="chart-toggle filter-toggle differential-tabs" role="group" aria-label="Differential Testing field filter">
	          <button type="button" data-driving-parity-filter="failing" aria-pressed="true">Failed</button>
	        </div>
      </div>
    </div>
    <section class="driving-parity-inline-renderer" id="driving-parity-inline-renderer">
<style>.driving-parity-inline-renderer { min-width: 0; } .driving-parity-inline-renderer > main { min-width: 0; }</style>
<style>
    :root {
      color-scheme: dark;
      --bg: #000000;
      --panel: #111111;
      --card: #111111;
      --line: #262626;
      --muted: #a8a8a8;
      --text: var(--muted);
      --blue: #60a5fa;
      --yellow: #f6c95f;
      --red: #ef4444;
      --red-muted: rgba(239, 68, 68, 0.78);
      --green: #61d394;
      --dashboard-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: transparent;
      color: var(--text);
      font: 14px/1.45 var(--dashboard-font);
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    h1,
    strong {
      font-weight: 400;
    }
    .sub {
      color: var(--text);
      margin-top: 0;
      white-space: normal;
    }
    .sub .run-status {
      color: var(--red-muted);
    }
    .sub .run-status.pass {
      color: var(--text);
    }
    .sub .run-frames {
      color: var(--text);
    }
    .sub .metric-red {
      color: var(--red-muted);
    }
    .sub .metric-yellow {
      color: var(--text);
    }
    .sub .metric-blue {
      color: var(--text);
    }
    main {
      padding: 0;
    }
    .legend {
      display: none;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
      color: var(--muted);
      align-items: center;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      justify-content: end;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }
    .filter-control {
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
    }
    .accordion-actions {
      display: flex;
      gap: 6px;
    }
    .accordion-actions button {
      color: var(--muted);
    }
    .pagination {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--muted);
    }
    .pagination[hidden] {
      display: none;
    }
    .pagination-status {
      min-width: 78px;
      text-align: center;
      white-space: nowrap;
    }
    button {
      color: var(--text);
      background: #171717;
      border: 1px solid var(--line);
      border-radius: 1px;
      padding: 4px 7px;
      font: inherit;
      line-height: 1.2;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    button:not(:disabled):hover,
    select:hover {
      border-color: #333333;
      background: #1c1c1c;
    }
    select,
    input[type="search"] {
      color: var(--text);
      background: #171717;
      border: 1px solid var(--line);
      border-radius: 1px;
      padding: 4px 22px 4px 7px;
      font: inherit;
      line-height: 1.2;
    }
    select {
      color-scheme: dark;
      cursor: pointer;
    }
    select option {
      background: #111111;
      color: #e8e8e8;
    }
    input[type="search"] {
      width: 150px;
      padding-right: 7px;
    }
    #view-mode { width: 112px; }
    #sort-mode { width: 116px; }
    #field-filter { width: 158px; }
    #group-filter { width: 142px; }
    #page-size { width: 68px; }
    select:focus,
    input[type="search"]:focus {
      outline: none;
      border-color: var(--blue);
      background: #1c1c1c;
    }
    button[aria-pressed="true"] {
      border-color: var(--blue);
      background: #1c1c1c;
    }
    .rows {
      display: grid;
      gap: 0;
      background: transparent;
    }
    .rows-view {
      display: grid;
      gap: 0;
    }
    .rows-view[hidden] {
      display: none;
    }
    .row-group {
      display: grid;
      gap: 0;
    }
    .group-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      align-items: stretch;
    }
    .group-toggle {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      text-align: left;
      background: #171717;
      border-color: var(--line);
    }
    .group-toggle:hover,
    .group-toggle:focus {
      outline: none;
      border-color: #333333;
      background: #1c1c1c;
    }
    .group-action {
      color: var(--muted);
      white-space: nowrap;
    }
    .group-action:hover,
    .group-action:focus {
      outline: none;
      border-color: #333333;
      background: #1c1c1c;
    }
    .group-caret {
      width: 14px;
      color: var(--muted);
    }
    .group-caret::before {
      content: "v";
    }
    .row-group.collapsed .group-caret::before {
      content: ">";
    }
    .group-toggle strong {
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text);
      white-space: nowrap;
    }
    .group-toggle span:last-child {
      color: var(--muted);
      white-space: nowrap;
    }
    .group-body {
      display: grid;
      gap: 0;
    }
    .row-group.collapsed .group-body {
      display: none;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 1px;
    }
	    .field-table {
	      width: 100%;
	      border-collapse: collapse;
	      table-layout: fixed;
	      min-width: 760px;
	    }
	    .table-col-status { width: 74px; }
	    .table-col-fail { width: 78px; }
	    .table-col-delta { width: 74px; }
	    .table-col-chart { width: 340px; }
	    .field-table th,
	    .field-table td {
	      padding: 6px 10px;
	      border-bottom: 1px solid var(--line);
	      text-align: left;
	      vertical-align: middle;
	    }
	    .field-table tbody tr {
	      height: 36px;
	    }
	    .field-table tbody td {
	      padding-top: 0;
	      padding-bottom: 0;
	    }
	    .field-table th {
	      color: var(--muted);
	      font-weight: 400;
		      background: #171717;
	      position: sticky;
      top: 0;
      z-index: 1;
    }
    .field-table tbody tr:last-child td {
      border-bottom: 0;
    }
	    .field-table tbody tr:hover {
	      background: rgba(96, 165, 250, 0.055);
	    }
	    .table-status {
	      white-space: nowrap;
	      color: var(--muted);
	    }
	    .field-table tr.pass .table-status,
	    .table-good {
	      color: var(--green);
    }
    .field-table tr.fail .table-status,
    .table-bad {
      color: var(--red);
    }
	.hybrid-list {
	  display: grid;
	  gap: 0;
	  min-width: 760px;
	}
	.hybrid-row {
	  display: grid;
	  grid-template-columns: 20% 10% minmax(0, 70%);
	  align-items: stretch;
	  height: 90px;
	  content-visibility: auto;
	  contain-intrinsic-size: 90px;
	  margin-bottom: 6px;
	  background: var(--card);
	  border-radius: 8px;
	  overflow: hidden;
	  cursor: pointer;
	}
	.hybrid-row.expanded {
	  height: 220px;
	  contain-intrinsic-size: 220px;
	}
	.hybrid-row:focus-visible {
	  outline: 1px solid var(--blue);
	  outline-offset: -1px;
	}
	.hybrid-row:hover .hybrid-cell {
	  background: #1c1c1c;
	}
	.hybrid-row:last-child {
	  margin-bottom: 0;
	}
	.hybrid-cell {
	  min-width: 0;
	  display: flex;
	  align-items: center;
	  padding: 10px 12px;
	  color: var(--muted);
	  line-height: 1.25;
	}
	.hybrid-count,
	.hybrid-delta,
	.hybrid-value-delta {
	  white-space: nowrap;
	  font-variant-numeric: tabular-nums;
	}
	.hybrid-metric {
	  flex-direction: column;
	  align-items: flex-end;
	  justify-content: flex-start;
	  gap: 0;
	  padding-right: 17px;
	  color: rgba(210,216,224,.62);
	  text-align: right;
	}
	.hybrid-field {
	  display: grid;
	  grid-template-rows: minmax(0, 1fr) auto;
	  align-items: flex-start;
	  gap: 4px;
	  overflow: hidden;
	}
	.hybrid-field .table-field-label {
	  min-width: 0;
	  overflow: hidden;
	}
	.hybrid-field .table-field-label {
	  display: block;
	  width: 100%;
	  line-height: 1.25;
	  overflow-wrap: normal;
	  text-overflow: clip;
	  text-wrap: pretty;
	  word-break: normal;
	  white-space: normal;
	}
	.hybrid-field-segment,
	.hybrid-field-tail {
	  display: block;
	  width: 100%;
	  overflow: hidden;
	  text-overflow: ellipsis;
	  white-space: nowrap;
	}
	.hybrid-status {
	  flex: 0 0 auto;
	  font-size: 12px;
	  line-height: 1.25;
	}
	.hybrid-row.pass .hybrid-status { color: var(--green); }
	.hybrid-row.fail .hybrid-status { color: var(--red-muted); }
	.hybrid-count {
	  width: 100%;
	  text-align: right;
	}
	.hybrid-delta {
	  display: inline-flex;
	  align-items: center;
	  justify-content: flex-end;
	  gap: 6px;
	  width: 100%;
	}
	.hybrid-delta-symbol {
	  flex: 0 0 auto;
	  font-size: 13px;
	  line-height: 1;
	  transform: translateY(-1px);
	}
	.hybrid-value-delta {
	  width: 100%;
	  color: inherit;
	  text-align: right;
	}
	.hybrid-delta.up { color: var(--green); }
	.hybrid-delta.down { color: var(--red-muted); }
	.hybrid-chart {
	  min-width: 0;
	  height: 100%;
	  overflow: hidden;
	}
	.hybrid-chart > .plot,
	.hybrid-chart > svg {
	  width: 100%;
	  height: 100%;
	}
	@media (max-width: 520px) {
	  .hybrid-list {
	    min-width: 0;
	  }
	  .hybrid-row {
	    height: 180px;
	    contain-intrinsic-size: 180px;
	    grid-template-columns: minmax(0, 62%) minmax(88px, 38%);
	    grid-template-rows: 90px 90px;
	  }
	  .hybrid-row.expanded {
	    height: 260px;
	    contain-intrinsic-size: 260px;
	    grid-template-rows: 90px 170px;
	  }
	  .hybrid-cell {
	    padding: 8px 10px;
	  }
	  .hybrid-metric {
	    padding-right: 15px;
	  }
	  .hybrid-chart {
	    grid-column: 1 / -1;
	    grid-row: 2;
	  }
	}
	    .table-field {
	      color: var(--muted);
	      min-width: 0;
	    }
	    .table-field-inner {
	      display: flex;
	      align-items: baseline;
	      gap: 8px;
	      min-width: 0;
	    }
	    .table-group-tag {
	      flex: 0 0 auto;
	      max-width: 13ch;
	      overflow: hidden;
	      text-overflow: ellipsis;
	      white-space: nowrap;
	      color: var(--muted);
	    }
	    .table-field-label {
	      flex: 1 1 auto;
	      min-width: 0;
	      overflow: hidden;
	      text-overflow: ellipsis;
	      white-space: nowrap;
	      color: var(--muted);
	    }
	    .table-muted {
	      color: var(--muted);
	      white-space: nowrap;
	    }
	    .table-count,
	    .table-delta {
	      color: var(--muted);
	      text-align: right;
	      white-space: nowrap;
	      font-variant-numeric: tabular-nums;
	    }
	    .table-chart {
	      padding: 0;
	    }
	    .table-spark {
	      display: block;
	      width: 100%;
	      height: 36px;
	      min-height: 36px;
	      background: transparent;
	    }
	    .table-delta.up {
	      color: var(--green);
	    }
	    .table-delta.down {
	      color: var(--red);
	    }
    .coverage {
      display: grid;
      gap: 8px;
      margin-bottom: 12px;
      padding: 9px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 1px;
    }
    .coverage:empty {
      display: none;
    }
    .coverage strong {
      color: var(--text);
    }
    .coverage-groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
      gap: 6px;
    }
    .coverage-group {
      appearance: none;
      text-align: left;
      padding: 7px 8px;
      background: #171717;
      border: 1px solid var(--line);
      border-radius: 1px;
      color: var(--muted);
      cursor: pointer;
    }
    .coverage-group strong {
      display: block;
      margin-bottom: 3px;
    }
    .coverage-group span {
      color: var(--muted);
    }
    .coverage-group[aria-pressed="true"] {
      border-color: var(--red);
      background: #25131a;
    }
    .coverage-group:hover {
      border-color: #333333;
      background: #1c1c1c;
    }
    .coverage-group[aria-pressed="true"]:hover {
      border-color: var(--red);
      background: #25131a;
    }
    .row {
      --field-red: var(--red-muted);
      --field-green: rgba(97, 211, 148, 0.75);
      display: grid;
      grid-template-columns: 196px minmax(260px, 1fr);
      height: 98px;
      content-visibility: auto;
      contain-intrinsic-size: 98px;
      border: 0;
      background: #0f0f0f;
      border-radius: 0;
      overflow: hidden;
      cursor: pointer;
    }
    .row + .row {
      border-top: 0;
    }
    .row > .label {
      border-top: 1px solid rgba(168, 168, 168, 0.12);
    }
    .row > .plot {
      border-top: 1px solid rgba(232, 232, 232, 0.15);
    }
    .row.expanded {
      height: 220px;
      contain-intrinsic-size: 220px;
      cursor: pointer;
    }
    .row[data-row-expand-key]:hover {
      border-color: #333333;
    }
    .row[data-row-expand-key]:hover .label {
      background: #1c1c1c;
    }
    .row:focus-visible {
      outline: 1px solid var(--blue);
      outline-offset: 2px;
    }
    .label {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-rows: auto auto auto;
      align-items: start;
      align-content: start;
      gap: 4px;
      min-width: 0;
      min-height: 0;
      padding: 9px 10px 7px 0;
      border-right: 0;
      background: var(--card);
      overflow: hidden;
    }
    .label strong {
      display: block;
      width: 100%;
      max-width: 100%;
      min-height: 0;
      max-height: 1.25em;
      font-size: 14px;
      color: var(--text);
      margin: 0;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row.expanded .label strong {
      display: block;
    }
    .label span {
      display: block;
      color: var(--muted);
      line-height: 1.35;
      white-space: nowrap;
    }
    .label strong + span {
      margin-top: 1px;
    }
	    .label .improvement {
	      margin-top: 0;
	      color: var(--muted);
	      overflow: hidden;
	      text-overflow: ellipsis;
	    }
	    .label .improvement span {
	      display: inline;
	    }
	    .label .improvement .frame-delta.up {
	      color: var(--field-green);
	    }
	    .label .improvement .frame-delta.down {
	      color: var(--field-red);
	    }
	    .label .improvement .frame-delta.zero,
	    .label .improvement .delta-sep,
	    .label .improvement .value-delta {
	      color: var(--muted);
	    }
	    .row.pass .label > span {
	      color: var(--field-green);
	    }
	    .row.fail .label > span {
	      color: var(--field-red);
	    }
	    .row.pass .label .improvement .frame-delta.up,
	    .row.fail .label .improvement .frame-delta.up {
	      color: var(--field-green);
	    }
	    .row.pass .label .improvement .frame-delta.down,
	    .row.fail .label .improvement .frame-delta.down {
	      color: var(--field-red);
	    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 58px;
      background: transparent;
    }
    .plot {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 58px;
      overflow: hidden;
      background: #0f0f0f;
    }
    .row .plot > svg {
      background: #0f0f0f;
    }
    .frame-tick-label {
      position: absolute;
      top: 5px;
      color: rgba(168, 168, 168, 0.5);
      font-size: 12px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
      transform: translateX(-50%);
      user-select: none;
      white-space: nowrap;
    }
    .row.pass .plot {
      background: transparent;
    }
    .row.fail .plot {
      background: transparent;
    }
    .plot-marker {
      position: absolute;
      border-radius: 1px;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .row:not(.expanded) .plot-marker {
      display: none;
    }
    .plot-marker.browser {
      width: 5.4px;
      height: 5.4px;
      background: var(--blue);
    }
    .plot-marker.native {
      width: 5.2px;
      height: 5.2px;
      background: var(--green);
    }
    .plot-marker.match {
      width: 5.4px;
      height: 5.4px;
      background: var(--green);
    }
    .plot-marker.fail {
      width: 5.4px;
      height: 5.4px;
      background: var(--red);
    }
    .empty {
      padding: 18px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 1px;
      color: var(--muted);
    }
  </style>
  <main>
    <div class="legend">
      <div class="filters">
        <label class="filter-control">
          <select id="sort-mode" aria-label="sort cards">
            <option value="default">Default</option>
            <option value="improved" selected>Changed</option>
            <option value="target">Target</option>
            <option value="failing">Failing</option>
            <option value="frames">Frames</option>
            <option value="group">Group</option>
            <option value="name">Name</option>
            <option value="type">Type</option>
          </select>
        </label>
        <label class="filter-control">
          <select id="field-filter" aria-label="field filter">
            <option value="all">All</option>
            <option value="tested">Tested</option>
            <option value="failing">Failing</option>
            <option value="missing">Uncovered</option>
            <option value="nulls">Nulls</option>
            <option value="inactive">Inactive</option>
            <option value="materialized">Materialized</option>
          </select>
        </label>
        <label class="filter-control">
          <input type="search" id="field-search" aria-label="search fields" placeholder="Search fields">
        </label>
        <label class="filter-control">
          <select id="group-filter" aria-label="signal group filter">
            <option value="all">All groups</option>
          </select>
        </label>
        <label class="filter-control">
          <select id="page-size" aria-label="rows per page">
            <option value="25" selected>25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </label>
        <div class="pagination" id="pagination" hidden>
          <button type="button" id="page-prev" aria-label="previous page">Prev</button>
          <span class="pagination-status" id="page-status">0-0 / 0</span>
          <button type="button" id="page-next" aria-label="next page">Next</button>
        </div>
        <div class="accordion-actions">
          <button type="button" id="collapse-groups">Collapse all</button>
          <button type="button" id="expand-groups">Expand all</button>
        </div>
      </div>
    </div>
    <section class="coverage" id="coverage"></section>
    <div class="rows" id="rows">
      <div class="rows-view" id="hybrid-rows"></div>
    </div>
  </main>
    </section>
    <div id="driving-parity-pagination" class="driving-parity-controls driving-parity-pagination" hidden>
      <select id="driving-parity-page-size" aria-label="Differential Testing rows per page">
        <option value="25" selected>25</option>
        <option value="50">50</option>
        <option value="100">100</option>
        <option value="200">200</option>
      </select>
      <button type="button" id="driving-parity-page-prev" aria-label="Differential Testing previous page">Prev</button>
      <span class="page-status" id="driving-parity-page-status">0-0 / 0</span>
      <button type="button" id="driving-parity-page-next" aria-label="Differential Testing next page">Next</button>
    </div>
  </main>`;
  }
  function buildDashboardHtml() {
    const visible = visibleFields(state, state.telemetryByField, fieldOrder);
    const serverPage = state.fieldPage;
    if (!serverPage) {
      state.pageIndex = Math.max(0, Math.min(state.pageIndex, Math.max(0, Math.ceil(visible.length / state.pageSize) - 1)));
    }
    const start = state.pageIndex * state.pageSize;
    const page = serverPage ? visible : visible.slice(start, start + state.pageSize);
    const telemetrySummary = state.payload.telemetry?.status === "comparable"
      ? `${count(state.payload.telemetry.summary.failToPassCount)} F→P · ${count(state.payload.telemetry.summary.passToFailCount)} P→F · reconciled telemetry only`
      : "";
    const subtitleParts = [state.payload.subtitle, dateTime(state.payload.publishedAt), telemetrySummary, ...trustBlockerSummaries(state.payload)].filter(Boolean);
    const changedUnavailable = state.telemetryAvailability.status !== "comparable";
    const pageState = serverPage
      ? {
          pageCount: serverPage.pageCount,
          start: serverPage.total ? serverPage.page * serverPage.pageSize + 1 : 0,
          end: Math.min(serverPage.total, serverPage.page * serverPage.pageSize + visible.length),
        }
      : paginationState(visible.length);
    const visibleTotal = serverPage?.total ?? visible.length;
    const pageOptions = [25, 50, 100, 200].map((size) => `<option value="${size}"${state.pageSize === size ? " selected" : ""}>${size}</option>`).join("");
    const paginationHtml = `<div id="driving-parity-pagination" class="driving-parity-controls driving-parity-pagination"${visibleTotal <= state.pageSize ? " hidden" : ""}><select id="driving-parity-page-size" aria-label="Differential Testing rows per page">${pageOptions}</select><button type="button" id="driving-parity-page-prev" aria-label="Differential Testing previous page"${state.pageIndex === 0 ? " disabled" : ""}>Prev</button><span class="page-status" id="driving-parity-page-status">${pageState.start}-${pageState.end} / ${visibleTotal}</span><button type="button" id="driving-parity-page-next" aria-label="Differential Testing next page"${state.pageIndex >= pageState.pageCount - 1 ? " disabled" : ""}>Next</button></div>`;
    const scenarioKpi = kpiItem({
      className: "driving-parity-kpi-scenario",
      title: subtitleParts.join(" · "),
      visual: '<svg class="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
      heading: "Scenario",
      headingClass: "differential-scenario-heading",
      value: scenarioSelector(),
    });
    const kpiHtml = `${scenarioKpi}${progressDonut(state.payload.progress)}${burnDonut(state.payload.log)}${waffleMetric(state.payload.summary.fields, "Fields")}${waffleMetric(state.payload.summary.frames, "Frames")}`;
    const primaryChartField = state.payload.primaryChartField;
    const primaryChartTitle = String(state.payload.primaryChartTitle || "Parity Progress");
    const historyTitle = String(state.payload.historyTitle || "Parity Progress");
    const primaryChartMarkup = primaryChartField
      ? `<div class="chart hybrid-chart" id="progress-chart" role="img" aria-label="${escapeHtml(primaryChartTitle)} over time">${chart(primaryChartField, true, state.progressChart === "delta" ? "delta" : "value")}</div>`
      : progress(state.payload.progress);
    return templateHtml()
      .replace('<main id="burnlist-detail" class="detail-view" hidden>', '<main id="burnlist-detail" class="detail-view">')
      .replace('<section class="differential-overview" id="differential-overview" hidden>', '<section class="differential-overview" id="differential-overview">')
      .replace('<span id="differential-refresh-status" class="differential-refresh-status" hidden></span>', refreshStatus())
      .replace('<time id="differential-overview-time"></time>', `<time id="differential-overview-time" class="label-toggle differential-tabs" datetime="${escapeHtml(state.payload.publishedAt)}">${overviewTime(state.payload.publishedAt)}</time>`)
      .replace('<div class="driving-parity-kpi-strip" id="driving-parity-kpi-strip" aria-label="Differential Testing field KPIs"></div>', `<div class="driving-parity-kpi-strip has-burns" id="driving-parity-kpi-strip" aria-label="Differential Testing field KPIs">${kpiHtml}</div>`)
      .replace('<h2 id="progress-panel-title">Progress</h2>', `<h2 id="progress-panel-title">${escapeHtml(primaryChartTitle)}</h2>`)
      .replace('<svg class="chart" id="progress-chart" viewBox="0 0 640 200" role="img" aria-label="Completion percentage over time"></svg>', primaryChartMarkup)
      .replace('<div class="work-panel-title">Parity Progress</div>', `<div class="work-panel-title">${escapeHtml(historyTitle)}</div>`)
      .replace('<div class="checklist-log" id="checklist-log"></div>', `<div class="checklist-log" id="checklist-log">${log(state.payload.log)}</div>`)
      .replace('<main id="driving-parity-page" class="driving-parity-page" hidden>', '<main id="driving-parity-page" class="driving-parity-page">')
      .replace('<h2 id="driving-parity-summary" class="driving-parity-summary" hidden></h2>', `<h2 id="driving-parity-summary" class="driving-parity-summary">Fields List<span class="field-list-count">(${count(state.payload.summary?.fields?.total ?? state.payload.fields.length)})</span></h2>`)
      .replace('<div id="driving-parity-controls" class="driving-parity-controls" hidden>', '<div id="driving-parity-controls" class="driving-parity-controls">')
      .replace('data-driving-parity-chart="current" aria-label="Value chart view" title="Value chart view" aria-pressed="false"', `data-driving-parity-chart="current" aria-label="Value chart view" title="Value chart view" aria-pressed="${state.chart === "current"}"`)
      .replace('data-driving-parity-chart="delta" aria-label="Delta chart view" title="Delta chart view" aria-pressed="true"', `data-driving-parity-chart="delta" aria-label="Delta chart view" title="Delta chart view" aria-pressed="${state.chart === "delta"}"`)
      .replace('<button type="button" data-driving-parity-sort="improved" aria-pressed="true">Changed</button>', `<button type="button" data-driving-parity-sort="improved" aria-pressed="${state.sort === "changed"}"${changedUnavailable ? ` disabled title="${escapeHtml(state.telemetryAvailability.reason)}"` : ""}>Changed</button>`)
      .replace('<button type="button" data-driving-parity-filter="failing" aria-pressed="true">Failed</button>', `<button type="button" data-driving-parity-filter="failing" aria-pressed="${state.filter === "failing"}">Failed</button>`)
      .replace('<button type="button" data-progress-chart-mode="failed">', `<button type="button" data-progress-chart-mode="failed" aria-pressed="${state.progressChart === "failed"}">`)
      .replace('<button type="button" class="driving-parity-progress-only" data-progress-chart-mode="delta">', `<button type="button" class="driving-parity-progress-only" data-progress-chart-mode="delta" aria-pressed="${state.progressChart === "delta"}">`)
      .replace('<div class="rows-view" id="hybrid-rows"></div>', `<div class="rows-view" id="hybrid-rows">${fieldRows(page, { state, telemetryByField: state.telemetryByField, chartMode: state.chart })}</div>`)
      .replace(/<div id="driving-parity-pagination" class="driving-parity-controls driving-parity-pagination" hidden>[\s\S]*?<\/div>\n  <\/main>/u, `${paginationHtml}\n  </main>`);
  }
  function render() {
    const existingHeaderTimestamp = typeof document === "undefined" ? null : document.querySelector(".dashboard-primary-nav > #differential-overview-time");
    const existingHeaderStatus = typeof document === "undefined" ? null : document.querySelector(".dashboard-primary-nav > #differential-refresh-status");
    existingHeaderTimestamp?.remove();
    existingHeaderStatus?.remove();
    if (!state.oven || !state.payload) return;
    const cells = new Map(state.oven.detail.cells.map((cell) => [cell.id, cell]));
    const title = cells.get("title"), burns = cells.get("burns"), fields = cells.get("fields"), frames = cells.get("frames"), progressCell = cells.get("progress"), logCell = cells.get("log"), details = cells.get("field-details");
    if (![title, burns, fields, frames, progressCell, logCell, details].every(Boolean)) { root.innerHTML = '<div class="empty">Differential Testing Oven layout is incomplete.</div>'; return; }
    const titleText = String(title.title || state.oven.name || "Differential Testing");
    if (state.payload.scenarioCatalog?.selectedScenarioId === null && state.payload.scenarioCatalog?.scenarios?.length === 0) {
      root.innerHTML = `<main class="differential-testing-empty-state"><div class="driving-parity-kpi-title-item"><span class="driving-parity-kpi-title">${escapeHtml(titleText)}</span><span class="driving-parity-kpi-title-subtitle"><span class="differential-scenario-control"><select id="differential-scenario-selector" aria-label="Differential Testing scenario" disabled><option selected>No scenarios</option></select></span></span></div><div class="differential-testing-empty-message">No Differential Testing scenarios</div></main>`;
      return;
    }
    const html = buildDashboardHtml();
    root.innerHTML = html;
    const overviewTimestamp = root.querySelector("#differential-overview-time");
    const refreshStatusElement = root.querySelector("#differential-refresh-status");
    const dashboardNav = typeof document === "undefined" ? null : document.querySelector(".dashboard-primary-nav");
    if (dashboardNav) {
      if (refreshStatusElement) dashboardNav.append(refreshStatusElement);
      if (overviewTimestamp) dashboardNav.append(overviewTimestamp);
    }
    paintWaffles();
    renderProgressChart();
    const search = root.querySelector("#driving-parity-field-search"), pageSize = root.querySelector("#driving-parity-page-size");
    search.value = state.search;
    if (pageSize) pageSize.value = String(state.pageSize);
  }
  function requestFieldView({ refocusSearch = false } = {}) {
    if (!state.fieldPage) {
      render();
      if (refocusSearch) {
        const input = root.querySelector("#driving-parity-field-search");
        input?.focus?.();
        input?.setSelectionRange?.(state.search.length, state.search.length);
      }
      return;
    }
    state.clientRefreshStatus = "loading";
    render();
    if (refocusSearch) {
      const input = root.querySelector("#driving-parity-field-search");
      input?.focus?.();
      input?.setSelectionRange?.(state.search.length, state.search.length);
    }
    void onFieldViewChange({
      search: state.search,
      filter: state.filter,
      sort: state.sort,
      page: state.pageIndex,
      pageSize: state.pageSize,
    });
  }
  root.addEventListener("click", (event) => {
    const progressControl = event.target.closest("[data-progress-chart-mode]");
    const chartControl = event.target.closest("[data-driving-parity-chart]");
    const sortControl = event.target.closest("[data-driving-parity-sort]");
    const filterControl = event.target.closest("[data-driving-parity-filter]");
    const pageControl = event.target.closest("#driving-parity-page-prev, #driving-parity-page-next");
    if (progressControl || chartControl || sortControl || filterControl || pageControl) {
      if (progressControl) state.progressChart = progressControl.dataset.progressChartMode;
      if (chartControl) state.chart = chartControl.dataset.drivingParityChart;
      if (sortControl && state.telemetryAvailability.status === "comparable") state.sort = state.sort === "changed" ? "default" : "changed";
      if (filterControl) state.filter = state.filter === "failing" ? "all" : "failing";
      if (pageControl?.id === "driving-parity-page-prev") state.pageIndex = Math.max(0, state.pageIndex - 1);
      if (pageControl?.id === "driving-parity-page-next") state.pageIndex += 1;
      if (sortControl || filterControl) state.pageIndex = 0;
      if (sortControl || filterControl || pageControl) requestFieldView();
      else render();
      return;
    }
    const row = event.target.closest("[data-row-expand-key]");
    if (!row) return;
    const key = row.dataset.rowExpandKey;
    if (state.expanded.has(key)) state.expanded.delete(key);
    else state.expanded.add(key);
    render();
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches("#differential-scenario-selector")) {
      const scenarioId = String(event.target.value || "");
      if (scenarioId && scenarioId !== state.payload.scenarioCatalog?.selectedScenarioId) {
        state.clientRefreshStatus = "loading";
        state.pendingScenarioId = scenarioId;
        render();
        onScenarioChange(scenarioId);
      }
      return;
    }
    if (event.target.matches("#driving-parity-page-size")) {
      state.pageSize = Number(event.target.value) || 25;
      state.pageIndex = 0;
      requestFieldView();
      return;
    }
    render();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-row-expand-key]");
    if (!row) return;
    event.preventDefault();
    row.click();
  });
  root.addEventListener("input", (event) => {
    if (!event.target.matches("#driving-parity-field-search")) return;
    state.search = event.target.value;
    state.pageIndex = 0;
    window.clearTimeout(inputRenderTimer);
    inputRenderTimer = window.setTimeout(() => {
      requestFieldView({ refocusSearch: true });
    }, state.fieldPage ? 150 : 0);
  });
  render();
  let chartResizeFrame = 0;
  const scheduleProgressChartRender = () => {
    if (typeof window.requestAnimationFrame !== "function") return;
    if (chartResizeFrame && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(chartResizeFrame);
    chartResizeFrame = window.requestAnimationFrame(() => {
      chartResizeFrame = 0;
      renderProgressChart();
    });
  };
  const chartResizeObserver = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(scheduleProgressChartRender) : null;
  chartResizeObserver?.observe(root);
  window.addEventListener?.("resize", scheduleProgressChartRender);
  return {
    update(nextOven, nextPayload, { fieldPage: nextFieldPage = null, frameDeltaMetrics: nextFrameDeltaMetrics = null } = {}) {
      state.oven = nextOven;
      state.payload = nextPayload;
      state.fieldPage = nextFieldPage;
      state.frameDeltaMetrics = nextFrameDeltaMetrics;
      if (nextFieldPage) {
        state.search = nextFieldPage.search;
        state.filter = nextFieldPage.filter;
        state.sort = nextFieldPage.sort;
        state.pageIndex = nextFieldPage.page;
        state.pageSize = nextFieldPage.pageSize;
      }
      fieldOrder = new Map(nextPayload.fields.map((field, index) => [field, index]));
      state.clientRefreshStatus = null;
      state.pendingScenarioId = null;
      state.telemetryByField = differentialTelemetryFieldMap(nextPayload);
      state.telemetryAvailability = differentialTelemetryAvailability(nextPayload);
      if (state.sort === "changed" && state.telemetryAvailability.status !== "comparable") state.sort = "default";
      render();
    },
    setClientRefreshStatus(status) {
      state.clientRefreshStatus = status;
      if (status === null) state.pendingScenarioId = null;
      render();
    },
    destroy() {
      chartResizeObserver?.disconnect();
      window.removeEventListener?.("resize", scheduleProgressChartRender);
      if (chartResizeFrame && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(chartResizeFrame);
    },
  };
}

export const DIFFERENTIAL_TESTING_REFRESH_MS = 2000;

export function startDifferentialTestingLiveUpdates(root, {
  fetchImpl = globalThis.fetch,
  setIntervalImpl = globalThis.setInterval.bind(globalThis),
  clearIntervalImpl = globalThis.clearInterval.bind(globalThis),
  locationImpl = globalThis.location,
  historyImpl = globalThis.history,
  mount = mountDifferentialTestingDashboard,
  repoKey = null,
  dataOvenId = "differential-testing",
  adaptOven = (value) => value,
  adaptPayload = (value) => value,
  mountOptions = {},
  refreshMs = DIFFERENTIAL_TESTING_REFRESH_MS,
  onError = (error, hasDashboard) => {
    if (!hasDashboard) root.innerHTML = `<div class="empty">${escapeHtml(String(error?.message || error))}</div>`;
    else console.error("Could not refresh Differential Testing data.", error);
  },
} = {}) {
  root.innerHTML = differentialTestingLoadingMarkup();
  let oven = null;
  let dashboard = null;
  let payloadRevision = "";
  let refreshInFlight = false;
  let refreshQueued = false;
  let scenarioGeneration = 0;
  let stopped = false;
  let activePayloadUrl = "";
  let renderedPayloadHasReport = false;
  const payloadCache = new Map();
  let fieldViewQuery = null;
  let selectedScenarioId = (() => {
    try { return new URLSearchParams(locationImpl?.search || "").get("scenario") || ""; }
    catch { return ""; }
  })();

  const payloadUrl = (scenarioId) => {
    const searchParams = new URLSearchParams();
    if (scenarioId) searchParams.set("scenario", scenarioId);
    if (repoKey) searchParams.set("repoKey", repoKey);
    if (fieldViewQuery) {
      searchParams.set("search", fieldViewQuery.search);
      searchParams.set("filter", fieldViewQuery.filter);
      searchParams.set("sort", fieldViewQuery.sort);
      searchParams.set("page", String(fieldViewQuery.page));
      searchParams.set("pageSize", String(fieldViewQuery.pageSize));
    }
    const query = searchParams.toString();
    return `/api/oven-data/${encodeURIComponent(dataOvenId)}${query ? `?${query}` : ""}`;
  };

  const read = async (url, key, fallbackMessage) => {
    const response = await fetchImpl(url, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || fallbackMessage);
    return json[key];
  };

  const readPayload = async (url) => {
    const cached = payloadCache.get(url);
    const response = await fetchImpl(url, {
      cache: "no-store",
      ...(cached?.etag ? { headers: { "If-None-Match": cached.etag } } : {}),
    });
    if (response.status === 304) {
      if (!cached) throw new Error("Differential Testing data returned 304 before an initial payload was loaded.");
      return { ...cached, notModified: true };
    }
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Could not load Differential Testing data.");
    const result = {
      payload: differentialPagedPayload(adaptPayload(json.payload), json.fieldPage),
      transport: json.transport ?? null,
      fieldPage: json.fieldPage ?? null,
      frameDeltaMetrics: json.frameDeltaMetrics ?? null,
      etag: response.headers?.get?.("etag") || "",
      notModified: false,
    };
    payloadCache.set(url, result);
    return result;
  };

  const pendingRefreshStatus = (payload) => ["queued", "running"].includes(payload?.refresh?.status)
    ? payload.refresh.status
    : null;

  const refresh = async () => {
    if (stopped) return;
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }
    refreshInFlight = true;
    const requestGeneration = scenarioGeneration;
    const requestScenarioId = selectedScenarioId;
    const requestPayloadUrl = payloadUrl(requestScenarioId);
    try {
      const [nextOven, payloadResult] = await Promise.all([
        oven ?? read(`/api/ovens/${encodeURIComponent(dataOvenId)}`, "oven", `Could not load ${dataOvenId} Oven.`),
        readPayload(requestPayloadUrl),
      ]);
      if (stopped || requestGeneration !== scenarioGeneration) return;
      const payload = payloadResult.payload;
      if (payloadResult.notModified && dashboard && activePayloadUrl === requestPayloadUrl) {
        dashboard.setClientRefreshStatus?.(renderedPayloadHasReport ? pendingRefreshStatus(payload) : null);
        return;
      }
      const nextRevision = payloadResult.etag || differentialPayloadRevision(payload);
      oven = adaptOven(nextOven);
      if (!dashboard) {
        dashboard = mount(root, oven, payload, {
          ...mountOptions,
          onScenarioChange: selectScenario,
          onFieldViewChange: selectFieldView,
          fieldPage: payloadResult.fieldPage,
          frameDeltaMetrics: payloadResult.frameDeltaMetrics,
        });
        renderedPayloadHasReport = Boolean(payload?.refresh?.report);
      } else if (renderedPayloadHasReport && activePayloadUrl === requestPayloadUrl && pendingRefreshStatus(payload)) {
        dashboard.setClientRefreshStatus?.(pendingRefreshStatus(payload));
      } else if (nextRevision !== payloadRevision || activePayloadUrl !== requestPayloadUrl) {
        dashboard.update(oven, payload, {
          fieldPage: payloadResult.fieldPage,
          frameDeltaMetrics: payloadResult.frameDeltaMetrics,
        });
        renderedPayloadHasReport = Boolean(payload?.refresh?.report);
      } else dashboard.setClientRefreshStatus?.(null);
      payloadRevision = nextRevision;
      activePayloadUrl = requestPayloadUrl;
    } catch (error) {
      if (!stopped) {
        dashboard?.setClientRefreshStatus?.("failed");
        onError(error, Boolean(dashboard));
      }
    } finally {
      refreshInFlight = false;
      if (refreshQueued && !stopped) {
        refreshQueued = false;
        void refresh();
      }
    }
  };

  const selectScenario = (scenarioId) => {
    scenarioGeneration += 1;
    selectedScenarioId = scenarioId;
    fieldViewQuery = null;
    payloadCache.clear();
    try {
      const nextUrl = new URL(locationImpl?.href || "/ovens/differential-testing/view", "http://localhost");
      nextUrl.searchParams.set("scenario", scenarioId);
      historyImpl?.replaceState?.(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    } catch {}
    return refresh();
  };

  const selectFieldView = (query) => {
    scenarioGeneration += 1;
    payloadCache.clear();
    fieldViewQuery = {
      search: String(query?.search ?? ""),
      filter: query?.filter === "failing" ? "failing" : "all",
      sort: query?.sort === "changed" ? "changed" : "default",
      page: Math.max(0, Number.isSafeInteger(Number(query?.page)) ? Number(query.page) : 0),
      pageSize: [25, 50, 100, 200].includes(Number(query?.pageSize)) ? Number(query.pageSize) : 25,
    };
    return refresh();
  };

  const ready = refresh();
  const timer = setIntervalImpl(refresh, refreshMs);
  return {
    ready,
    refresh,
    selectScenario,
    selectFieldView,
    stop() {
      stopped = true;
      refreshQueued = false;
      clearIntervalImpl(timer);
      dashboard?.destroy?.();
    },
  };
}

const differentialRoot = typeof document === "undefined" || globalThis.location?.pathname !== "/ovens/differential-testing/view"
  ? null
  : document.querySelector(".shell.driving-parity-view");
if (differentialRoot) {
  document.body.classList.add("driving-parity-view");
  startDifferentialTestingLiveUpdates(differentialRoot);
}
