import { buildCellGrid, type CellGrid } from "glyphcss";
import type { TerminalPalette } from "./terminal-accessibility";
// @ts-expect-error Shared pure chart authority is JavaScript by design.
import { normalizeSeriesChart } from "../../src/ovens/series-chart-model.mjs";

export type TerminalChartPoint = Readonly<{
  label: string;
  value: number;
  state: "pass" | "fail";
}>;

type ChartColors = Pick<TerminalPalette, "green" | "red" | "dim" | "muted">;
const levels = [..."▁▂▃▄▅▆▇█"];
const grid = (chars: string[], colors: Array<string | null>, cols: number, rows: number): CellGrid =>
  buildCellGrid(chars, colors, Float64Array.from({ length: cols * rows }, () => 0), cols, rows);

function setCell(chars: string[], colors: Array<string | null>, cols: number, rows: number, row: number, col: number, char: string, color: string) {
  if (row < 0 || col < 0 || row >= rows || col >= cols) return;
  const index = row * cols + col;
  chars[index] = char;
  colors[index] = color;
}

/**
 * Deterministic width reduction. Every bucket retains a failure when present,
 * otherwise its largest absolute excursion; global extrema are force-retained.
 */
export function bucketTerminalSeries(points: readonly TerminalChartPoint[], limit: number): TerminalChartPoint[] {
  const finite = points.filter((point) => Number.isFinite(point.value));
  const size = Math.max(1, Math.floor(limit));
  if (finite.length <= size) return [...finite];
  const selected = new Map<number, TerminalChartPoint>();
  for (let bucket = 0; bucket < size; bucket += 1) {
    const start = Math.floor(bucket * finite.length / size);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * finite.length / size));
    const slice = finite.slice(start, end), failures = slice.filter((point) => point.state === "fail");
    const candidate = (failures.length ? failures : slice).reduce((best, point) =>
      Math.abs(point.value) > Math.abs(best.value) ? point : best
    );
    selected.set(start + slice.indexOf(candidate), candidate);
  }
  const globalMin = Math.min(...finite.map((point) => point.value));
  const globalMax = Math.max(...finite.map((point) => point.value));
  for (const target of [globalMin, globalMax]) {
    const index = finite.findIndex((point) => point.value === target);
    selected.set(index, finite[index]!);
  }
  const ordered = [...selected.entries()].sort(([left], [right]) => left - right);
  while (ordered.length > size) {
    const removable = ordered.findIndex(([, point], index) =>
      index > 0 && index < ordered.length - 1 && point.state !== "fail"
      && point.value !== globalMin && point.value !== globalMax
    );
    ordered.splice(removable < 0 ? 1 : removable, 1);
  }
  return ordered.map(([, point]) => point);
}

export type NormalizedTerminalSeries = Readonly<{
  mode: "delta" | "value";
  empty: boolean;
  points: readonly Readonly<{
    index: number;
    tick: number;
    label: string;
    reference: number | null;
    candidate: number | null;
    value: number | null;
    state: "pass" | "fail";
  }>[];
  domain: Readonly<{ min: number; max: number }>;
  colors: Readonly<{ pass: string; fail: string }>;
  layout: Readonly<{
    aspectRatio: number;
    innerPadding: Readonly<{ top: number; right: number; bottom: number; left: number }>;
    surface: string;
    divider: string;
    axes: boolean;
    scaleLabels: boolean;
  }>;
}>;

export function terminalSeriesModel(points: readonly unknown[], mode: "delta" | "value" = "delta"): NormalizedTerminalSeries {
  return normalizeSeriesChart(points, { mode }) as NormalizedTerminalSeries;
}

/**
 * Compact rasterization of the console's unframed series surface. It keeps the
 * semantic zero guide for delta mode, but deliberately adds no axes or labels.
 */
export function terminalSeriesFrameFromModel(model: NormalizedTerminalSeries, width: number, height: number, palette: ChartColors): CellGrid {
  const cols = Math.max(3, Math.floor(width)), rows = Math.max(2, Math.floor(height));
  const chars = Array(cols * rows).fill(" "), colors: Array<string | null> = Array(cols * rows).fill(null);
  const points = model.points.filter((point): point is Readonly<{
    index: number;
    tick: number;
    label: string;
    reference: number | null;
    candidate: number | null;
    value: number;
    state: "pass" | "fail";
  }> => Number.isFinite(point.value));
  const series = bucketTerminalSeries(points, cols);
  if (!series.length) return grid(chars, colors, cols, rows);
  const min = model.domain.min, max = model.domain.max, span = Math.max(0.000001, max - min);
  const rowFor = (entry: number) => Math.max(0, Math.min(rows - 1, Math.round((max - entry) / span * (rows - 1))));
  const baseline = rowFor(0);
  const monochrome = palette.green === palette.red;
  const pass = monochrome ? palette.green : model.colors.pass;
  const fail = monochrome ? palette.red : model.colors.fail;
  if (model.mode === "delta") for (let column = 0; column < cols; column += 1) {
    setCell(chars, colors, cols, rows, baseline, column, column % 2 ? " " : "·", pass);
  }
  series.forEach((point, index) => {
    const column = series.length === 1 ? Math.floor(cols / 2) : Math.round(index / (series.length - 1) * (cols - 1));
    const target = rowFor(point.value), color = point.state === "fail" ? fail : pass;
    const start = Math.min(baseline, target), end = Math.max(baseline, target);
    if (start === end) setCell(chars, colors, cols, rows, target, column, "▁", color);
    else for (let row = start; row <= end; row += 1) setCell(chars, colors, cols, rows, row, column, "█", color);
  });
  return grid(chars, colors, cols, rows);
}

export function terminalSeriesChartFrame(points: readonly TerminalChartPoint[], width: number, height: number, palette: ChartColors): CellGrid {
  return terminalSeriesFrameFromModel(terminalSeriesModel(points), width, height, palette);
}

/** @deprecated Source-compatible name; rendering is now a compact series. */
export const terminalLineChartFrame = terminalSeriesChartFrame;
export const terminalSeriesLevels = levels;
