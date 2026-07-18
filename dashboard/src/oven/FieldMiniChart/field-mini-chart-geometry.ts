export const FIELD_MINI_CHART_WIDTH = 900;
export const FIELD_MINI_CHART_HEIGHT = 58;
export const GREEN = "#61d394";
export const RED = "#ef4444";

export type FieldMiniChartSample = [number, unknown, unknown, number];

export type FieldMiniChartField = {
  samples: FieldMiniChartSample[];
  sampleLabels?: (string | number)[];
};

export type FieldMiniChartBand = {
  x: string;
  y: "0";
  width: string;
  height: string;
  fill: string;
  opacity: string;
};

export type FieldMiniChartLine = {
  x1: string;
  x2: string;
  y1: string;
  y2: string;
  stroke: string;
  strokeWidth: string;
  strokeDasharray?: string;
  opacity?: string;
  vectorEffect: "non-scaling-stroke";
};

export type FieldMiniChartPath = {
  d: string;
  fill: "none";
  stroke: string;
  strokeWidth: string;
  opacity: string;
  vectorEffect: "non-scaling-stroke";
  strokeDasharray?: string;
  strokeDashoffset?: string;
};

export type FieldMiniChartTick = {
  x1: string;
  x2: string;
  y1: string;
  y2: string;
  stroke: "rgba(168, 168, 168, 0.075)";
  strokeWidth: "1";
  vectorEffect: "non-scaling-stroke";
  shapeRendering: "crispEdges";
};

export type FieldMiniChartTickLabel = {
  left: string;
  text: string;
};

export type FieldMiniChartGeometry = {
  mode: "value" | "delta";
  empty: boolean;
  bands: FieldMiniChartBand[];
  lines: FieldMiniChartLine[];
  paths: FieldMiniChartPath[];
  ticks: FieldMiniChartTick[];
  tickLabels: FieldMiniChartTickLabel[];
};

type PlotPoint = [number, number] | null;
type Row = { tick: number; reference: number | null; candidate: number | null; state: number };

function plotValue(raw: unknown, categories: Map<string, number>): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "string") {
    if (!categories.has(raw)) categories.set(raw, categories.size);
    return categories.get(raw) ?? null;
  }
  return null;
}

function pathStrings(points: PlotPoint[]): string[] {
  const result: string[] = [];
  let current = "";
  for (const point of points) {
    if (!point) {
      if (current) result.push(current);
      current = "";
      continue;
    }
    current += `${current ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`;
  }
  if (current) result.push(current);
  return result;
}

