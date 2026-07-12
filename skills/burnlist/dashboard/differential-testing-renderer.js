import {
  renderDifferentialTestingFrameDeltaChart,
  renderDifferentialTestingProgressChart,
} from "./differential-testing-progress-chart.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function differentialSampleStateIsNonPass(sampleState) {
  return sampleState !== 0;
}

export function differentialPayloadRevision(payload) {
  return JSON.stringify(payload ?? null);
}

export function differentialRefreshStatusLabel(refresh, clientStatus = null) {
  if (clientStatus === "loading") return "Loading";
  if (clientStatus === "failed") return "Update failed";
  if (refresh?.status === "queued") return "Queued";
  if (refresh?.status === "running") return "Updating";
  if (refresh?.status === "failed") return "Update failed";
  return "";
}

export function differentialHistoryPoints(points) {
  return Array.isArray(points) ? points.slice() : [];
}

export function differentialProgressChartHistory(payload) {
  const points = differentialHistoryPoints(payload?.progress);
  const summaryFieldCount = Number(payload?.summary?.fields?.total) || 0;
  const summaryTickCount = Number(payload?.summary?.frames?.uniqueTicks) || 0;
  const lastValueByFrameCount = new Map();
  return points.map((point) => {
    const value = Math.max(0, Number(point.value) || 0);
    const fieldCount = Math.max(0, Number.isFinite(Number(point.fieldCount)) ? Number(point.fieldCount) : summaryFieldCount);
    const frames = Math.max(0, Number.isFinite(Number(point.frames)) ? Number(point.frames) : summaryTickCount);
    const previousValue = lastValueByFrameCount.get(frames);
    const activeComparablePoints = fieldCount * frames || Math.max(0, Number(payload?.summary?.frames?.total) || 0);
    const failedFields = Math.max(0, Number(point.failedFieldCount) || 0);
    const marker = previousValue === undefined
      ? ""
      : previousValue === 0 && value > 0
        ? "baseline"
        : point.result === "worsened" || value > previousValue
        ? "worsened"
        : point.result === "improved" || value < previousValue
          ? "improved"
          : point.result === "blocked"
            ? "reverted"
            : "unchanged";
    lastValueByFrameCount.set(frames, value);
    return {
      time: point.timestamp,
      percent: 0,
      done: 0,
      remaining: 0,
      total: 0,
      drivingParityGeneratedAt: point.timestamp,
      drivingParityFailedFieldPercent: fieldCount ? failedFields / fieldCount * 100 : 0,
      drivingParityFailedFields: failedFields,
      drivingParityAllFields: fieldCount,
      drivingParityFrames: frames,
      drivingParityFailedStatePointPercent: activeComparablePoints ? value / activeComparablePoints * 100 : 0,
      drivingParityStateFailures: value,
      drivingParityActiveComparablePoints: activeComparablePoints,
      drivingParityEventMarker: marker,
      drivingParityEventTitle: point.firstFailingLabel || String(point.result || ""),
    };
  });
}

export function differentialFrameDeltaMetrics(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const frameCount = fields.reduce((largest, field) => Math.max(largest, Array.isArray(field?.samples) ? field.samples.length : 0), 0);
  const failedByFrame = Array(frameCount).fill(0);
  const activeByFrame = Array(frameCount).fill(0);
  for (const field of fields) {
    const samples = Array.isArray(field?.samples) ? field.samples : [];
    for (let index = 0; index < samples.length; index += 1) {
      const state = Number(samples[index]?.[3]);
      if (!Number.isInteger(state) || state === 4) continue;
      activeByFrame[index] += 1;
      if (state !== 0) failedByFrame[index] += 1;
    }
  }
  const frameDeviationRatios = failedByFrame.map((failed, index) => activeByFrame[index] ? failed / activeByFrame[index] : 0);
  return {
    frameDeviationRatios,
    firstFailingFrame: failedByFrame.findIndex((failed) => failed > 0),
  };
}

export function differentialTelemetryFieldMap(payload) {
  if (payload?.telemetry?.status !== "comparable" || !Array.isArray(payload.telemetry.fields)) return new Map();
  return new Map(payload.telemetry.fields.map((field) => [field.id, field]));
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
      reason: exact.status === "complete" ? "Exact comparison is complete." : exact.blockers?.[0] || "Exact target authority is blocked.",
    };
  }
  const decision = exact.decision;
  if (decision?.kind !== "runtime-change" || !decision?.targetFieldId) {
    return { mode: "exact", status: "no-target", fieldId: null, label: null, reason: decision?.nextAction || "The checked exact session names no target." };
  }
  return { mode: "exact", status: "ready", fieldId: decision.targetFieldId, label: decision.targetLabel, reason: decision.nextAction };
}

