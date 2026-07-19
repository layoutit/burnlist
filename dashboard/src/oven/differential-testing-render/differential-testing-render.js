const WIDTH = 900;
const HEIGHT = 58;
export const GREEN = "#61d394";
export const RED = "#ef4444";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function count(value) { return Number(value || 0).toLocaleString("en-US"); }
export function kpiTotal(value) {
  const number = Math.max(0, Number(value) || 0);
  return number >= 1e6 ? `${count(Math.floor(number / 1e3))}k` : count(number);
}
export function percent(value) {
  const number = Math.max(0, Number(value) || 0);
  if (number > 0 && number < .01) return "<0.01%";
  if (number > 0 && number < .1) return `${number.toFixed(2)}%`;
  return `${number.toFixed(1).replace(/\.0$/, "")}%`;
}
export function value(value) {
  if (value === null || !Number.isFinite(Number(value))) return "n/a";
  const number = Number(value);
  if (Number.isInteger(number)) return count(number);
  return number.toFixed(Math.abs(number) < 0.1 ? 6 : 4);
}
export function compact(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(1)}m`;
  if (Math.abs(number) >= 1e3) return `${Math.round(number / 1e3)}k`;
  return String(Math.round(number));
}
export function blockers(source) {
  return Array.isArray(source) ? source.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
}
export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function timeOnly(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}
export function dateTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
  }).format(date);
}
export function overviewTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return escapeHtml(timestamp);
  const day = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
  return `<span>${escapeHtml(day)}</span><span class="sep" aria-hidden="true">·</span><span>${escapeHtml(time)}</span>`;
}
export function formatLogRelativeMinutes(time, now = Date.now()) {
  const timestamp = new Date(time).getTime();
  const base = new Date(now).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(base)) return "";
  const minutes = Math.max(0, Math.floor((base - timestamp) / 60_000));
  return minutes === 0 ? "now" : minutes + "m";
}

export function kpiItem({ className, title, visual = "", heading, headingClass = "", value, valueClass = "" }) {
  const modifier = className ? ` ${className}` : "";
  const section = visual ? " driving-parity-kpi-section" : "";
  const labelClass = headingClass ? ` ${headingClass}` : "";
  const valueModifier = valueClass ? ` ${valueClass}` : "";
  const content = `<span class="driving-parity-kpi-heading${labelClass}">${escapeHtml(heading)}</span><span class="${visual ? "driving-parity-kpi-ratio" : "driving-parity-kpi-title-subtitle"}${valueModifier}">${value}</span>`;
  return `<div class="driving-parity-kpi-item${section}${modifier}" title="${escapeHtml(title)}">${visual}${visual ? `<div class="driving-parity-kpi-text">${content}</div>` : content}</div>`;
}
export function burnDonut(entries) {
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
  return kpiItem({
    className: "driving-parity-kpi-burns",
    title: "Results across the current Differential Testing run",
    visual: `<svg class="driving-parity-kpi-gauge driving-parity-kpi-burns-donut" viewBox="0 0 58 58" aria-hidden="true"><circle class="driving-parity-kpi-burns-donut-track" cx="29" cy="29" r="21"${total ? ' opacity="0"' : ""}/>${circles}</svg>`,
    heading: "Results",
    valueClass: "driving-parity-kpi-burns-summary",
    value: `<span class="neutral">${count(groups.unchanged)}</span><span class="separator">·</span><span class="reverted">${count(groups.reverted)}</span><span class="separator">·</span><span class="worsened">${count(groups.worsened)}</span><span class="separator">·</span><span class="improved">${count(groups.improved)} (${percent(improvedPercent)})</span>`,
  });
}
export function progressDonut(entries) {
  const latest = entries.at(-1);
  const total = Math.max(0, Number(latest?.frames) || 0);
  const done = Math.max(0, Math.min(total, Number(latest?.frame) || 0));
  const donePercent = total ? done / total * 100 : 0;
  const remainingPercent = Math.max(0, 100 - donePercent);
  return kpiItem({
    className: "driving-parity-kpi-progress",
    title: `${count(done)} of ${count(total)} exact-prefix frames cleared`,
    visual: `<svg class="driving-parity-kpi-gauge driving-parity-kpi-progress-donut" viewBox="0 0 58 58" aria-hidden="true"><circle class="driving-parity-kpi-progress-donut-track" cx="29" cy="29" r="21"/><circle class="driving-parity-kpi-progress-donut-segment" cx="29" cy="29" r="21" pathLength="100" transform="rotate(-90 29 29)" stroke-dasharray="${donePercent.toFixed(3)} ${remainingPercent.toFixed(3)}"/></svg>`,
    heading: "Progress",
    value: `<span class="fail">${count(total)}</span><span class="separator">·</span><span class="pass">${count(done)} (${percent(donePercent)})</span>`,
  });
}
export function waffleMetric(metric, label) {
  const failed = Number(metric.failed || 0) + Number(metric.blocked || 0);
  const ratio = metric.total ? failed / metric.total : 0;
  const failedCells = Math.min(80, Math.round(ratio * 96));
  return kpiItem({
    className: `driving-parity-kpi-${label.toLowerCase()}`,
    title: `${percent(ratio * 100)} failed ${label.toLowerCase()}`,
    visual: `<canvas class="driving-parity-kpi-waffle" aria-hidden="true" data-failed-cells="${failedCells}" data-empty="${metric.total ? "false" : "true"}"></canvas>`,
    heading: label,
    value: `<span class="total">${kpiTotal(metric.total)}</span><span class="separator">·</span><span class="fail">${kpiTotal(failed)} (${percent(ratio * 100)})</span>`,
  });
}

export function log(entries, now = Date.now()) {
  const visibleEntries = entries.slice(0, 8);
  const rows = visibleEntries.map((entry) => {
    const frameDelta = entry.frameDelta === null || !Number.isFinite(Number(entry.frameDelta)) ? null : Number(entry.frameDelta);
    const stateClass = frameDelta > 0 ? "improved" : frameDelta < 0 ? "worsened" : "unchanged";
    const deltaPercent = frameDelta === null || !Number(entry.frames) ? null : Math.abs(frameDelta) / Number(entry.frames) * 100;
    const marker = stateClass === "improved" ? "▲" : stateClass === "worsened" ? "▼" : "⦁";
    const deltaText = deltaPercent === null ? "—" : percent(deltaPercent);
    const resultText = frameDelta === null ? "—" : count(Math.abs(frameDelta));
    const result = marker !== "⦁"
      ? `<span class="log-delta-content"><span class="log-delta-indicator">${marker}</span><span>${resultText}</span></span>`
      : resultText;
    const frame = !Number.isSafeInteger(Number(entry.frame)) ? "—" : count(entry.frame);
    const done = !Number.isSafeInteger(Number(entry.frame)) || !Number(entry.frames) ? "—" : `${Math.round(Math.max(0, Math.min(1, Number(entry.frame) / Number(entry.frames))) * 100)}%`;
    return `<article class="log-row ${escapeHtml(stateClass)} no-detail log-table-row"><span class="log-table-cell age">${escapeHtml(formatLogRelativeMinutes(entry.timestamp, now))}</span><span class="log-table-cell failed ${escapeHtml(stateClass)}">${frame}</span><span class="log-table-cell result ${escapeHtml(stateClass)}">${result}</span><span class="log-table-cell delta ${escapeHtml(stateClass)}">${deltaText}</span><span class="log-table-cell done">${done}</span></article>`;
  }).join("");
  const placeholders = Array.from(
    { length: Math.max(0, 8 - visibleEntries.length) },
    () => '<article class="log-row no-detail log-table-row log-placeholder-row" aria-hidden="true"><span class="log-table-cell age">.</span><span class="log-table-cell">.</span><span class="log-table-cell">.</span><span class="log-table-cell">.</span><span class="log-table-cell">.</span></article>',
  ).join("");
  const columns = ["Age", "Frame", "Result", "Delta", "Done"];
  return `<div class="checklist-log-list"><div class="checklist-log-table-header">${columns.map((column) => `<span>${column}</span>`).join("")}</div>${rows}${placeholders}</div>`;
}
export function plotValue(raw, categories) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "string") { if (!categories.has(raw)) categories.set(raw, categories.size); return categories.get(raw); }
  return null;
}
export function paths(points) {
  const result = [];
  let current = "";
  for (const point of points) {
    if (!point) { if (current) result.push(current); current = ""; continue; }
    current += `${current ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`;
  }
  if (current) result.push(current);
  return result;
}

export function differentialSampleStateIsNonPass(sampleState) {
  return sampleState !== 0;
}

export function nonPass(field) { return Number(field.failedSampleCount || 0) + Number(field.missingSampleCount || 0); }
export function fieldResult(field) { return field.trustStatus === "blocked" || field.missingSampleCount > 0 ? "BLOCKED" : field.failedSampleCount > 0 ? "FAIL" : "PASS"; }

export function telemetryChange(field, telemetry) {
  return telemetry ? Number(telemetry.failToPassCount || 0) + Number(telemetry.passToFailCount || 0) : 0;
}

export function chart(field, showFrameLabels, chartMode) {
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
    ? tickIndexes.map((index) => `<span class="frame-tick-label" style="left:${(index / Math.max(1, rows.length - 1) * 100).toFixed(4)}%">${escapeHtml(field.sampleLabels?.[index] || Math.round(rows[index].tick))}</span>`).join("")
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
  if (chartMode === "delta") {
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
  let previousReferenceFailingIndex = -2;
  for (let index = 0; index < rows.length - 1; index += 1) {
    const failed = intervalFails(index);
    const trimStart = !failed && index > 0 && intervalFails(index - 1) ? 1.2 : 0;
    const trimEnd = !failed && index + 1 < rows.length - 1 && intervalFails(index + 1) ? 1.2 : 0;
    if (candidate[index] && candidate[index + 1]) (failed ? candidateFailing : candidatePassing).push(segment(candidate[index], candidate[index + 1], trimStart, trimEnd).path);
    if (failed && reference[index] && reference[index + 1]) {
      const line = segment(reference[index], reference[index + 1], trimStart, trimEnd);
      if (previousReferenceFailingIndex === index - 1) {
        referenceFailing.at(-1).path += `L${line.x2.toFixed(1)},${line.y2.toFixed(1)}`;
      } else {
        referenceFailing.push({ path: line.path, offset: -(referenceLength % 9) });
      }
      referenceLength += line.length;
      previousReferenceFailingIndex = index;
    } else {
      previousReferenceFailingIndex = -2;
    }
  }
  return `<div class="plot"><svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none">${bands(false, candidate)}${bands(true, candidate)}${tickMarks}${candidatePassing.length ? `<path d="${candidatePassing.join(" ")}" fill="none" stroke="${GREEN}" stroke-width="1.5" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}${candidateFailing.length ? `<path d="${candidateFailing.join(" ")}" fill="none" stroke="${RED}" stroke-width="1.6" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}${referenceFailing.map((line) => `<path d="${line.path}" fill="none" stroke="${GREEN}" stroke-width="1.25" stroke-dasharray="5 4" stroke-dashoffset="${line.offset.toFixed(2)}" opacity=".8" vector-effect="non-scaling-stroke"/>`).join("")}</svg>${tickLabels}</div>`;
}

