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