export function mountDifferentialTestingDashboard(root, oven, payload, { onScenarioChange = () => {} } = {}) {
  const WIDTH = 900;
  const HEIGHT = 58;
  const GREEN = "#61d394";
  const RED = "#ef4444";
  const telemetryAvailability = differentialTelemetryAvailability(payload);
  const state = {
    chart: "delta",
    progressChart: "failed",
    sort: telemetryAvailability.status === "comparable" ? "changed" : "default",
    filter: "all",
    search: "",
    pageIndex: 0,
    pageSize: 25,
    expanded: new Set(),
    telemetryByField: differentialTelemetryFieldMap(payload),
    telemetryAvailability,
    clientRefreshStatus: null,
    pendingScenarioId: null,
    oven,
    payload,
  };
  let inputRenderTimer = 0;

  root.className = "shell driving-parity-view";

  function count(value) { return Number(value || 0).toLocaleString("en-US"); }
  function kpiTotal(value) {
    const number = Math.max(0, Number(value) || 0);
    return number >= 1e6 ? `${count(Math.floor(number / 1e3))}k` : count(number);
  }
  function percent(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number > 0 && number < .01) return "<0.01%";
    if (number > 0 && number < .1) return `${number.toFixed(2)}%`;
    return `${number.toFixed(1).replace(/\.0$/, "")}%`;
  }
  function value(value) {
    if (value === null || !Number.isFinite(Number(value))) return "n/a";
    const number = Number(value);
    if (Number.isInteger(number)) return count(number);
    return number.toFixed(Math.abs(number) < 0.1 ? 6 : 4);
  }
  function blockers(source) {
    return Array.isArray(source) ? source.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
  }
  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }
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
    const options = scenarios.map((scenario) => `<option value="${escapeHtml(scenario.id)}"${scenario.id === selected ? " selected" : ""}>${escapeHtml(scenario.label)}</option>`).join("");
    const status = differentialRefreshStatusLabel(state.payload.refresh, state.clientRefreshStatus);
    const statusTitle = state.payload.refresh?.status === "failed" ? state.payload.refresh.error || status : status;
    return `<span class="differential-scenario-control"><select id="differential-scenario-selector" aria-label="Differential Testing scenario"${scenarios.length < 2 ? " disabled" : ""}>${options}</select><span id="differential-refresh-status" class="differential-refresh-status ${escapeHtml(state.clientRefreshStatus || state.payload.refresh?.status || "")}" title="${escapeHtml(statusTitle)}"${status ? "" : " hidden"}>${escapeHtml(status)}</span></span>`;
  }
  function nonPass(field) { return Number(field.failedSampleCount || 0) + Number(field.missingSampleCount || 0); }
  function fieldResult(field) { return field.trustStatus === "blocked" || field.missingSampleCount > 0 ? "BLOCKED" : field.failedSampleCount > 0 ? "FAIL" : "PASS"; }
  function telemetryFor(field) { return state.telemetryByField.get(field.id) ?? null; }
  function telemetryChange(field) {
    const telemetry = telemetryFor(field);
    return telemetry ? Number(telemetry.failToPassCount || 0) + Number(telemetry.passToFailCount || 0) : 0;
  }
  function timeOnly(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
  }
  function dateTime(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
    }).format(date);
  }
  function formatLogRelativeMinutes(time, now = Date.now()) {
    const timestamp = new Date(time).getTime();
    const base = new Date(now).getTime();
    if (!Number.isFinite(timestamp) || !Number.isFinite(base)) return "";
    const minutes = Math.max(0, Math.floor((base - timestamp) / 60_000));
    return minutes === 0 ? "now" : minutes + "m";
  }
  function burnDonut(entries) {
    const groups = { improved: 0, worsened: 0, unchanged: 0, reverted: 0 };
    for (const entry of entries) {
      if (entry.result === "improved" || entry.result === "pass") groups.improved += 1;
      else if (entry.result === "worsened") groups.worsened += 1;
      else if (entry.result === "blocked" || entry.result === "reverted") groups.reverted += 1;
      else groups.unchanged += 1;
    }
    const active = Object.entries(groups).filter(([, amount]) => amount > 0).sort((left, right) => right[1] - left[1]);
    const total = active.reduce((sum, [, amount]) => sum + amount, 0);
    const gap = active.length > 1 ? (58 / 40) / (2 * Math.PI * 21) * 100 : 0;
    let offset = 0;
    const circles = active.map(([name, amount]) => {
      const share = amount / Math.max(1, total) * 100;
      const dash = Math.max(0, share - gap);
      const color = name === "unchanged" ? "neutral" : name;
      const circle = `<circle class="driving-parity-kpi-burns-donut-segment ${color}" cx="29" cy="29" r="21" pathLength="100" transform="rotate(-90 29 29)" stroke-dasharray="${dash.toFixed(3)} ${(100 - dash).toFixed(3)}" stroke-dashoffset="${(-(offset + gap / 2)).toFixed(3)}"/>`;
      offset += share;
      return circle;
    }).join("");
    const improvedPercent = total ? groups.improved / total * 100 : 0;
    return `<div class="driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-burns" title="Results across the current Differential Testing run"><svg class="driving-parity-kpi-gauge driving-parity-kpi-burns-donut" viewBox="0 0 58 58" aria-hidden="true"><circle class="driving-parity-kpi-burns-donut-track" cx="29" cy="29" r="21"${total ? ' opacity="0"' : ""}/>${circles}</svg><div class="driving-parity-kpi-text"><span class="driving-parity-kpi-heading">Results</span><span class="driving-parity-kpi-ratio driving-parity-kpi-burns-summary"><span class="neutral">${count(groups.unchanged)}</span><span class="separator">·</span><span class="reverted">${count(groups.reverted)}</span><span class="separator">·</span><span class="worsened">${count(groups.worsened)}</span><span class="separator">·</span><span class="improved">${count(groups.improved)} (${percent(improvedPercent)})</span></span></div></div>`;
  }
  function waffleMetric(metric, label) {
    const failed = Number(metric.failed || 0) + Number(metric.blocked || 0);
    const ratio = metric.total ? failed / metric.total : 0;
    const failedCells = Math.min(80, Math.round(ratio * 96));
    return `<div class="driving-parity-kpi-item driving-parity-kpi-section" title="${percent(ratio * 100)} failed ${escapeHtml(label.toLowerCase())}"><canvas class="driving-parity-kpi-waffle" aria-hidden="true" data-failed-cells="${failedCells}" data-empty="${metric.total ? "false" : "true"}"></canvas><div class="driving-parity-kpi-text"><span class="driving-parity-kpi-heading">${escapeHtml(label)}</span><span class="driving-parity-kpi-ratio"><span class="total">${kpiTotal(metric.total)}</span><span class="separator">·</span><span class="fail">${count(failed)} (${percent(ratio * 100)})</span></span></div></div>`;
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
  function compact(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(1)}m`;
    if (Math.abs(number) >= 1e3) return `${Math.round(number / 1e3)}k`;
    return String(Math.round(number));
  }
  function log(entries, now = Date.now()) {
    const deltaMode = state.progressChart === "delta";
    const rows = entries.slice(0, 10).map((entry) => {
      const delta = entry.delta === null || !Number.isFinite(Number(entry.delta)) ? null : Number(entry.delta);
      const stateClass = entry.result === "improved" || delta < 0 ? "improved" : entry.result === "worsened" || delta > 0 ? "worsened" : entry.result === "reverted" || entry.result === "blocked" ? "reverted" : "unchanged";
      const prior = delta === null ? null : Number(entry.value || 0) - delta;
      const deltaPercent = delta === null || !prior ? null : Math.abs(delta) / Math.abs(prior) * 100;
      const marker = stateClass === "improved" ? deltaMode ? "▲" : "▼" : stateClass === "worsened" ? deltaMode ? "▼" : "▲" : "⦁";
      const deltaText = deltaPercent === null ? "—" : percent(deltaPercent);
      const resultText = delta === null ? "—" : count(Math.abs(delta));
      const result = deltaMode && marker !== "⦁"
        ? `<span class="log-delta-content"><span class="log-delta-indicator">${marker}</span><span>${resultText}</span></span>`
        : resultText;
      const deltaCell = !deltaMode && marker
        ? `<span class="log-delta-content"><span>${deltaText}</span><span class="log-delta-indicator${marker === "⦁" ? " log-delta-dot" : ""}">${marker}</span></span>`
        : deltaText;
      const frame = entry.firstFailingTick === null || !Number.isFinite(Number(entry.firstFailingTick)) ? "—" : count(entry.firstFailingTick);
      const done = frame === "—" || !Number(entry.frames) ? "—" : `${Math.round(Math.max(0, Math.min(1, Number(entry.firstFailingTick) / Number(entry.frames))) * 100)}%`;
      return `<article class="log-row ${escapeHtml(stateClass)} no-detail log-table-row" title="${escapeHtml(entry.firstFailingLabel || "")}"><span class="log-table-cell age">${escapeHtml(formatLogRelativeMinutes(entry.timestamp, now))}</span><span class="log-table-cell failed ${escapeHtml(stateClass)}">${deltaMode ? frame : count(entry.value)}</span><span class="log-table-cell result ${escapeHtml(stateClass)}">${result}</span><span class="log-table-cell delta ${escapeHtml(stateClass)}">${deltaCell}</span>${deltaMode ? `<span class="log-table-cell done">${done}</span>` : ""}</article>`;
    }).join("");
    const columns = deltaMode ? ["Age", "Frame", "Result", "Delta", "Done"] : ["Age", "Value", "Result", "Delta"];
    return `<div class="checklist-log-list"><div class="checklist-log-table-header">${columns.map((column) => `<span>${column}</span>`).join("")}</div>${rows}</div>`;
  }
  function plotValue(raw, categories) {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "boolean") return raw ? 1 : 0;
    if (typeof raw === "string") { if (!categories.has(raw)) categories.set(raw, categories.size); return categories.get(raw); }
    return null;
  }
  function paths(points) {
    const result = [];
    let current = "";
    for (const point of points) {
      if (!point) { if (current) result.push(current); current = ""; continue; }
      current += `${current ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`;
    }
    if (current) result.push(current);
    return result;
  }
  function chart(field, showFrameLabels = false) {
    const categories = new Map();
    const rows = field.samples.map(([tick, reference, candidate, sampleState]) => ({ tick, reference: plotValue(reference, categories), candidate: plotValue(candidate, categories), state: sampleState }));
    const x = (index) => rows.length <= 1 ? 0 : index / (rows.length - 1) * WIDTH;
    const exactFailure = (index) => {
      const row = rows[index];
      if (!row) return false;
      return differentialSampleStateIsNonPass(row.state);
    };
    const intervalFails = (index) => exactFailure(index) || exactFailure(index + 1);
    const frameStep = (() => {
      if (rows.length <= 1) return 0;
      const raw = Math.max(1, rows.length / 10);
      const magnitude = 10 ** Math.floor(Math.log10(raw));
      for (const multiplier of [1, 2, 2.5, 5, 10]) {
        const step = Math.max(1, Math.round(multiplier * magnitude));
        if (step >= raw) return step;
      }
      return 1;
    })();
    const tickIndexes = [];
    for (let index = frameStep; index < rows.length - 1; index += frameStep * 2) tickIndexes.push(index);
    const tickMarks = tickIndexes.map((index) => `<line class="frame-tick" x1="${x(index).toFixed(1)}" x2="${x(index).toFixed(1)}" y1="${showFrameLabels ? 13 : 0}" y2="${HEIGHT}" stroke="rgba(168, 168, 168, 0.075)" stroke-width="1" vector-effect="non-scaling-stroke" shape-rendering="crispEdges"/>`).join("");
    const tickLabels = showFrameLabels
      ? tickIndexes.map((index) => `<span class="frame-tick-label" style="left:${(index / Math.max(1, rows.length - 1) * 100).toFixed(4)}%">${escapeHtml(Math.round(rows[index].tick))}</span>`).join("")
      : "";
    const segment = (start, end, trimStart = 0, trimEnd = 0) => {
      let [x1, y1] = start, [x2, y2] = end;
      const dx = x2 - x1, dy = y2 - y1, length = Math.max(Math.hypot(dx, dy), .000001);
      const first = Math.min(trimStart, length / 2), last = Math.min(trimEnd, length / 2);
      x1 += dx / length * first; y1 += dy / length * first;
      x2 -= dx / length * last; y2 -= dy / length * last;
      return { path: `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`, length: Math.hypot(x2 - x1, y2 - y1), x2, y2 };
    };
    const bands = (failed, points) => {
      const result = [];
      for (let index = 0; index < rows.length - 1; index += 1) {
        if (intervalFails(index) !== failed || !points[index] || !points[index + 1]) continue;
        const start = index;
        while (index + 1 < rows.length - 1 && intervalFails(index + 1) === failed && points[index + 1] && points[index + 2]) index += 1;
        result.push(`<rect x="${x(start).toFixed(1)}" y="0" width="${Math.max(1, x(index + 1) - x(start)).toFixed(1)}" height="${HEIGHT}" fill="${failed ? RED : GREEN}" opacity="${failed ? ".14" : ".10"}"/>`);
      }
      return result.join("");
    };
    if (state.chart === "delta") {
      const values = rows.map((row) => row.reference === null || row.candidate === null ? null : row.candidate - row.reference);
      const finite = values.filter(Number.isFinite);
      if (!finite.length) return '<div class="plot"></div>';
      const maxAbs = Math.max(.000001, ...finite.map((entry) => Math.abs(entry)));
      const limit = maxAbs + Math.max(maxAbs * .16, .000001);
      const y = (entry) => HEIGHT - (entry + limit) / (limit * 2) * HEIGHT;
      const points = values.map((entry, index) => entry === null ? null : [x(index), y(entry)]);
      const passed = [], failed = [];
      for (let index = 0; index < rows.length - 1; index += 1) {
        if (!points[index] || !points[index + 1]) continue;
        const isFailed = intervalFails(index);
        const line = segment(points[index], points[index + 1], !isFailed && index > 0 && intervalFails(index - 1) ? 1.2 : 0, !isFailed && index + 1 < rows.length - 1 && intervalFails(index + 1) ? 1.2 : 0).path;
        (isFailed ? failed : passed).push(line);
      }
      return `<div class="plot"><svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none">${bands(false, points)}${bands(true, points)}${tickMarks}<line x1="0" x2="${WIDTH}" y1="${y(0)}" y2="${y(0)}" stroke="${GREEN}" stroke-width="1.05" stroke-dasharray="5 4" opacity=".58" vector-effect="non-scaling-stroke"/>${passed.length ? `<path d="${passed.join(" ")}" fill="none" stroke="${GREEN}" stroke-width="1.55" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}${failed.length ? `<path d="${failed.join(" ")}" fill="none" stroke="${RED}" stroke-width="1.6" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}</svg>${tickLabels}</div>`;
    }
    const finite = rows.flatMap((row) => [row.reference, row.candidate]).filter(Number.isFinite);
    const min = Math.min(...finite, 0), max = Math.max(...finite, 0);
    const pad = Math.max((max - min) * .16, Math.abs(max || min || 1) * .03, .000001);
    const low = min - pad, high = max + pad, span = Math.max(high - low, .000001);
    const y = (entry) => HEIGHT - (entry - low) / span * HEIGHT;
    const reference = rows.map((row, index) => row.reference === null ? null : [x(index), y(row.reference)]);
    const candidate = rows.map((row, index) => row.candidate === null ? null : [x(index), y(row.candidate)]);
    const allMatch = !rows.some((_, index) => exactFailure(index));
    if (allMatch) {
      const match = paths(candidate).length ? paths(candidate) : paths(reference);
      return `<div class="plot"><svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none">${bands(false, candidate)}${tickMarks}${match.map((path) => `<path d="${path}" fill="none" stroke="${GREEN}" stroke-width="1.5" opacity=".8" vector-effect="non-scaling-stroke"/>`).join("")}</svg>${tickLabels}</div>`;
    }
    const candidatePassing = [], candidateFailing = [], referenceFailing = [];
    let referenceLength = 0;
    for (let index = 0; index < rows.length - 1; index += 1) {
      const failed = intervalFails(index);
      const trimStart = !failed && index > 0 && intervalFails(index - 1) ? 1.2 : 0;
      const trimEnd = !failed && index + 1 < rows.length - 1 && intervalFails(index + 1) ? 1.2 : 0;
      if (candidate[index] && candidate[index + 1]) (failed ? candidateFailing : candidatePassing).push(segment(candidate[index], candidate[index + 1], trimStart, trimEnd).path);
      if (failed && reference[index] && reference[index + 1]) {
        const line = segment(reference[index], reference[index + 1], trimStart, trimEnd);
        referenceFailing.push({ path: line.path, offset: -(referenceLength % 9) });
        referenceLength += line.length;
      }
    }
    return `<div class="plot"><svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none">${bands(false, candidate)}${bands(true, candidate)}${tickMarks}${candidatePassing.length ? `<path d="${candidatePassing.join(" ")}" fill="none" stroke="${GREEN}" stroke-width="1.5" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}${candidateFailing.length ? `<path d="${candidateFailing.join(" ")}" fill="none" stroke="${RED}" stroke-width="1.6" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}${referenceFailing.map((line) => `<path d="${line.path}" fill="none" stroke="${GREEN}" stroke-width="1.25" stroke-dasharray="5 4" stroke-dashoffset="${line.offset.toFixed(2)}" opacity=".8" vector-effect="non-scaling-stroke"/>`).join("")}</svg>${tickLabels}</div>`;
  }
  function hybridField(field) {
    const description = field.semantics?.meaning || field.driftReason || field.sourceOwner || "";
    const result = fieldResult(field);
    const segments = String(field.label || "").split(".");
    const label = segments.map((segment, index) => {
      const last = index === segments.length - 1;
      const className = last ? "hybrid-field-tail" : "hybrid-field-segment";
      const opacity = segments.length <= 1 ? 1 : .45 + .55 * Math.pow(index / (segments.length - 1), 1.8);
      return `<span class="${className}" style="opacity:${opacity.toFixed(2)}">${escapeHtml(segment)}${last ? "" : "."}</span>`;
    }).join("");
    return `<span class="hybrid-cell hybrid-field" title="${escapeHtml(description)}"><span class="table-field-label">${label}</span><span class="hybrid-status">${result}</span></span>`;
  }
  function hybridMetric(field) {
    const countValue = nonPass(field);
    const telemetry = telemetryFor(field);
    const frameDelta = telemetry ? Number(telemetry.passToFailCount || 0) - Number(telemetry.failToPassCount || 0) : null;
    const deltaClass = frameDelta === null || frameDelta === 0 ? "" : frameDelta < 0 ? "up" : "down";
    const deltaSymbol = frameDelta === null || frameDelta === 0 ? "" : frameDelta < 0 ? "▼" : "▲";
    const deltaValue = frameDelta === null ? "" : frameDelta === 0 ? "0" : compact(Math.abs(frameDelta));
    const transitionTitle = telemetry
      ? `${count(telemetry.failToPassCount)} fail-to-pass; ${count(telemetry.passToFailCount)} pass-to-fail; ${count(telemetry.stayedPassCount)} stayed-pass; ${count(telemetry.stayedFailCount)} stayed-fail; residual ${count(telemetry.residualCount)}`
      : "";
    const valueDelta = field.maxDelta === null || !Number.isFinite(Number(field.maxDelta))
      ? ""
      : value(field.maxDelta);
    return `<span class="hybrid-cell hybrid-metric"><span class="hybrid-count">${count(countValue)}</span><span class="hybrid-delta ${deltaClass}"${transitionTitle ? ` title="${escapeHtml(transitionTitle)}"` : ""}><span class="hybrid-delta-symbol">${deltaSymbol}</span><span class="hybrid-delta-value">${deltaValue}</span></span><span class="hybrid-value-delta">${escapeHtml(valueDelta)}</span></span>`;
  }
  function visibleFields() {
    if (state.sort === "changed" && state.telemetryAvailability.status !== "comparable") return [];
    const query = state.search.trim().toLowerCase();
    let filtered = state.payload.fields.filter((field) => {
      if (state.filter === "failing" && nonPass(field) === 0) return false;
      return !query || [field.label, field.sourceOwner, field.driftClass, field.semantics?.kind].some((entry) => String(entry || "").toLowerCase().includes(query));
    });
    if (state.sort === "changed") {
      filtered = filtered.filter((field) => telemetryChange(field) > 0);
    }
    return filtered.sort((left, right) => {
      if (state.sort === "changed") {
        const leftTelemetry = telemetryFor(left), rightTelemetry = telemetryFor(right);
        const leftImprovement = Number(leftTelemetry?.failToPassCount || 0) - Number(leftTelemetry?.passToFailCount || 0);
        const rightImprovement = Number(rightTelemetry?.failToPassCount || 0) - Number(rightTelemetry?.passToFailCount || 0);
        return telemetryChange(right) - telemetryChange(left)
          || rightImprovement - leftImprovement
          || state.payload.fields.indexOf(left) - state.payload.fields.indexOf(right);
      }
      return state.payload.fields.indexOf(left) - state.payload.fields.indexOf(right);
    });
  }
  function fieldRows(fields) {
    if (!fields.length) {
      const message = state.sort === "changed"
          ? state.telemetryAvailability.status === "comparable"
            ? "No changed fields in this telemetry."
            : state.telemetryAvailability.reason
          : "No fields match the current view.";
      return `<div class="empty">${escapeHtml(message)}</div>`;
    }
    return `<div class="hybrid-list">${fields.map((field, index) => {
      const expanded = state.expanded.has(field.id);
      return `<section class="hybrid-row ${nonPass(field) ? "fail" : "pass"}${expanded ? " expanded" : ""}" data-row-expand-key="${escapeHtml(field.id)}" role="button" tabindex="0" aria-expanded="${expanded}" title="${escapeHtml(field.label)}">${hybridField(field)}${hybridMetric(field)}<div class="hybrid-chart">${chart(field, index === 0)}</div></section>`;
    }).join("")}</div>`;
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
    if (state.progressChart === "delta") {
      renderDifferentialTestingFrameDeltaChart(progressChart, differentialFrameDeltaMetrics(state.payload));
      return;
    }
    renderDifferentialTestingProgressChart(
      progressChart,
      differentialProgressChartHistory(state.payload),
      { mode: "failed", timeScale: "compact" },
    );
  }
  function templateHtml() {
    return `  <main id="burnlist-detail" class="detail-view" hidden>
    <section class="driving-parity-kpi-strip" id="driving-parity-kpi-strip" aria-label="Differential Testing field KPIs" hidden></section>
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
                <div class="label-toggle progress-chart-toggle" aria-label="Burnlist progress chart view">
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
	        <div id="driving-parity-chart-toggle" class="chart-toggle" role="group" aria-label="Differential Testing chart mode">
	          <button type="button" data-driving-parity-chart="current" aria-label="Value chart view" title="Value chart view" aria-pressed="false">Value</button>
	          <span class="sep" aria-hidden="true">·</span>
	          <button type="button" data-driving-parity-chart="delta" aria-label="Delta chart view" title="Delta chart view" aria-pressed="true">Delta</button>
	        </div>
	        <span class="control-sep" aria-hidden="true">|</span>
	        <div id="driving-parity-sort-toggle" class="chart-toggle sort-toggle" role="group" aria-label="Differential Testing sort">
	          <button type="button" data-driving-parity-sort="improved" aria-pressed="true">Changed</button>
        </div>
        <span class="control-sep" aria-hidden="true">|</span>
	        <div id="driving-parity-filter-toggle" class="chart-toggle filter-toggle" role="group" aria-label="Differential Testing field filter">
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
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      padding: 14px 18px;
      background: rgba(5, 5, 5, 0.96);
      border-bottom: 1px solid var(--line);
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
  function render() {
    if (!state.oven || !state.payload) return;
    const cells = new Map(state.oven.detail.cells.map((cell) => [cell.id, cell]));
    const title = cells.get("title"), burns = cells.get("burns"), fields = cells.get("fields"), frames = cells.get("frames"), progressCell = cells.get("progress"), logCell = cells.get("log"), details = cells.get("field-details");
    if (![title, burns, fields, frames, progressCell, logCell, details].every(Boolean)) { root.innerHTML = '<div class="empty">Differential Testing Oven layout is incomplete.</div>'; return; }
    const titleText = String(state.payload.title || title.title || "Differential Testing");
    if (state.payload.scenarioCatalog?.selectedScenarioId === null && state.payload.scenarioCatalog?.scenarios?.length === 0) {
      root.innerHTML = `<main class="differential-testing-empty-state"><div class="driving-parity-kpi-title-item"><span class="driving-parity-kpi-title">${escapeHtml(titleText)}</span><span class="driving-parity-kpi-title-subtitle"><span class="differential-scenario-control"><select id="differential-scenario-selector" aria-label="Differential Testing scenario" disabled><option selected>No scenarios</option></select></span></span></div><div class="differential-testing-empty-message">No Differential Testing scenarios</div></main>`;
      return;
    }
    const visible = visibleFields();
    state.pageIndex = Math.max(0, Math.min(state.pageIndex, Math.max(0, Math.ceil(visible.length / state.pageSize) - 1)));
    const start = state.pageIndex * state.pageSize;
    const page = visible.slice(start, start + state.pageSize);
    const telemetrySummary = state.payload.telemetry?.status === "comparable"
      ? `${count(state.payload.telemetry.summary.failToPassCount)} F→P · ${count(state.payload.telemetry.summary.passToFailCount)} P→F · reconciled telemetry only`
      : "";
    const subtitleParts = [state.payload.subtitle, dateTime(state.payload.publishedAt), telemetrySummary, ...trustBlockerSummaries(state.payload)].filter(Boolean);
    const changedUnavailable = state.telemetryAvailability.status !== "comparable";
    const pageState = paginationState(visible.length);
    const pageOptions = [25, 50, 100, 200].map((size) => `<option value="${size}"${state.pageSize === size ? " selected" : ""}>${size}</option>`).join("");
    const paginationHtml = `<div id="driving-parity-pagination" class="driving-parity-controls driving-parity-pagination"${visible.length <= state.pageSize ? " hidden" : ""}><select id="driving-parity-page-size" aria-label="Differential Testing rows per page">${pageOptions}</select><button type="button" id="driving-parity-page-prev" aria-label="Differential Testing previous page"${state.pageIndex === 0 ? " disabled" : ""}>Prev</button><span class="page-status" id="driving-parity-page-status">${pageState.start}-${pageState.end} / ${visible.length}</span><button type="button" id="driving-parity-page-next" aria-label="Differential Testing next page"${state.pageIndex >= pageState.pageCount - 1 ? " disabled" : ""}>Next</button></div>`;
    const kpiHtml = `<div class="driving-parity-kpi-item driving-parity-kpi-title-item" title="${escapeHtml(subtitleParts.join(" · "))}"><span class="driving-parity-kpi-title">${escapeHtml(titleText)}</span><span class="driving-parity-kpi-title-subtitle">${scenarioSelector()}</span></div>${burnDonut(state.payload.log)}${waffleMetric(state.payload.summary.fields, "Fields")}${waffleMetric(state.payload.summary.frames, "Frames")}`;
    let html = templateHtml()
      .replace('<main id="burnlist-detail" class="detail-view" hidden>', '<main id="burnlist-detail" class="detail-view">')
      .replace('<section class="driving-parity-kpi-strip" id="driving-parity-kpi-strip" aria-label="Differential Testing field KPIs" hidden></section>', `<section class="driving-parity-kpi-strip has-burns" id="driving-parity-kpi-strip" aria-label="Differential Testing field KPIs">${kpiHtml}</section>`)
      .replace('<h2 id="progress-panel-title">Progress</h2>', '<h2 id="progress-panel-title">Parity Progress</h2>')
      .replace('<svg class="chart" id="progress-chart" viewBox="0 0 640 200" role="img" aria-label="Completion percentage over time"></svg>', progress(state.payload.progress))
      .replace('<div class="checklist-log" id="checklist-log"></div>', `<div class="checklist-log" id="checklist-log">${log(state.payload.log)}</div>`)
      .replace('<main id="driving-parity-page" class="driving-parity-page" hidden>', '<main id="driving-parity-page" class="driving-parity-page">')
      .replace('<h2 id="driving-parity-summary" class="driving-parity-summary" hidden></h2>', `<h2 id="driving-parity-summary" class="driving-parity-summary">Fields List<span class="field-list-count">(${count(state.payload.fields.length)})</span></h2>`)
      .replace('<div id="driving-parity-controls" class="driving-parity-controls" hidden>', '<div id="driving-parity-controls" class="driving-parity-controls">')
      .replace('data-driving-parity-chart="current" aria-label="Value chart view" title="Value chart view" aria-pressed="false"', `data-driving-parity-chart="current" aria-label="Value chart view" title="Value chart view" aria-pressed="${state.chart === "current"}"`)
      .replace('data-driving-parity-chart="delta" aria-label="Delta chart view" title="Delta chart view" aria-pressed="true"', `data-driving-parity-chart="delta" aria-label="Delta chart view" title="Delta chart view" aria-pressed="${state.chart === "delta"}"`)
      .replace('<button type="button" data-driving-parity-sort="improved" aria-pressed="true">Changed</button>', `<button type="button" data-driving-parity-sort="improved" aria-pressed="${state.sort === "changed"}"${changedUnavailable ? ` disabled title="${escapeHtml(state.telemetryAvailability.reason)}"` : ""}>Changed</button>`)
      .replace('<button type="button" data-driving-parity-filter="failing" aria-pressed="true">Failed</button>', `<button type="button" data-driving-parity-filter="failing" aria-pressed="${state.filter === "failing"}">Failed</button>`)
      .replace('<button type="button" data-progress-chart-mode="failed">', `<button type="button" data-progress-chart-mode="failed" aria-pressed="${state.progressChart === "failed"}">`)
      .replace('<button type="button" class="driving-parity-progress-only" data-progress-chart-mode="delta">', `<button type="button" class="driving-parity-progress-only" data-progress-chart-mode="delta" aria-pressed="${state.progressChart === "delta"}">`)
      .replace('<div class="rows-view" id="hybrid-rows"></div>', `<div class="rows-view" id="hybrid-rows">${fieldRows(page)}</div>`)
      .replace(/<div id="driving-parity-pagination" class="driving-parity-controls driving-parity-pagination" hidden>[\s\S]*?<\/div>\n  <\/main>/u, `${paginationHtml}\n  </main>`);
    root.innerHTML = html;
    paintWaffles();
    renderProgressChart();
    const search = root.querySelector("#driving-parity-field-search"), pageSize = root.querySelector("#driving-parity-page-size");
    search.value = state.search;
    if (pageSize) pageSize.value = String(state.pageSize);
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
      render();
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
    if (event.target.matches("#driving-parity-page-size")) { state.pageSize = Number(event.target.value) || 25; state.pageIndex = 0; }
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
      render();
      const input = root.querySelector("#driving-parity-field-search");
      input.focus();
      input.setSelectionRange(state.search.length, state.search.length);
    }, 0);
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
    update(nextOven, nextPayload) {
      state.oven = nextOven;
      state.payload = nextPayload;
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
  refreshMs = DIFFERENTIAL_TESTING_REFRESH_MS,
  onError = (error, hasDashboard) => {
    if (!hasDashboard) root.innerHTML = `<div class="empty">${escapeHtml(String(error?.message || error))}</div>`;
    else console.error("Could not refresh Differential Testing data.", error);
  },
} = {}) {
  let oven = null;
  let dashboard = null;
  let payloadRevision = "";
  let refreshInFlight = false;
  let refreshQueued = false;
  let scenarioGeneration = 0;
  let stopped = false;
  let activePayloadUrl = "";
  const payloadCache = new Map();
  let selectedScenarioId = (() => {
    try { return new URLSearchParams(locationImpl?.search || "").get("scenario") || ""; }
    catch { return ""; }
  })();

  const payloadUrl = (scenarioId) => scenarioId
    ? `/api/oven-data/differential-testing?scenario=${encodeURIComponent(scenarioId)}`
    : "/api/oven-data/differential-testing";

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
      payload: json.payload,
      etag: response.headers?.get?.("etag") || "",
      notModified: false,
    };
    payloadCache.set(url, result);
    return result;
  };

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
        oven ?? read("/api/ovens/differential-testing", "oven", "Could not load Differential Testing Oven."),
        readPayload(requestPayloadUrl),
      ]);
      if (stopped || requestGeneration !== scenarioGeneration) return;
      const payload = payloadResult.payload;
      if (payloadResult.notModified && dashboard && activePayloadUrl === requestPayloadUrl) {
        dashboard.setClientRefreshStatus?.(null);
        return;
      }
      const nextRevision = payloadResult.etag || differentialPayloadRevision(payload);
      oven = nextOven;
      if (!dashboard) dashboard = mount(root, oven, payload, { onScenarioChange: selectScenario });
      else if (nextRevision !== payloadRevision || activePayloadUrl !== requestPayloadUrl) dashboard.update(oven, payload);
      else dashboard.setClientRefreshStatus?.(null);
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
    try {
      const nextUrl = new URL(locationImpl?.href || "/ovens/differential-testing/view", "http://localhost");
      nextUrl.searchParams.set("scenario", scenarioId);
      historyImpl?.replaceState?.(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    } catch {}
    return refresh();
  };

  const ready = refresh();
  const timer = setIntervalImpl(refresh, refreshMs);
  return {
    ready,
    refresh,
    selectScenario,
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