export function hybridField(field) {
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

export function hybridMetric(field, telemetry) {
  const countValue = nonPass(field);
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

export function visibleFields(state, telemetryByField, fieldOrder) {
  if (state.fieldPage) return state.payload.fields;
  if (state.sort === "changed" && state.telemetryAvailability.status !== "comparable") return [];
  const query = state.search.trim().toLowerCase();
  let filtered = state.payload.fields.filter((field) => {
    if (state.filter === "failing" && nonPass(field) === 0) return false;
    return !query || [field.label, field.sourceOwner, field.driftClass, field.semantics?.kind].some((entry) => String(entry || "").toLowerCase().includes(query));
  });
  if (state.sort === "changed") {
    filtered = filtered.filter((field) => telemetryChange(field, telemetryByField.get(field.id)) > 0);
  }
  if (state.sort !== "changed") return filtered;
  return filtered.sort((left, right) => {
    const leftTelemetry = telemetryByField.get(left.id), rightTelemetry = telemetryByField.get(right.id);
    const leftImprovement = Number(leftTelemetry?.failToPassCount || 0) - Number(leftTelemetry?.passToFailCount || 0);
    const rightImprovement = Number(rightTelemetry?.failToPassCount || 0) - Number(rightTelemetry?.passToFailCount || 0);
    return telemetryChange(right, rightTelemetry) - telemetryChange(left, leftTelemetry)
      || rightImprovement - leftImprovement
      || (fieldOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (fieldOrder.get(right) ?? Number.MAX_SAFE_INTEGER);
  });
}

export function fieldRows(fields, { state, telemetryByField, chartMode }) {
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
    const telemetry = telemetryByField.get(field.id);
    return `<section class="hybrid-row ${nonPass(field) ? "fail" : "pass"}${expanded ? " expanded" : ""}" data-row-expand-key="${escapeHtml(field.id)}" role="button" tabindex="0" aria-expanded="${expanded}" title="${escapeHtml(field.label)}">${hybridField(field)}${hybridMetric(field, telemetry)}<div class="hybrid-chart">${chart(field, index === 0, chartMode)}</div></section>`;
  }).join("")}</div>`;
}
