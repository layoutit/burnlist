import { buildCellGrid, type CellGrid } from "glyphcss";
// @ts-expect-error Shared pure metric authority is JavaScript by design.
import { allocateBurnCells, clampProgressPercent, waffleMetricData } from "../../../../src/ovens/oven-progress-metrics.mjs";
import type { BurnEntry, ProgressMetric } from "./progress-components";

export type ProgressGlyphKind = "progress-donut" | "burn-donut" | "waffle-metric";

const colors = {
  done: "#55b987",
  empty: "#686868",
  improved: "#55b987",
  worsened: "#e06c75",
  unchanged: "#8b8b8b",
  reverted: "#d19a66",
  failed: "#e06c75",
} as const;

const grid = (chars: string[], cellColors: Array<string | null>, cols: number): CellGrid =>
  buildCellGrid(chars, cellColors, Float64Array.from({ length: cols }, () => 0), cols, 1);

function progress(value: unknown, cols: number): CellGrid {
  const done = Math.round(clampProgressPercent(value) / 100 * cols);
  return grid(
    Array.from({ length: cols }, (_, index) => index < done ? "━" : "·"),
    Array.from({ length: cols }, (_, index) => index < done ? colors.done : colors.empty),
    cols,
  );
}

function burns(value: unknown, cols: number): CellGrid {
  const entries = Array.isArray(value) ? value as readonly BurnEntry[] : [];
  const groups = allocateBurnCells(entries, cols) as Array<{ name: keyof typeof colors; cells: number }>;
  if (!groups.length) return grid(Array(cols).fill("·"), Array(cols).fill(colors.empty), cols);
  const expanded = groups.flatMap((group) => Array.from({ length: group.cells }, () => group.name));
  return grid(expanded.map(() => "━"), expanded.map((name) => colors[name]), cols);
}

function waffle(value: unknown, cols: number): CellGrid {
  const metric = value && typeof value === "object" && !Array.isArray(value) ? value as ProgressMetric : {};
  const data = waffleMetricData(metric) as { failedCells: number; empty: boolean };
  const failed = data.empty ? 0 : Math.round(data.failedCells / 96 * cols);
  return grid(
    Array.from({ length: cols }, (_, index) => index < failed ? "■" : "□"),
    Array.from({ length: cols }, (_, index) => index < failed ? colors.failed : colors.empty),
    cols,
  );
}

/** Real glyphcss CellGrid used by the production OpenTUI GlyphSurface. */
export function progressGlyphFrame(kind: ProgressGlyphKind, value: unknown, width: number): CellGrid {
  const cols = Math.max(3, Math.floor(width));
  if (kind === "progress-donut") return progress(value, cols);
  if (kind === "burn-donut") return burns(value, cols);
  return waffle(value, cols);
}