function segment(start: [number, number], end: [number, number], trimStart = 0, trimEnd = 0) {
  let [x1, y1] = start;
  let [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(Math.hypot(dx, dy), 0.000001);
  const first = Math.min(trimStart, length / 2);
  const last = Math.min(trimEnd, length / 2);
  x1 += dx / length * first;
  y1 += dy / length * first;
  x2 -= dx / length * last;
  y2 -= dy / length * last;
  return {
    path: `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`,
    length: Math.hypot(x2 - x1, y2 - y1),
    x2,
    y2,
  };
}

export function buildFieldMiniChart(field: FieldMiniChartField, showFrameLabels: boolean, chartMode: string): FieldMiniChartGeometry {
  const mode = chartMode === "delta" ? "delta" : "value";
  const categories = new Map<string, number>();
  const rows: Row[] = field.samples.map(([tick, reference, candidate, state]) => ({
    tick,
    reference: plotValue(reference, categories),
    candidate: plotValue(candidate, categories),
    state,
  }));
  const x = (index: number) => rows.length <= 1 ? 0 : index / (rows.length - 1) * FIELD_MINI_CHART_WIDTH;
  const exactFailure = (index: number) => rows[index] ? rows[index].state !== 0 : false;
  const intervalFails = (index: number) => exactFailure(index) || exactFailure(index + 1);
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
  const tickIndexes: number[] = [];
  for (let index = frameStep; index < rows.length - 1; index += frameStep * 2) tickIndexes.push(index);
  const ticks: FieldMiniChartTick[] = tickIndexes.map((index) => ({
    x1: x(index).toFixed(1),
    x2: x(index).toFixed(1),
    y1: showFrameLabels ? "13" : "0",
    y2: String(FIELD_MINI_CHART_HEIGHT),
    stroke: "rgba(168, 168, 168, 0.075)",
    strokeWidth: "1",
    vectorEffect: "non-scaling-stroke",
    shapeRendering: "crispEdges",
  }));
  const tickLabels: FieldMiniChartTickLabel[] = showFrameLabels
    ? tickIndexes.map((index) => ({
      left: (index / Math.max(1, rows.length - 1) * 100).toFixed(4),
      text: String(field.sampleLabels?.[index] || Math.round(rows[index].tick)),
    }))
    : [];
  const bands = (failed: boolean, points: PlotPoint[]) => {
    const result: FieldMiniChartBand[] = [];
    for (let index = 0; index < rows.length - 1; index += 1) {
      if (intervalFails(index) !== failed || !points[index] || !points[index + 1]) continue;
      const start = index;
      while (index + 1 < rows.length - 1 && intervalFails(index + 1) === failed && points[index + 1] && points[index + 2]) index += 1;
      result.push({
        x: x(start).toFixed(1),
        y: "0",
        width: Math.max(1, x(index + 1) - x(start)).toFixed(1),
        height: String(FIELD_MINI_CHART_HEIGHT),
        fill: failed ? RED : GREEN,
        opacity: failed ? ".14" : ".10",
      });
    }
    return result;
  };

  if (mode === "delta") {
    const values = rows.map((row) => row.reference === null || row.candidate === null ? null : row.candidate - row.reference);
    const finite = values.filter((value): value is number => Number.isFinite(value));
    if (!finite.length) return { mode, empty: true, bands: [], lines: [], paths: [], ticks: [], tickLabels: [] };
    const maxAbs = Math.max(0.000001, ...finite.map((entry) => Math.abs(entry)));
    const limit = maxAbs + Math.max(maxAbs * 0.16, 0.000001);
    const y = (entry: number) => FIELD_MINI_CHART_HEIGHT - (entry + limit) / (limit * 2) * FIELD_MINI_CHART_HEIGHT;
    const points = values.map((entry, index): PlotPoint => entry === null ? null : [x(index), y(entry)]);
    const passed: string[] = [];
    const failed: string[] = [];
    for (let index = 0; index < rows.length - 1; index += 1) {
      if (!points[index] || !points[index + 1]) continue;
      const isFailed = intervalFails(index);
      const line = segment(
        points[index],
        points[index + 1],
        !isFailed && index > 0 && intervalFails(index - 1) ? 1.2 : 0,
        !isFailed && index + 1 < rows.length - 1 && intervalFails(index + 1) ? 1.2 : 0,
      ).path;
      (isFailed ? failed : passed).push(line);
    }
    return {
      mode,
      empty: false,
      bands: [...bands(false, points), ...bands(true, points)],
      lines: [{ x1: "0", x2: String(FIELD_MINI_CHART_WIDTH), y1: String(y(0)), y2: String(y(0)), stroke: GREEN, strokeWidth: "1.05", strokeDasharray: "5 4", opacity: ".58", vectorEffect: "non-scaling-stroke" }],
      paths: [
        ...(passed.length ? [{ d: passed.join(" "), fill: "none" as const, stroke: GREEN, strokeWidth: "1.55", opacity: ".8", vectorEffect: "non-scaling-stroke" as const }] : []),
        ...(failed.length ? [{ d: failed.join(" "), fill: "none" as const, stroke: RED, strokeWidth: "1.6", opacity: ".8", vectorEffect: "non-scaling-stroke" as const }] : []),
      ],
      ticks,
      tickLabels,
    };
  }

  const finite = rows.flatMap((row) => [row.reference, row.candidate]).filter((value): value is number => Number.isFinite(value));
  const min = Math.min(...finite, 0);
  const max = Math.max(...finite, 0);
  const pad = Math.max((max - min) * 0.16, Math.abs(max || min || 1) * 0.03, 0.000001);
  const low = min - pad;
  const high = max + pad;
  const span = Math.max(high - low, 0.000001);
  const y = (entry: number) => FIELD_MINI_CHART_HEIGHT - (entry - low) / span * FIELD_MINI_CHART_HEIGHT;
  const reference: PlotPoint[] = rows.map((row, index) => row.reference === null ? null : [x(index), y(row.reference)]);
  const candidate: PlotPoint[] = rows.map((row, index) => row.candidate === null ? null : [x(index), y(row.candidate)]);
  const allMatch = !rows.some((_, index) => exactFailure(index));
  if (allMatch) {
    const match = pathStrings(candidate).length ? pathStrings(candidate) : pathStrings(reference);
    return {
      mode,
      empty: false,
      bands: bands(false, candidate),
      lines: [],
      paths: match.map((d) => ({ d, fill: "none", stroke: GREEN, strokeWidth: "1.5", opacity: ".8", vectorEffect: "non-scaling-stroke" })),
      ticks,
      tickLabels,
    };
  }

  const candidatePassing: string[] = [];
  const candidateFailing: string[] = [];
  const referenceFailing: { path: string; offset: number }[] = [];
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
        const previous = referenceFailing.at(-1);
        if (previous) previous.path += `L${line.x2.toFixed(1)},${line.y2.toFixed(1)}`;
      } else {
        referenceFailing.push({ path: line.path, offset: -(referenceLength % 9) });
      }
      referenceLength += line.length;
      previousReferenceFailingIndex = index;
    } else {
      previousReferenceFailingIndex = -2;
    }
  }
  return {
    mode,
    empty: false,
    bands: [...bands(false, candidate), ...bands(true, candidate)],
    lines: [],
    paths: [
      ...(candidatePassing.length ? [{ d: candidatePassing.join(" "), fill: "none" as const, stroke: GREEN, strokeWidth: "1.5", opacity: ".8", vectorEffect: "non-scaling-stroke" as const }] : []),
      ...(candidateFailing.length ? [{ d: candidateFailing.join(" "), fill: "none" as const, stroke: RED, strokeWidth: "1.6", opacity: ".8", vectorEffect: "non-scaling-stroke" as const }] : []),
      ...referenceFailing.map((line) => ({ d: line.path, fill: "none" as const, stroke: GREEN, strokeWidth: "1.25", strokeDasharray: "5 4", strokeDashoffset: line.offset.toFixed(2), opacity: ".8", vectorEffect: "non-scaling-stroke" as const })),
    ],
    ticks,
    tickLabels,
  };
}
