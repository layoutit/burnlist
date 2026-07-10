(() => {
  const WIDTH = 960;
  const HEIGHT = 88;
  const GREEN = "#61d394";
  const RED = "#ff3b45";
  const GRID = "#282828";
  const state = { view: "cards", chart: "current", sort: "default", filter: "all", search: "", oven: null, payload: null };
  const root = document.querySelector("#compare-root");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function count(value) { return Number(value || 0).toLocaleString("en-US"); }
  function value(value) {
    if (value === null || !Number.isFinite(Number(value))) return "n/a";
    const number = Number(value);
    if (Number.isInteger(number)) return count(number);
    return number.toFixed(Math.abs(number) < 0.1 ? 6 : 4);
  }
  function nonPass(field) { return Number(field.failedSampleCount || 0) + Number(field.missingSampleCount || 0); }
  function fieldResult(field) { return field.trustStatus === "blocked" || field.missingSampleCount > 0 ? "BLOCKED" : field.failedSampleCount > 0 ? "FAIL" : "PASS"; }
  function timeOnly(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  }
  function age(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 60000));
    if (!Number.isFinite(minutes) || minutes < 1) return "now";
    if (minutes < 60) return `${minutes}min ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  }
  function cellStyle(cell, rowHeight) {
    return `grid-column:${cell.column}/span ${cell.columnSpan};grid-row:${cell.row}/span ${cell.rowSpan};min-height:${cell.rowSpan * rowHeight}px`;
  }
  function gauge(metric) {
    const ratio = metric.total ? metric.passed / metric.total : 0;
    const length = 69.12;
    const color = metric.failed || metric.blocked ? RED : GREEN;
    return `<svg aria-hidden="true" class="compare-gauge" viewBox="0 0 56 32"><path d="M6 28a22 22 0 0 1 44 0" fill="none" stroke="#244f3d" stroke-width="7"/><path d="M6 28a22 22 0 0 1 44 0" fill="none" pathLength="${length}" stroke="${color}" stroke-dasharray="${Math.max(0, length * (1 - ratio))} ${length}" stroke-dashoffset="${-length * ratio}" stroke-width="7"/></svg>`;
  }
  function metric(metric) {
    const nonPassed = Number(metric.failed || 0) + Number(metric.blocked || 0);
    return `<div class="compare-metric">${gauge(metric)}<div class="compare-metric-copy"><strong>${escapeHtml(metric.label)}</strong><span>${count(metric.total)} total / <b class="bad">${count(nonPassed)}</b> / <b class="good">${count(metric.passed)}</b></span></div></div>`;
  }
  function progress(points) {
    if (!points.length) return '<div class="compare-empty">No comparable history.</div>';
    const width = 560, height = 230, left = 8, right = 54, top = 18, bottom = 24;
    const values = points.map((point) => Math.max(0, Number(point.value) || 0));
    const max = Math.max(1, ...values);
    const x = (index) => left + index / Math.max(1, points.length - 1) * (width - left - right);
    const y = (entry) => top + (1 - entry / max) * (height - top - bottom);
    let path = `M${x(0)},${y(values[0])}`;
    for (let index = 1; index < values.length; index += 1) path += `H${x(index)}V${y(values[index])}`;
    const baseline = height - bottom;
    const latest = points.at(-1);
    const color = latest.value === 0 ? GREEN : RED;
    const grid = [0, .33, .66, 1].map((fraction) => { const lineY = top + fraction * (height - top - bottom); return `<line x1="${left}" x2="${width - right}" y1="${lineY}" y2="${lineY}" stroke="${GRID}"/>`; }).join("");
    return `<svg class="compare-progress" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${grid}<path d="${path}V${baseline}H${x(0)}Z" fill="${color}" opacity=".11"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${x(values.length - 1)}" cy="${y(values.at(-1))}" fill="${color}" r="4"/><text x="${width - right + 8}" y="${y(values.at(-1)) + 4}" fill="${color}">${count(latest.value)}</text><text x="${left}" y="${height - 5}" fill="#888">${escapeHtml(timeOnly(points[0].timestamp))}</text><text x="${width - right}" y="${height - 5}" fill="#888" text-anchor="end">${escapeHtml(timeOnly(latest.timestamp))}</text></svg>`;
  }
  function log(entries) {
    const rows = entries.slice(0, 8).map((entry) => `<div class="compare-log-row" title="${escapeHtml(entry.firstFailingLabel || "")}"><span>${escapeHtml(age(entry.timestamp))}</span><strong class="result ${escapeHtml(entry.result)}">${escapeHtml(entry.result)}</strong><span>${count(entry.value)}</span><span>${entry.delta === null ? "" : `${entry.delta > 0 ? "+" : ""}${count(entry.delta)}`}</span><time>${escapeHtml(timeOnly(entry.timestamp))}</time></div>`).join("");
    return `<div class="compare-log"><div class="compare-log-head"><span>Age</span><span>Result</span><span>Value</span><span>Delta</span><span>Timestamp</span></div>${rows}</div>`;
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
  function chart(field) {
    const categories = new Map();
    const rows = field.samples.map(([tick, reference, candidate, sampleState]) => ({ tick, reference: plotValue(reference, categories), candidate: plotValue(candidate, categories), state: sampleState }));
    const finite = state.chart === "delta"
      ? rows.map((row) => row.reference === null || row.candidate === null ? null : Math.abs(row.reference - row.candidate)).filter(Number.isFinite)
      : rows.flatMap((row) => [row.reference, row.candidate]).filter(Number.isFinite);
    const min = state.chart === "delta" ? 0 : Math.min(0, ...finite);
    const rawMax = Math.max(0, ...finite);
    const max = rawMax === min ? min + 1 : rawMax;
    const minTick = rows[0]?.tick || 0, maxTick = rows.at(-1)?.tick || minTick + 1;
    const x = (tick) => (tick - minTick) / Math.max(1, maxTick - minTick) * WIDTH;
    const y = (entry) => 8 + (1 - (entry - min) / (max - min)) * (HEIGHT - 16);
    const reference = state.chart === "current" ? rows.map((row) => row.reference === null ? null : [x(row.tick), y(row.reference)]) : [];
    const candidate = state.chart === "current" ? rows.map((row) => row.candidate === null ? null : [x(row.tick), y(row.candidate)]) : [];
    const delta = state.chart === "delta" ? rows.map((row) => row.reference === null || row.candidate === null ? null : [x(row.tick), y(Math.abs(row.reference - row.candidate))]) : [];
    const bands = [];
    for (let index = 0; index < rows.length; index += 1) { if (rows[index].state === 0) continue; const start = index; while (index + 1 < rows.length && rows[index + 1].state !== 0) index += 1; const x1 = x(rows[start].tick), x2 = x(rows[index].tick); bands.push(`<rect fill="${RED}" height="${HEIGHT}" opacity=".12" width="${Math.max(1, x2 - x1)}" x="${x1}"/>`); }
    const ticks = Array.from({ length: 6 }, (_, index) => minTick + (maxTick - minTick) * index / 5);
    return `<svg class="compare-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none">${ticks.map((tick) => `<line x1="${x(tick)}" x2="${x(tick)}" y2="${HEIGHT}" stroke="${GRID}"/>`).join("")}${bands.join("")}${state.chart === "delta" ? `<line x2="${WIDTH}" y1="${y(0)}" y2="${y(0)}" stroke="${GREEN}" stroke-dasharray="5 4"/>` : ""}${paths(reference).map((path) => `<path d="${path}" fill="none" opacity=".9" stroke="${GREEN}" stroke-dasharray="5 4" stroke-width="1.35" vector-effect="non-scaling-stroke"/>`).join("")}${paths(candidate).map((path) => `<path d="${path}" fill="none" opacity=".9" stroke="${nonPass(field) ? RED : GREEN}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join("")}${paths(delta).map((path) => `<path d="${path}" fill="none" opacity=".9" stroke="${nonPass(field) ? RED : GREEN}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join("")}${ticks.map((tick) => `<text fill="#777" font-size="8" text-anchor="middle" x="${x(tick)}" y="8">${Math.round(tick)}</text>`).join("")}</svg>`;
  }
  function label(field) {
    const description = field.semantics?.meaning || field.driftReason || field.sourceOwner || "";
    const result = fieldResult(field), countValue = nonPass(field);
    return `<div class="compare-label"><strong title="${escapeHtml(field.label)}">${escapeHtml(field.label)}</strong><b class="${countValue ? "bad" : "good"}">${countValue ? `${count(countValue)} ${result.toLowerCase()}` : result}</b><span title="${escapeHtml(description)}">${escapeHtml(description)}</span><small>${value(field.maxDelta)}</small></div>`;
  }
  function visibleFields() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.payload.fields.filter((field) => {
      if (state.filter === "failing" && nonPass(field) === 0) return false;
      if (state.filter === "passing" && nonPass(field) > 0) return false;
      return !query || [field.label, field.sourceOwner, field.driftClass].some((entry) => String(entry || "").toLowerCase().includes(query));
    });
    return filtered.sort((left, right) => {
      if (state.sort === "name") return left.label.localeCompare(right.label);
      if (state.sort === "failing") return nonPass(right) - nonPass(left) || left.label.localeCompare(right.label);
      if (state.sort === "drift") return String(left.driftClass).localeCompare(String(right.driftClass)) || left.label.localeCompare(right.label);
      return state.payload.fields.indexOf(left) - state.payload.fields.indexOf(right);
    });
  }
  function fieldRows(fields) {
    if (state.view === "table") return `<div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>Field</th><th>Status</th><th>Non-pass</th><th>Max delta</th><th>Trace</th></tr></thead><tbody>${fields.map((field) => `<tr><td>${escapeHtml(field.label)}</td><td class="${nonPass(field) ? "bad" : "good"}">${fieldResult(field)}</td><td>${count(nonPass(field))}</td><td>${value(field.maxDelta)}</td><td>${chart(field)}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="compare-rows">${fields.map((field) => `<div class="compare-row ${nonPass(field) ? "fail" : "pass"}">${label(field)}${chart(field)}</div>`).join("")}</div>`;
  }
  function controls() {
    const button = (id, pressed, title, svg) => `<button aria-label="${title}" aria-pressed="${pressed}" data-control="${id}" title="${title}">${svg}</button>`;
    const cards = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
    const table = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M3 14h18M9 4v16"/></svg>';
    const line = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 19h18M4 16l5-5 4 3 7-9"/></svg>';
    const delta = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3 3 20h18Z"/></svg>';
    return `<div class="compare-controls">${button("cards", state.view === "cards", "Cards view", cards)}${button("table", state.view === "table", "Table view", table)}${button("current", state.chart === "current", "Current traces", line)}${button("delta", state.chart === "delta", "Delta traces", delta)}<select aria-label="Sort fields" data-select="sort"><option value="default">Default</option><option value="failing">Failing</option><option value="name">Name</option><option value="drift">Drift</option></select><select aria-label="Filter fields" data-select="filter"><option value="all">All</option><option value="failing">Failing</option><option value="passing">Passing</option></select><input aria-label="Search fields" data-search placeholder="Search..." type="search"></div>`;
  }
  function render() {
    if (!state.oven || !state.payload) return;
    const cells = new Map(state.oven.detail.cells.map((cell) => [cell.id, cell]));
    const runs = cells.get("runs"), fields = cells.get("fields"), frames = cells.get("frames"), progressCell = cells.get("progress"), logCell = cells.get("log"), details = cells.get("field-details");
    if (![runs, fields, frames, progressCell, logCell, details].every(Boolean)) { root.innerHTML = '<div class="compare-error">Compare Oven layout is incomplete.</div>'; return; }
    const visible = visibleFields();
    const grid = `grid-template-columns:repeat(${state.oven.detail.columns},minmax(0,1fr));grid-auto-rows:${state.oven.detail.rowHeight}px`;
    const trustClass = state.payload.trust.status === "pass" ? "good" : "bad";
    const reportClass = state.payload.trust.reportStatus === "pass" ? "good" : "bad";
    root.innerHTML = `<div class="compare-page"><nav class="compare-nav"><a href="/">Burnlists</a><span>Compare</span></nav><header class="compare-header"><div><h1>${escapeHtml(state.payload.title)}</h1><p>${escapeHtml(state.payload.subtitle)}</p></div><div class="compare-status"><span class="${trustClass}">trust ${escapeHtml(state.payload.trust.status)}</span> / <span class="${reportClass}">report ${escapeHtml(state.payload.trust.reportStatus)}</span></div></header><div class="compare-grid" style="${grid}"><section class="compare-cell compare-metric-cell first" style="${cellStyle(runs, state.oven.detail.rowHeight)}">${metric(state.payload.summary.runs)}</section><section class="compare-cell compare-metric-cell" style="${cellStyle(fields, state.oven.detail.rowHeight)}">${metric(state.payload.summary.fields)}</section><section class="compare-cell compare-metric-cell last" style="${cellStyle(frames, state.oven.detail.rowHeight)}">${metric(state.payload.summary.frames)}</section><section class="compare-cell compare-panel" style="${cellStyle(progressCell, state.oven.detail.rowHeight)}"><h2>${escapeHtml(progressCell.title)}</h2>${progress(state.payload.progress)}</section><section class="compare-cell compare-panel" style="${cellStyle(logCell, state.oven.detail.rowHeight)}"><h2>${escapeHtml(logCell.title)}</h2>${log(state.payload.log)}</section><section class="compare-cell compare-fields-cell" style="${cellStyle(details, state.oven.detail.rowHeight)}"><div class="compare-toolbar"><h2>${escapeHtml(details.title)}</h2>${controls()}</div><div class="compare-summary">${count(visible.length)} / ${count(state.payload.fields.length)} fields · ${count(state.payload.summary.frames.uniqueTicks || 0)} aligned ticks · trust ${escapeHtml(state.payload.trust.status)}</div>${fieldRows(visible)}</section></div></div>`;
    const sort = root.querySelector('[data-select="sort"]'), filter = root.querySelector('[data-select="filter"]'), search = root.querySelector("[data-search]");
    sort.value = state.sort; filter.value = state.filter; search.value = state.search;
  }
  root.addEventListener("click", (event) => {
    const control = event.target.closest("[data-control]");
    if (!control) return;
    const value = control.dataset.control;
    if (value === "cards" || value === "table") state.view = value;
    if (value === "current" || value === "delta") state.chart = value;
    render();
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches('[data-select="sort"]')) state.sort = event.target.value;
    if (event.target.matches('[data-select="filter"]')) state.filter = event.target.value;
    render();
  });
  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-search]")) return;
    state.search = event.target.value;
    render();
    const input = root.querySelector("[data-search]"); input.focus(); input.setSelectionRange(state.search.length, state.search.length);
  });
  Promise.all([
    fetch("/api/ovens/compare", { cache: "no-store" }).then(async (response) => { const json = await response.json(); if (!response.ok) throw new Error(json.error || "Could not load Compare Oven."); return json.oven; }),
    fetch("/api/oven-data/compare", { cache: "no-store" }).then(async (response) => { const json = await response.json(); if (!response.ok) throw new Error(json.error || "Could not load Compare data."); return json.payload; }),
  ]).then(([oven, payload]) => { state.oven = oven; state.payload = payload; render(); }).catch((error) => { root.innerHTML = `<div class="compare-error">${escapeHtml(error.message)}</div>`; });
})();
