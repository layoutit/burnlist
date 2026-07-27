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

const brailleBit = (x: number, y: number) => (
  x % 2 === 0
    ? [0x01, 0x02, 0x04, 0x40][y % 4]
    : [0x08, 0x10, 0x20, 0x80][y % 4]
)!;
const braille = (mask: number) => mask ? String.fromCodePoint(0x2800 + mask) : " ";

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

/** Dot resolution used by the terminal-safe 2×4 Braille supersampling pass. */
export function terminalSeriesRasterSize(width: number, height: number) {
  const cols = Math.max(3, Math.floor(width)), rows = Math.max(2, Math.floor(height));
  return { cols, rows, dotWidth: cols * 2, dotHeight: rows * 4 };
}

/**
 * Rasterizes the same ordered path as the console SVG into 2×4-dot Braille
 * cells. Segment state follows the console's interval rule: either failing
 * endpoint makes the connecting segment fail.
 */
export function terminalSeriesFrameFromModel(model: NormalizedTerminalSeries, width: number, height: number, palette: ChartColors): CellGrid {
  const { cols, rows, dotWidth, dotHeight } = terminalSeriesRasterSize(width, height);
  const masks = new Uint8Array(cols * rows), tones = new Uint8Array(cols * rows);
  const points = model.points.filter((point): point is Readonly<{
    index: number;
    tick: number;
    label: string;
    reference: number | null;
    candidate: number | null;
    value: number;
    state: "pass" | "fail";
  }> => Number.isFinite(point.value));
  const selected = bucketTerminalSeries(points.map((point, index) => ({
    label: String(index),
    value: point.value,
    state: point.state,
  })), dotWidth);
  const series = selected.map((point) => points[Number(point.label)]!).filter(Boolean);
  if (!series.length) return grid(Array(cols * rows).fill(" "), Array(cols * rows).fill(null), cols, rows);
  const min = model.domain.min, max = model.domain.max, span = Math.max(0.000001, max - min);
  const y = (entry: number) => Math.max(0, Math.min(dotHeight - 1, Math.round((max - entry) / span * (dotHeight - 1))));
  const monochrome = palette.green === palette.red;
  const pass = monochrome ? palette.green : model.colors.pass;
  const fail = monochrome ? palette.red : model.colors.fail;
  const paint = (dotX: number, dotY: number, tone: 1 | 2 | 3) => {
    if (dotX < 0 || dotY < 0 || dotX >= dotWidth || dotY >= dotHeight) return;
    const cellX = Math.floor(dotX / 2), cellY = Math.floor(dotY / 4), index = cellY * cols + cellX;
    masks[index] |= brailleBit(dotX, dotY);
    tones[index] = Math.max(tones[index]!, tone);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, tone: 2 | 3, dashed = false) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2));
    for (let step = 0; step <= steps; step += 1) {
      if (dashed && Math.floor(step / 3) % 2) continue;
      const mix = step / steps;
      paint(Math.round(x1 + (x2 - x1) * mix), Math.round(y1 + (y2 - y1) * mix), tone);
    }
  };
  if (model.mode === "delta") {
    const guide = y(0);
    for (let dotX = 0; dotX < dotWidth; dotX += 4) paint(dotX, guide, 1);
  }
  const x = (index: number) => series.length === 1
    ? Math.floor(dotWidth / 2)
    : Math.round(index / (series.length - 1) * (dotWidth - 1));
  for (let index = 0; index < series.length - 1; index += 1) {
    const first = series[index]!, next = series[index + 1]!;
    const failing = first.state === "fail" || next.state === "fail";
    line(x(index), y(first.value), x(index + 1), y(next.value), failing ? 3 : 2);
    if (model.mode === "value" && failing && Number.isFinite(first.reference) && Number.isFinite(next.reference)) {
      line(x(index), y(first.reference!), x(index + 1), y(next.reference!), 2, true);
    }
  }
  if (series.length === 1) paint(x(0), y(series[0]!.value), series[0]!.state === "fail" ? 3 : 2);
  return grid(
    [...masks].map(braille),
    [...tones].map((tone) => tone === 3 ? fail : tone === 2 ? pass : tone === 1 ? palette.dim : null),
    cols,
    rows,
  );
}

export function terminalSeriesChartFrame(points: readonly TerminalChartPoint[], width: number, height: number, palette: ChartColors): CellGrid {
  return terminalSeriesFrameFromModel(terminalSeriesModel(points), width, height, palette);
}

/** @deprecated Source-compatible name; rendering is now a compact series. */
export const terminalLineChartFrame = terminalSeriesChartFrame;
export const terminalSeriesLevels = levels;
