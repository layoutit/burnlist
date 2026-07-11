export function mountCompareDashboard(root, oven, payload) {
  const WIDTH = 900;
  const HEIGHT = 58;
  const GREEN = "#61d394";
  const RED = "#ef4444";
  const state = {
    view: "cards",
    chart: "current",
    sort: "improved",
    filter: "all",
    search: "",
    progressScale: "compact",
    pageIndex: 0,
    pageSize: 25,
    expanded: new Set(),
    oven,
    payload,
  };
  let inputRenderTimer = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

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
  function nonPass(field) { return Number(field.failedSampleCount || 0) + Number(field.missingSampleCount || 0); }
  function fieldResult(field) { return field.trustStatus === "blocked" || field.missingSampleCount > 0 ? "BLOCKED" : field.failedSampleCount > 0 ? "FAIL" : "PASS"; }
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
  function age(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 60000));
    if (!Number.isFinite(minutes) || minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
  }
  function burnDonut(entries) {
    const groups = { improved: 0, worsened: 0, neutral: 0, reverted: 0 };
    for (const entry of entries) {
      if (entry.result === "improved" || entry.result === "pass") groups.improved += 1;
      else if (entry.result === "worsened") groups.worsened += 1;
      else if (entry.result === "blocked" || entry.result === "reverted") groups.reverted += 1;
      else groups.neutral += 1;
    }
    const active = Object.entries(groups).filter(([, amount]) => amount > 0);
    const total = active.reduce((sum, [, amount]) => sum + amount, 0);
    const gap = active.length > 1 ? (58 / 40) / (2 * Math.PI * 21) * 100 : 0;
    let offset = 0;
    const circles = active.map(([name, amount]) => {
      const share = amount / Math.max(1, total) * 100;
      const dash = Math.max(0, share - gap);
      const circle = `<circle class="compare-burn-segment ${name}" cx="29" cy="29" r="21" pathLength="100" transform="rotate(-90 29 29)" stroke-dasharray="${dash.toFixed(3)} ${(100 - dash).toFixed(3)}" stroke-dashoffset="${(-(offset + gap / 2)).toFixed(3)}"/>`;
      offset += share;
      return circle;
    }).join("");
    const improvedPercent = entries.length ? groups.improved / entries.length * 100 : 0;
    return `<div class="compare-kpi-item compare-kpi-section" title="Burn events across the current Compare run"><svg class="compare-burn-donut" viewBox="0 0 58 58" aria-hidden="true"><circle class="compare-burn-track" cx="29" cy="29" r="21"${total ? ' opacity="0"' : ""}/>${circles}</svg><div class="compare-kpi-text"><span class="compare-kpi-heading">Burns</span><span class="compare-kpi-ratio compare-burn-summary"><span class="total">${count(entries.length)}</span><span class="separator">·</span><span class="worsened">${count(groups.worsened)}</span><span class="separator">·</span><span class="improved">${count(groups.improved)} (${percent(improvedPercent)})</span></span></div></div>`;
  }
  function waffleMetric(metric, label) {
    const failed = Number(metric.failed || 0) + Number(metric.blocked || 0);
    const ratio = metric.total ? failed / metric.total : 0;
    const failedCells = Math.min(80, Math.round(ratio * 96));
    return `<div class="compare-kpi-item compare-kpi-section" title="${percent(ratio * 100)} failed ${escapeHtml(label.toLowerCase())}"><canvas class="compare-waffle" aria-hidden="true" data-failed-cells="${failedCells}" data-empty="${metric.total ? "false" : "true"}" width="43" height="34"></canvas><div class="compare-kpi-text"><span class="compare-kpi-heading">${escapeHtml(label)}</span><span class="compare-kpi-ratio"><span class="total">${kpiTotal(metric.total)}</span><span class="separator">·</span><span class="fail">${count(failed)} (${percent(ratio * 100)})</span></span></div></div>`;
  }
  function paintWaffles() {
    const scale = window.devicePixelRatio || 1;
    root.querySelectorAll("canvas.compare-waffle").forEach((waffle) => {
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
      const passColor = styles.getPropertyValue("--compare-green").trim() || GREEN;
      const failColor = styles.getPropertyValue("--compare-red").trim() || RED;
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
  function progress(points) {
    if (!points.length) return '<div class="compare-empty">No comparable history.</div>';
    const filteredPoints = [];
    let pointIndex = 0;
    while (pointIndex < points.length) {
      const point = points[pointIndex];
      if (!filteredPoints.length) {
        filteredPoints.push(point);
        pointIndex += 1;
        continue;
      }
      const baseline = Number(filteredPoints.at(-1).value);
      const current = Number(point.value);
      const spikeThreshold = Math.max(200, baseline * .002);
      const restoreTolerance = Math.max(50, baseline * .001);
      if (!Number.isFinite(baseline) || !Number.isFinite(current) || current <= baseline + spikeThreshold) {
        filteredPoints.push(point);
        pointIndex += 1;
        continue;
      }
      let restoredIndex = -1;
      for (let cursor = pointIndex + 1; cursor < points.length; cursor += 1) {
        const restored = Number(points[cursor].value);
        if (Number.isFinite(restored) && restored <= baseline + restoreTolerance) {
          restoredIndex = cursor;
          break;
        }
      }
      if (restoredIndex === -1) {
        filteredPoints.push(point);
        pointIndex += 1;
        continue;
      }
      filteredPoints.push(points[restoredIndex]);
      pointIndex = restoredIndex + 1;
    }
    const firstTime = Date.parse(filteredPoints[0].timestamp);
    const roundedStart = Math.floor(firstTime / (10 * 60_000)) * 10 * 60_000;
    const anchorTime = roundedStart < firstTime ? roundedStart : firstTime - 10 * 60_000;
    const chartPoints = filteredPoints.length === 1
      ? [{ ...filteredPoints[0], timestamp: new Date(anchorTime).toISOString(), syntheticAnchor: true }, ...filteredPoints]
      : roundedStart < firstTime
        ? [{ ...filteredPoints[0], timestamp: new Date(roundedStart).toISOString(), syntheticAnchor: true }, ...filteredPoints]
        : filteredPoints;
    const width = 560, height = 230, left = 0, right = 5, top = 6, bottom = 28;
    const values = chartPoints.map((point) => Math.max(0, Number(point.value) || 0));
    const times = chartPoints.map((point) => Date.parse(point.timestamp));
    const minTime = Math.min(...times), maxTime = Math.max(...times);
    const anchors = [...new Set(times.filter(Number.isFinite))].sort((a, b) => a - b);
    const segments = [];
    let displayEnd = 0;
    for (let index = 1; index < anchors.length; index += 1) {
      const start = anchors[index - 1], end = anchors[index];
      const elapsed = Math.max(0, end - start);
      const displayElapsed = elapsed > 30 * 60_000 ? 8 * 60_000 : elapsed;
      segments.push({ start, end, displayStart: displayEnd, displayEnd: displayEnd + displayElapsed });
      displayEnd += displayElapsed;
    }
    const project = (time) => {
      if (state.progressScale === "all" || !segments.length) return time - minTime;
      const segment = segments.find((candidate) => time <= candidate.end) || segments.at(-1);
      const ratio = segment.end > segment.start ? (time - segment.start) / (segment.end - segment.start) : 0;
      return segment.displayStart + (segment.displayEnd - segment.displayStart) * ratio;
    };
    const unproject = (displayTime) => {
      if (state.progressScale === "all" || !segments.length) return minTime + displayTime;
      const segment = segments.find((candidate) => displayTime <= candidate.displayEnd) || segments.at(-1);
      const ratio = segment.displayEnd > segment.displayStart ? (displayTime - segment.displayStart) / (segment.displayEnd - segment.displayStart) : 0;
      return segment.start + (segment.end - segment.start) * ratio;
    };
    const timeSpan = Math.max(1, state.progressScale === "all" ? maxTime - minTime : displayEnd);
    const x = (index) => left + (project(times[index]) / timeSpan) * (width - left - right);
    const rawMin = Math.min(...values), rawMax = Math.max(...values);
    const spread = Math.max(1, rawMax - rawMin);
    const niceCeil = (value) => {
      const exponent = Math.floor(Math.log10(Math.max(1, value)));
      const base = 10 ** exponent;
      const scaled = value / base;
      return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * base;
    };
    const paddedMax = rawMax + Math.max(1, spread * .12, rawMax * .15);
    const axisStep = niceCeil(paddedMax / 10);
    const valueMax = Math.max(1, Math.ceil(paddedMax / axisStep) * axisStep);
    const y = (entry) => top + (1 - Math.max(0, Math.min(valueMax, entry)) / valueMax) * (height - top - bottom);
    let path = `M${x(0)},${y(values[0])}`;
    for (let index = 1; index < values.length; index += 1) path += `H${x(index)}V${y(values[index])}`;
    const baseline = height - bottom;
    const latest = chartPoints.at(-1);
    const color = latest.value === 0 ? GREEN : RED;
    const grid = [1, 2, 3, 4].map((index) => {
      const value = valueMax * index / 4;
      const lineY = y(value);
      const labelY = Math.max(top + 14, Math.min(height - bottom - 2, lineY + 14));
      return `<line class="compare-grid-line" x1="${left}" x2="${width - right}" y1="${lineY}" y2="${lineY}"/><rect class="compare-label-backdrop" x="0" y="${labelY - 12}" width="44" height="16"/><text class="compare-axis-label" x="8" y="${labelY}">${escapeHtml(axisNumber(value))}</text>`;
    }).join("");
    const ticks = Array.from({ length: 5 }, (_, index) => {
      const position = left + ((width - left - right) * index) / 4;
      const tickTime = unproject((timeSpan * index) / 4);
      return `<line class="compare-axis-tick" x1="${position}" x2="${position}" y1="${baseline}" y2="${baseline + 5}"/><text class="compare-axis-label" x="${position}" y="${height - 6}" text-anchor="${index === 0 ? "start" : index === 4 ? "end" : "middle"}">${escapeHtml(timeOnly(new Date(tickTime).toISOString()).slice(0, 5))}</text>`;
    }).join("");
    const guides = chartPoints.map((point, index) => `<line class="compare-run-tick${point.result === "unchanged" || point.result === "reverted" ? " muted" : ""}" x1="${x(index)}" x2="${x(index)}" y1="${top}" y2="${baseline}"/>`).join("");
    const markers = chartPoints.map((point, index) => {
      const previous = index ? values[index - 1] : values[index];
      const markerClass = point.result === "improved" || values[index] < previous ? "improved" : point.result === "worsened" || values[index] > previous ? "worsened" : "";
      if (!markerClass) return "";
      const improved = markerClass === "improved";
      const py = y(values[index]);
      const markerY = improved ? Math.max(top + 7, py - 8) : Math.min(baseline - 7, py + 11);
      return `<text class="compare-progress-marker ${markerClass}" x="${x(index)}" y="${markerY}">${improved ? "▼" : "▲"}</text>`;
    }).join("");
    const latestY = y(values.at(-1));
    const labelY = Math.max(top + 14, Math.min(baseline - 4, latestY + 18));
    return `<svg class="chart failed-chart compare-progress" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${grid}<line class="compare-axis-line" x1="${left}" x2="${width - right}" y1="${baseline}" y2="${baseline}"/><path class="compare-failed-area" d="${path}V${baseline}H${x(0)}Z"/><g>${guides}</g><path class="compare-failed-line" d="${path}"/>${markers}<rect class="compare-label-backdrop" x="${width - right - 46}" y="${labelY - 13}" width="44" height="16"/><text class="compare-end-label" x="${width - right - 2}" y="${labelY}" text-anchor="end">${compact(latest.value)}</text>${ticks}</svg>`;
  }
  function compact(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(1)}m`;
    if (Math.abs(number) >= 1e3) return `${Math.round(number / 1e3)}k`;
    return String(Math.round(number));
  }
  function axisNumber(value) {
    const number = Number(value) || 0;
    const absolute = Math.abs(number);
    if (absolute >= 1e6) return `${(number / 1e6).toFixed(absolute >= 1e7 ? 0 : 1).replace(/\.0$/, "")}m`;
    if (absolute >= 1e5) return `${Math.round(number / 1e3)}k`;
    if (absolute >= 1e3) return `${(number / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
    if (absolute < 10 && !Number.isInteger(number)) return number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return String(Math.round(number));
  }
  function logResult(result) {
    if (result === "improved" || result === "pass") return "better";
    if (result === "worsened") return "worse";
    if (result === "unchanged") return "neutral";
    return result;
  }
  function log(entries) {
    const rows = entries.slice(0, 10).map((entry) => `<article class="log-row log-table-row no-detail compare-log-row" title="${escapeHtml(entry.firstFailingLabel || "")}"><span class="log-table-cell age">${escapeHtml(age(entry.timestamp))}</span><span class="log-table-cell state result ${escapeHtml(entry.result)}">${escapeHtml(logResult(entry.result))}</span><span class="log-table-cell failed">${count(entry.value)}</span><span class="log-table-cell delta ${escapeHtml(entry.result)}">${entry.delta === null ? "—" : `${entry.delta < 0 ? "▼ " : entry.delta > 0 ? "▲ " : ""}${count(Math.abs(entry.delta))}`}</span><time class="log-table-cell time">${escapeHtml(timeOnly(entry.timestamp))}</time></article>`).join("");
    return `<div class="checklist-log"><div class="checklist-log-list compare-log"><div class="checklist-log-table-header compare-log-head"><span>Age</span><span>Result</span><span>Value</span><span>Delta</span><span>Timestamp</span></div>${rows}</div></div>`;
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
    const x = (index) => rows.length <= 1 ? 0 : index / (rows.length - 1) * WIDTH;
    const exactFailure = (index) => {
      const row = rows[index];
      if (!row) return false;
      if (row.reference === null || row.candidate === null) return row.reference !== row.candidate;
      return row.reference !== row.candidate;
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
    for (let index = frameStep; index < rows.length - 1; index += frameStep) tickIndexes.push(index);
    const tickMarks = tickIndexes.map((index) => `<line class="compare-frame-tick" x1="${x(index).toFixed(1)}" x2="${x(index).toFixed(1)}" y1="0" y2="${HEIGHT}"/>`).join("");
    const tickLabels = tickIndexes.map((index) => `<span class="compare-frame-tick-label" style="left:${(index / Math.max(1, rows.length - 1) * 100).toFixed(4)}%">${escapeHtml(Math.round(rows[index].tick))}</span>`).join("");
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
    const browserOk = [], browserFailed = [], nativeFailed = [];
    let nativeLength = 0;
    for (let index = 0; index < rows.length - 1; index += 1) {
      const failed = intervalFails(index);
      const trimStart = !failed && index > 0 && intervalFails(index - 1) ? 1.2 : 0;
      const trimEnd = !failed && index + 1 < rows.length - 1 && intervalFails(index + 1) ? 1.2 : 0;
      if (candidate[index] && candidate[index + 1]) (failed ? browserFailed : browserOk).push(segment(candidate[index], candidate[index + 1], trimStart, trimEnd).path);
      if (failed && reference[index] && reference[index + 1]) {
        const line = segment(reference[index], reference[index + 1], trimStart, trimEnd);
        nativeFailed.push({ path: line.path, offset: -(nativeLength % 9) });
        nativeLength += line.length;
      }
    }
    return `<div class="plot"><svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none">${bands(false, candidate)}${bands(true, candidate)}${tickMarks}${browserOk.length ? `<path d="${browserOk.join(" ")}" fill="none" stroke="${GREEN}" stroke-width="1.5" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}${browserFailed.length ? `<path d="${browserFailed.join(" ")}" fill="none" stroke="${RED}" stroke-width="1.6" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}${nativeFailed.map((line) => `<path d="${line.path}" fill="none" stroke="${GREEN}" stroke-width="1.25" stroke-dasharray="5 4" stroke-dashoffset="${line.offset.toFixed(2)}" opacity=".8" vector-effect="non-scaling-stroke"/>`).join("")}</svg>${tickLabels}</div>`;
  }
  function label(field) {
    const description = field.semantics?.meaning || field.driftReason || field.sourceOwner || "";
    const result = fieldResult(field), countValue = nonPass(field);
    const ratio = field.sampleCount ? countValue / field.sampleCount : 0;
    return `<div class="compare-label" title="${escapeHtml(description)}"><strong>${escapeHtml(field.label)}</strong><span>${countValue ? `${count(countValue)} failed` : result}</span><span class="improvement">${ratio.toFixed(4)}</span></div>`;
  }
  function hasPresentNull(field) {
    return field.samples.some(([, reference, candidate, sampleState]) => sampleState <= 1 && (reference === null || candidate === null));
  }
  function isInactive(field) {
    return field.samples.length > 0 && field.samples.every(([, reference, candidate]) => reference === null && candidate === null);
  }
  function isMaterialized(field) {
    return field.samples.some(([, , , sampleState]) => sampleState === 2);
  }
  function visibleFields() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.payload.fields.filter((field) => {
      if (state.filter === "tested" && field.sampleCount <= 0) return false;
      if (state.filter === "failing" && nonPass(field) === 0) return false;
      if (state.filter === "missing" && field.missingSampleCount === 0) return false;
      if (state.filter === "nulls" && !hasPresentNull(field)) return false;
      if (state.filter === "inactive" && !isInactive(field)) return false;
      if (state.filter === "materialized" && !isMaterialized(field)) return false;
      return !query || [field.label, field.sourceOwner, field.driftClass, field.semantics?.kind].some((entry) => String(entry || "").toLowerCase().includes(query));
    });
    return filtered.sort((left, right) => {
      if (state.sort === "improved") return nonPass(right) - nonPass(left) || state.payload.fields.indexOf(left) - state.payload.fields.indexOf(right);
      if (state.sort === "target") return (left.firstFailingTick ?? Infinity) - (right.firstFailingTick ?? Infinity) || left.label.localeCompare(right.label);
      if (state.sort === "name") return left.label.localeCompare(right.label);
      if (state.sort === "failing") return nonPass(right) - nonPass(left) || left.label.localeCompare(right.label);
      if (state.sort === "frames") return Number(right.sampleCount || 0) - Number(left.sampleCount || 0) || left.label.localeCompare(right.label);
      if (state.sort === "group") return String(left.sourceOwner || "").localeCompare(String(right.sourceOwner || "")) || left.label.localeCompare(right.label);
      if (state.sort === "type") return String(left.semantics?.kind || left.unit || "").localeCompare(String(right.semantics?.kind || right.unit || "")) || left.label.localeCompare(right.label);
      return state.payload.fields.indexOf(left) - state.payload.fields.indexOf(right);
    });
  }
  function fieldRows(fields) {
    if (state.view === "table") return `<div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>Field</th><th>Status</th><th>Non-pass</th><th>Max delta</th><th>Trace</th></tr></thead><tbody>${fields.map((field) => `<tr><td>${escapeHtml(field.label)}</td><td class="${nonPass(field) ? "bad" : "good"}">${fieldResult(field)}</td><td>${count(nonPass(field))}</td><td>${value(field.maxDelta)}</td><td>${chart(field)}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="compare-rows">${fields.map((field) => {
      const expanded = state.expanded.has(field.id);
      return `<section class="compare-row ${nonPass(field) ? "fail" : "pass"}${expanded ? " expanded" : ""}" data-expand="${escapeHtml(field.id)}" role="button" tabindex="0" aria-expanded="${expanded}">${label(field)}${chart(field)}</section>`;
    }).join("")}</div>`;
  }
  function textButton(id, pressed, title, text) {
    return `<button aria-label="${title}" aria-pressed="${pressed}" data-control="${id}" title="${title}">${text}</button>`;
  }
  function controls() {
    return `<div id="compare-controls" class="compare-controls"><input id="compare-field-search" aria-label="Compare search fields" data-search placeholder="Search Fields..." type="search"><span class="control-sep" aria-hidden="true">|</span><div class="compare-toggle compare-view-toggle" role="group" aria-label="Compare view">${textButton("cards", state.view === "cards", "Cards view", "Cards")}<span class="sep" aria-hidden="true">·</span>${textButton("table", state.view === "table", "Table view", "Table")}</div><span class="control-sep" aria-hidden="true">|</span><div class="compare-toggle" role="group" aria-label="Compare chart mode">${textButton("current", state.chart === "current", "Value chart view", "Value")}<span class="sep" aria-hidden="true">·</span>${textButton("delta", state.chart === "delta", "Delta chart view", "Delta")}</div><span class="control-sep" aria-hidden="true">|</span><select aria-label="Compare sort" data-select="sort"><option value="default">Default</option><option value="improved">Changed</option><option value="target">Target</option><option value="failing">Failing</option><option value="frames">Frames</option><option value="group">Group</option><option value="name">Name</option><option value="type">Type</option></select><span class="control-sep" aria-hidden="true">|</span><select aria-label="Compare field filter" data-select="filter"><option value="all">All</option><option value="tested">Tested</option><option value="failing">Failing</option><option value="missing">Uncovered</option><option value="nulls">Nulls</option><option value="inactive">Inactive</option><option value="materialized">Materialized</option></select></div>`;
  }
  function pagination(total) {
    const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
    state.pageIndex = Math.max(0, Math.min(state.pageIndex, pageCount - 1));
    const start = total ? state.pageIndex * state.pageSize + 1 : 0;
    const end = Math.min(total, (state.pageIndex + 1) * state.pageSize);
    return `<div class="compare-controls compare-pagination"${total <= state.pageSize ? " hidden" : ""}><select aria-label="Compare rows per page" data-select="page-size"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select><button type="button" data-control="page-prev"${state.pageIndex === 0 ? " disabled" : ""}>Prev</button><span class="page-status">${start}-${end} / ${total}</span><button type="button" data-control="page-next"${state.pageIndex >= pageCount - 1 ? " disabled" : ""}>Next</button></div>`;
  }
  function render() {
    if (!state.oven || !state.payload) return;
    const cells = new Map(state.oven.detail.cells.map((cell) => [cell.id, cell]));
    const title = cells.get("title"), burns = cells.get("burns"), fields = cells.get("fields"), frames = cells.get("frames"), progressCell = cells.get("progress"), logCell = cells.get("log"), details = cells.get("field-details");
    if (![title, burns, fields, frames, progressCell, logCell, details].every(Boolean)) { root.innerHTML = '<div class="compare-error">Compare Oven layout is incomplete.</div>'; return; }
    const visible = visibleFields();
    state.pageIndex = Math.max(0, Math.min(state.pageIndex, Math.max(0, Math.ceil(visible.length / state.pageSize) - 1)));
    const start = state.pageIndex * state.pageSize;
    const page = visible.slice(start, start + state.pageSize);
    const titleText = String(state.payload.title || title.title || "Compare");
    const subtitleParts = [state.payload.subtitle, dateTime(state.payload.generatedAt)].filter(Boolean);
    root.innerHTML = `<div class="compare-page"><main class="compare-detail"><section class="compare-kpi-strip" aria-label="Compare field KPIs"><div class="compare-kpi-item compare-kpi-title-item" title="${escapeHtml(state.payload.subtitle || "")}"><span class="compare-kpi-title">${escapeHtml(titleText)}</span><span class="compare-kpi-subtitle">${escapeHtml(subtitleParts.join(" · "))}</span></div>${burnDonut(state.payload.log)}${waffleMetric(state.payload.summary.fields, "Fields")}${waffleMetric(state.payload.summary.frames, "Frames")}</section><div class="compare-workspace"><div class="detail-report-column"><section class="top"><div class="compare-panel compare-progress-panel"><div class="compare-panel-title"><div class="progress-title-group"><h2>${escapeHtml(progressCell.title)}</h2></div><div class="chart-tools"><div class="compare-time-toggle" aria-label="Compare progress time scale">${textButton("progress-all", state.progressScale === "all", "Show elapsed time", "All")}<span class="sep" aria-hidden="true">·</span>${textButton("progress-compact", state.progressScale === "compact", "Compress inactive time", "Compact")}</div></div></div><div class="score"><div class="chart-wrap">${progress(state.payload.progress)}</div></div></div><section class="compare-panel compare-log-panel"><div class="work-panel-body"><div class="work-tab-pane">${log(state.payload.log)}</div></div></section></section></div></div></main><main class="compare-fields-cell"><div class="compare-toolbar"><h2>${escapeHtml(details.title)}</h2>${controls()}</div>${fieldRows(page)}${pagination(visible.length)}</main></div>`;
    paintWaffles();
    const sort = root.querySelector('[data-select="sort"]'), filter = root.querySelector('[data-select="filter"]'), search = root.querySelector("[data-search]"), pageSize = root.querySelector('[data-select="page-size"]');
    sort.value = state.sort; filter.value = state.filter; search.value = state.search;
    if (pageSize) pageSize.value = String(state.pageSize);
  }
  root.addEventListener("click", (event) => {
    const control = event.target.closest("[data-control]");
    if (control) {
      const value = control.dataset.control;
      if (value === "cards" || value === "table") state.view = value;
      if (value === "current" || value === "delta") state.chart = value;
      if (value === "progress-all") state.progressScale = "all";
      if (value === "progress-compact") state.progressScale = "compact";
      if (value === "page-prev") state.pageIndex = Math.max(0, state.pageIndex - 1);
      if (value === "page-next") state.pageIndex += 1;
      render();
      return;
    }
    const row = event.target.closest("[data-expand]");
    if (!row) return;
    const key = row.dataset.expand;
    if (state.expanded.has(key)) state.expanded.delete(key);
    else state.expanded.add(key);
    render();
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches('[data-select="sort"]')) { state.sort = event.target.value; state.pageIndex = 0; }
    if (event.target.matches('[data-select="filter"]')) { state.filter = event.target.value; state.pageIndex = 0; }
    if (event.target.matches('[data-select="page-size"]')) { state.pageSize = Number(event.target.value) || 25; state.pageIndex = 0; }
    render();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-expand]");
    if (!row) return;
    event.preventDefault();
    row.click();
  });
  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-search]")) return;
    state.search = event.target.value;
    state.pageIndex = 0;
    window.clearTimeout(inputRenderTimer);
    inputRenderTimer = window.setTimeout(() => {
      render();
      const input = root.querySelector("[data-search]");
      input.focus();
      input.setSelectionRange(state.search.length, state.search.length);
    }, 0);
  });
  render();
  return {
    update(nextOven, nextPayload) {
      state.oven = nextOven;
      state.payload = nextPayload;
      render();
    },
  };
}

export const COMPARE_REFRESH_MS = 2000;

function comparePayloadRevision(payload) {
  return String(payload?.generatedAt || "");
}

export function startCompareDashboardLiveUpdates(root, {
  fetchImpl = globalThis.fetch,
  setIntervalImpl = globalThis.setInterval.bind(globalThis),
  clearIntervalImpl = globalThis.clearInterval.bind(globalThis),
  mount = mountCompareDashboard,
  refreshMs = COMPARE_REFRESH_MS,
  onError = (error, hasDashboard) => {
    if (!hasDashboard) root.innerHTML = `<div class="compare-error">${String(error?.message || error)}</div>`;
    else console.error("Could not refresh Compare data.", error);
  },
} = {}) {
  let oven = null;
  let dashboard = null;
  let payloadRevision = "";
  let refreshInFlight = false;
  let refreshQueued = false;
  let stopped = false;

  const read = async (url, key, fallbackMessage) => {
    const response = await fetchImpl(url, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || fallbackMessage);
    return json[key];
  };

  const refresh = async () => {
    if (stopped) return;
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }
    refreshInFlight = true;
    try {
      const [nextOven, payload] = await Promise.all([
        oven ?? read("/api/ovens/compare", "oven", "Could not load Compare Oven."),
        read("/api/oven-data/compare", "payload", "Could not load Compare data."),
      ]);
      if (stopped) return;
      const nextRevision = comparePayloadRevision(payload);
      oven = nextOven;
      if (!dashboard) dashboard = mount(root, oven, payload);
      else if (nextRevision !== payloadRevision) dashboard.update(oven, payload);
      payloadRevision = nextRevision;
    } catch (error) {
      if (!stopped) onError(error, Boolean(dashboard));
    } finally {
      refreshInFlight = false;
      if (refreshQueued && !stopped) {
        refreshQueued = false;
        void refresh();
      }
    }
  };

  const ready = refresh();
  const timer = setIntervalImpl(refresh, refreshMs);
  return {
    ready,
    refresh,
    stop() {
      stopped = true;
      refreshQueued = false;
      clearIntervalImpl(timer);
    },
  };
}

const fallbackRoot = typeof document === "undefined" ? null : document.querySelector("#compare-root");
if (fallbackRoot) {
  document.body.classList.add("compare-oven-body");
  startCompareDashboardLiveUpdates(fallbackRoot);
}
