import { compactTimeScale } from "../utils/compact-time-scale";

export const DIFFERENTIAL_PROGRESS_CHART_WIDTH = 640;
export const DIFFERENTIAL_PROGRESS_CHART_HEIGHT = 200;

export type DifferentialProgressChartMode = "progress" | "failed" | "delta";
export type DifferentialProgressChartTimeScale = "compact" | "all";
export type DifferentialProgressChartHistoryPoint = Record<string, unknown>;
export type DifferentialProgressChartOptions = { mode?: DifferentialProgressChartMode; timeScale?: DifferentialProgressChartTimeScale };
type Point = Record<string, number | string | null>;
export type DifferentialProgressChartPrimitive = {
  tag: "line" | "rect" | "path" | "circle" | "text" | "g" | "title";
  className?: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: DifferentialProgressChartPrimitive[];
};
export type DifferentialProgressChartGeometry = {
  root: { id: "progress-chart"; viewBox: "0 0 640 200"; ariaLabel: string; className?: string; data: Record<string, string> };
  primitives: DifferentialProgressChartPrimitive[];
};

const width = DIFFERENTIAL_PROGRESS_CHART_WIDTH;
const height = DIFFERENTIAL_PROGRESS_CHART_HEIGHT;
const num = (value: unknown) => Number(value);
const fixed = (value: number) => value.toFixed(1);
const element = (tag: DifferentialProgressChartPrimitive["tag"], attrs: Record<string, string> = {}, className?: string, text?: string, children?: DifferentialProgressChartPrimitive[]) => ({ tag, attrs, className, text, children });
const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const axisNumber = (value: number) => {
  const rounded = Math.round(value); const abs = Math.abs(rounded);
  if (abs >= 1_000_000) return (rounded / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "m";
  if (abs >= 100_000) return `${Math.round(rounded / 1_000)}k`;
  if (abs >= 1_000) return (rounded / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(rounded);
};
const ratio = (value: number) => {
  const text = value.toFixed(Math.abs(value) >= 1 ? 4 : 5).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return text === "-0" ? "0" : text;
};

function chartPoint(source: DifferentialProgressChartHistoryPoint): Point {
  const generated = Date.parse(String(source.drivingParityGeneratedAt));
  return {
    time: Date.parse(String(source.time)), drivingParityTime: Number.isFinite(generated) ? generated : null,
    percent: num(source.percent), done: num(source.done), remaining: num(source.remaining), total: num(source.total),
    drivingParityFailedFieldPercent: num(source.drivingParityFailedFieldPercent), drivingParityFailedFields: num(source.drivingParityFailedFields),
    drivingParityAllFields: num(source.drivingParityAllFields), drivingParityFrames: num(source.drivingParityFrames),
    drivingParityFailedStatePointPercent: num(source.drivingParityFailedStatePointPercent), drivingParityStateFailures: num(source.drivingParityStateFailures),
    drivingParityActiveComparablePoints: num(source.drivingParityActiveComparablePoints),
    drivingParityEventMarker: String(source.drivingParityEventMarker || ""), drivingParityEventTitle: String(source.drivingParityEventTitle || ""),
  };
}

export function buildDifferentialProgressChart(history: DifferentialProgressChartHistoryPoint[] = [], options: DifferentialProgressChartOptions = {}): DifferentialProgressChartGeometry {
  const mode = options.mode ?? "failed"; const timeScale = options.timeScale ?? "compact";
  const failed = mode === "failed" || mode === "delta"; const delta = mode === "delta"; const compact = timeScale === "compact";
  const points = history.map(chartPoint).filter((point) => Number.isFinite(num(point.time)) && Number.isFinite(num(point.percent))).sort((a, b) => num(a.time) - num(b.time));
  const now = Date.now(); const raw = points.length ? points : [{ time: now, percent: 0, done: 0, remaining: 0, total: 0 }];
  let minTime = Math.min(...raw.map((point) => num(point.time))); let maxTime = Math.max(...raw.map((point) => num(point.time)));
  const latestFrames = [...points].reverse().map((point) => num(point.drivingParityFrames)).find(Number.isFinite);
  const sameBucket = (point: Point) => !failed || !Number.isFinite(latestFrames) || num(point.drivingParityFrames) === latestFrames;
  const rawFailed = (point: Point) => Number.isFinite(num(point.drivingParityStateFailures)) ? Math.max(0, num(point.drivingParityStateFailures)) : Math.max(0, Math.min(100, num(point.drivingParityFailedFieldPercent)));
  const overallRatio = (point: Point) => { const samples = num(point.drivingParityAllFields) * num(point.drivingParityFrames); return Number.isFinite(num(point.drivingParityStateFailures)) && Number.isFinite(samples) && samples > 0 ? num(point.drivingParityStateFailures) / samples : NaN; };
  const failedValue = (point: Point) => delta && Number.isFinite(num(point.drivingParityDeltaValue)) ? num(point.drivingParityDeltaValue) : rawFailed(point);
  const totalPercent = (point: Point) => {
    if (Number.isFinite(num(point.drivingParityFailedStatePointPercent))) return Math.max(0, Math.min(100, num(point.drivingParityFailedStatePointPercent)));
    const failures = num(point.drivingParityStateFailures); const total = num(point.drivingParityActiveComparablePoints);
    return Number.isFinite(failures) && Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(100, failures / total * 100)) : NaN;
  };
  const collapse = (source: Point[]) => source.map((point) => ({ ...point, time: Number.isFinite(num(point.drivingParityTime)) ? num(point.drivingParityTime) : num(point.time) })).sort((a, b) => num(a.time) - num(b.time)).filter((point, index, all) => !index || num(all[index - 1].time) !== num(point.time) || num(all[index - 1].drivingParityFrames) !== num(point.drivingParityFrames) || rawFailed(all[index - 1]) !== rawFailed(point));
  let source = failed ? collapse(points.filter((point) => sameBucket(point) && Number.isFinite(num(point.drivingParityStateFailures)))) : [];
  if (failed && !source.length) source = collapse(points.filter((point) => sameBucket(point) && Number.isFinite(num(point.drivingParityFailedFieldPercent))));
  if (failed && source.length >= 3) {
    const kept: Point[] = []; let index = 0;
    while (index < source.length) { const point = source[index]; if (!kept.length) { kept.push(point); index++; continue; }
      const baseline = rawFailed(kept.at(-1)!); const value = rawFailed(point);
      if (!Number.isFinite(baseline) || !Number.isFinite(value) || value <= baseline + Math.max(200, baseline * .002)) { kept.push(point); index++; continue; }
      let restored = -1; for (let cursor = index + 1; cursor < source.length; cursor++) if (rawFailed(source[cursor]) <= baseline + Math.max(50, baseline * .001)) { restored = cursor; break; }
      if (restored < 0) { kept.push(point); index++; } else { kept.push(source[restored]); index = restored + 1; }
    }
    source = kept.filter((point, index, all) => !index || num(point.time) !== num(all[index - 1].time) || rawFailed(point) !== rawFailed(all[index - 1]));
  }
  if (failed && source.length) { const baseline = source.findIndex((point) => point.drivingParityEventMarker === "baseline"); const positive = source.findIndex((point) => rawFailed(point) > 0); const start = baseline >= 0 ? baseline : positive; if (start > 0) source = source.slice(start); }
  if (delta) { let previous: number | null = null; source = source.map((point) => { const value = overallRatio(point); if (!Number.isFinite(value)) return null; const signed = Number.isFinite(previous) ? value - previous! : 0; previous = value; return { ...point, drivingParityDeltaValue: value, drivingParitySignedDelta: signed }; }).filter((point): point is Point => point !== null); }
  if (failed && source.length) { minTime = num(source[0].time); maxTime = Math.max(minTime + 1, num(source.at(-1)!.time)); }
  const dataMax = maxTime; if (failed && !compact) maxTime += Math.max(30_000, Math.min(600_000, (maxTime - minTime) * .015));
  const timeSpan = Math.max(1, maxTime - minTime); const tickSpan = Math.max(1, dataMax - minTime);
  const range = (items: Point[], fallback: Point[] = raw) => { if (!items.length) return fallback; const inside = items.filter((point) => num(point.time) > minTime && num(point.time) < maxTime); const beforeStart = items.filter((point) => num(point.time) <= minTime).at(-1) ?? items[0]; const beforeEnd = items.filter((point) => num(point.time) <= maxTime).at(-1) ?? beforeStart; const series = [{ ...beforeStart, time: minTime }, ...inside]; if (num(series.at(-1)!.time) < maxTime || num(beforeEnd.time) !== num(series.at(-1)!.time)) series.push({ ...beforeEnd, time: maxTime }); return series.filter((point, index, all) => !index || num(point.time) !== num(all[index - 1].time)); };
  const fallback = range(points); const series = failed ? range(source, []) : [];
  const timeline = compact ? compactTimeScale(failed && series.length ? series : fallback, minTime, maxTime) : null;
  const displaySpan = timeline ? timeline.span : timeSpan; const displayTime = (time: number) => timeline ? timeline.project(time) : time - minTime;
  const progress = (point: Point) => Math.max(0, Math.min(100, num(point.percent))); const value = failed ? failedValue : progress;
  const visible = failed && series.length ? series.filter((point) => num(point.time) >= minTime && num(point.time) <= maxTime) : [];
  const domain = failed && visible.length ? visible : raw; const values = domain.map(value).filter(Number.isFinite);
  const rawMin = values.length ? Math.min(...values) : 0; const rawMax = values.length ? Math.max(...values) : 100;
  let valueMin = 0; let valueMax = 100;
  if (failed) { const spread = Math.max(1, rawMax - rawMin); if (delta) { const limit = Math.max(.00001, Math.abs(rawMin), Math.abs(rawMax)) * 1.16; valueMin = -limit; valueMax = limit; } else valueMax = rawMax + Math.max(1, spread * .04, rawMax * .05); if (valueMax <= valueMin) valueMax = valueMin + 1; }
  const y = (number: number) => height - (Math.max(0, Math.min(valueMax, number)) / valueMax) * height;
  const plotY = (number: number) => failed ? height - ((Math.max(valueMin, Math.min(valueMax, number)) - valueMin) / Math.max(Number.EPSILON, valueMax - valueMin)) * height : y(number);
  const x = (time: number) => displayTime(time) / displaySpan * width;
  const segments = (items: Point[]) => { const result: Point[][] = []; let current: Point[] = []; for (const point of items) { if (failed && point.drivingParityEventMarker === "baseline" && current.length) { result.push(current); current = []; } current.push(point); } if (current.length) result.push(current); return !failed || result.length < 2 ? result : result.filter((candidate, index) => index === result.length - 1 || candidate.some((point) => failedValue(point) > 0)); };
  const path = (items: Point[], accessor: (point: Point) => number = value, yAccessor = plotY) => segments(items).map((segment) => { const [first, ...rest] = segment; const commands = [`M ${fixed(x(num(first.time)))} ${fixed(yAccessor(accessor(first)))}`]; let previous = first; for (const point of rest) { const px = fixed(x(num(point.time))); commands.push(`L ${px} ${fixed(yAccessor(accessor(previous)))}`, `L ${px} ${fixed(yAccessor(accessor(point)))}`); previous = point; } return commands.join(" "); }).join(" ");
  const area = (items: Point[], ceiling = false) => segments(items).map((segment) => { const first = segment[0]; const last = segment.at(-1)!; return `${path(segment)} L ${fixed(x(num(last.time)))} ${ceiling ? "0.0" : fixed(plotY(valueMin))} L ${fixed(x(num(first.time)))} ${ceiling ? "0.0" : fixed(plotY(valueMin))} Z`; }).join(" ");
  const ariaLabel = delta ? "Overall failed-sample deviation ratio over time" : failed ? "Failed state points over time" : "Completion percentage over time";
  const className = [!compact ? "range-zoomable" : "", failed ? "failed-chart" : "", delta ? "delta-chart" : "", failed && !delta && series.length && failedValue(series.at(-1)!) <= 0 ? "goal-reached" : ""].filter(Boolean).join(" ") || undefined;
  const primitives: DifferentialProgressChartPrimitive[] = []; const yTicks = delta ? [0, 1, 2, 3, 4].map((i) => valueMin + (valueMax - valueMin) * i / 4) : failed ? [0, 1, 2, 3, 4, 5].map((i) => valueMin + (valueMax - valueMin) * i / 5) : [0, 25, 50, 75, 100];
  for (const [index, tick] of yTicks.entries()) { if (failed && (index === 0 || index === yTicks.length - 1)) continue; const tickY = plotY(tick); const labelY = Math.max(8, Math.min(height - 8, tickY)); primitives.push(element("line", { x1: "0", x2: String(width - (failed ? 36 : 0)), y1: String(tickY), y2: String(tickY) }, "grid-line")); if (!failed && tick === 0) continue; primitives.push(element("rect", { x: "0", y: String(labelY - 8), width: "44", height: "16" }, "label-backdrop")); primitives.push(element("text", { x: String(failed ? width - 4 : 4), y: String(labelY), "text-anchor": failed ? "end" : "start", "dominant-baseline": "central" }, "axis-label y-axis-label", delta ? ratio(tick) : failed ? axisNumber(tick) : `${Math.round(tick)}%`)); }
  const xTicks = timeline ? timeline.ticks(6) : Array.from({ length: 6 }, (_, index) => minTime + tickSpan * index / 5);
  const xGrid = (index: number) => element("line", { x1: String(width * index / 5), x2: String(width * index / 5), y1: "0", y2: "178" }, "grid-line x-grid-line");
  const xLabel = (index: number, time: number) => element("text", { x: String(width * index / 5), y: "194", "text-anchor": "middle" }, "axis-label", clock(time));
  const insertGridBeforeAreas = failed && series.length;
  if (!failed) for (let index = 1; index < 5; index++) primitives.push(xGrid(index));
  if (!failed) { primitives.push(element("path", { d: area(fallback) }, "progress-area"), element("path", { d: path(fallback, progress) }, "progress-line")); }
  if (series.length) {
    if (!delta) primitives.push(element("path", { d: area(series, true) }, "failed-fields-pass-area"));
    if (insertGridBeforeAreas) for (let index = 1; index < 5; index++) primitives.push(xGrid(index));
    if (!delta) primitives.push(element("path", { d: area(series) }, "failed-fields-area")); else primitives.push(element("line", { x1: "0", x2: String(width), y1: String(plotY(0)), y2: String(plotY(0)) }, "delta-zero-line"));
    const percentages = delta ? [] : series.filter((point) => Number.isFinite(totalPercent(point)));
    if (percentages.length) { const percentY = (number: number) => height - Math.max(0, Math.min(100, number)) / 100 * height; const latest = totalPercent(percentages.at(-1)!); primitives.push(element("path", { d: path(percentages, totalPercent, percentY) }, "failed-total-percent-line", undefined, [element("title", {}, undefined, `Failed total: ${latest.toFixed(1).replace(".0", "")}%`)])); }
    const tickChildren: DifferentialProgressChartPrimitive[] = []; const plain: DifferentialProgressChartPrimitive[] = []; const improved: DifferentialProgressChartPrimitive[] = []; let previous: Point | null = null;
    for (const [index, point] of source.filter((candidate) => num(candidate.time) >= minTime && num(candidate.time) <= dataMax && Number.isFinite(failedValue(candidate))).entries()) { const previousValue = previous ? failedValue(previous) : null; previous = point; const current = failedValue(point); const unchanged = delta ? num(point.drivingParitySignedDelta) === 0 : Number.isFinite(previousValue) && current === previousValue; const baseline = index === 0 || point.drivingParityEventMarker === "baseline"; const markerClass = ["improved", "worsened", "reverted"].includes(String(point.drivingParityEventMarker)) ? String(point.drivingParityEventMarker) : Number.isFinite(previousValue) && current < previousValue! ? "improved" : Number.isFinite(previousValue) && current > previousValue! ? "worsened" : ""; const hasMarker = !unchanged && !baseline && (markerClass === "improved" || markerClass === "worsened"); let center = plotY(current); if (hasMarker) { const worsening = markerClass === "worsened"; const available = worsening ? Math.max(0, 176 - center - 4) : Math.max(0, center - 6); const markerHeight = Math.min(10, Math.max(5, available)); const tip = worsening ? Math.min(176 - markerHeight, center + 4) : Math.max(2 + markerHeight, center - 4); center = (tip + (worsening ? tip + markerHeight : tip - markerHeight)) / 2; }
      const title = `${clock(num(point.time))} · ${String(point.drivingParityEventTitle || "")}`;
      if (index !== 0 && index !== source.filter((candidate) => num(candidate.time) >= minTime && num(candidate.time) <= dataMax && Number.isFinite(failedValue(candidate))).length - 1) tickChildren.push(element("line", { x1: fixed(x(num(point.time))), x2: fixed(x(num(point.time))), y1: fixed(center), y2: "200.0" }, `failed-run-tick${unchanged || point.drivingParityEventMarker === "reverted" ? " muted" : ""}`, undefined, [element("title", {}, undefined, title)]));
      if (hasMarker) (markerClass === "improved" ? improved : plain).push(element("text", { x: fixed(x(num(point.time))), y: fixed(center) }, `failed-run-marker ${markerClass}`, markerClass === "worsened" ? "▲" : "▼", [element("title", {}, undefined, title)]));
    }
    if (tickChildren.length) primitives.push(element("g", {}, "failed-run-marker-tick-layer", undefined, tickChildren));
    const latest = series.at(-1)!; const lineTitle = delta ? `Overall deviation: ${ratio(failedValue(latest))} (run change ${num(latest.drivingParitySignedDelta) > 0 ? "+" : ""}${ratio(num(latest.drivingParitySignedDelta || 0))})` : `Failed state points: ${Math.round(num(latest.drivingParityStateFailures || 0))}${Number.isFinite(num(latest.drivingParityFrames)) ? ` / ${Math.round(num(latest.drivingParityFrames))} frames` : ""} (${num(latest.drivingParityFailedStatePointPercent).toFixed(1)}% of ${Math.round(num(latest.drivingParityActiveComparablePoints || 0))} active points); failed fields: ${Math.round(num(latest.drivingParityFailedFields || 0))}/${Math.round(num(latest.drivingParityAllFields || 0))}`;
    primitives.push(element("path", { d: path(series) }, "failed-fields-line", undefined, [element("title", {}, undefined, lineTitle)]));
    for (let index = 1; index < 5; index++) primitives.push(xLabel(index, xTicks[index]));
    if (plain.length || improved.length) primitives.push(element("g", {}, "failed-run-marker-layer", undefined, [...(plain.length ? [element("g", {}, "failed-run-marker-plain-layer", undefined, plain)] : []), ...(improved.length ? [element("g", {}, "failed-run-marker-improved-layer", undefined, improved)] : [])]));
  } else if (failed) { for (let index = 1; index < 5; index++) { primitives.push(xGrid(index)); primitives.push(xLabel(index, xTicks[index])); } }
  if (!failed) {
    for (let index = 1; index < fallback.length; index++) {
      const previous = fallback[index - 1]; const point = fallback[index]; const px = x(num(point.time)); const py = plotY(progress(point));
      if (num(point.total) > num(previous.total)) { const markerHeight = Math.min(8, Math.max(5, Math.max(0, height - 2 - py - 8))); const tip = Math.min(height - 2 - markerHeight, py + 8); primitives.push(element("text", { x: fixed(px), y: fixed((tip + tip + markerHeight) / 2) }, "split-marker", "▲", [element("title", {}, undefined, `Split/add: ${num(point.total) - num(previous.total)} item${num(point.total) - num(previous.total) === 1 ? "" : "s"}`)])); }
      if (num(point.done) > num(previous.done)) { const markerHeight = Math.min(10, Math.max(6, Math.max(0, py - 4 - 2))); const tip = Math.max(2 + markerHeight, py - 4); primitives.push(element("text", { x: fixed(px), y: fixed((tip + tip - markerHeight) / 2) }, "completion-marker", "▼")); }
    }
    const last = fallback.at(-1)!; primitives.push(element("circle", { cx: String(x(num(last.time))), cy: String(plotY(progress(last))), r: "4" }, "progress-dot")); for (let index = 1; index < 5; index++) primitives.push(xLabel(index, xTicks[index]));
  }
  return { root: { id: "progress-chart", viewBox: "0 0 640 200", ariaLabel, className, data: { "plot-left": "0", "plot-right": "640", "plot-top": "0", "plot-bottom": "200", "domain-min": String(minTime), "domain-max": String(maxTime), "time-scale": timeline ? "compact" : "all" } }, primitives };
}
