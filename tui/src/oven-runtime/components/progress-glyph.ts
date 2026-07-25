import { buildCellGrid, type CellGrid } from "glyphcss";
// @ts-expect-error Shared pure metric authority is JavaScript by design.
import { allocateBurnCells, clampProgressPercent, waffleMetricData } from "../../../../src/ovens/oven-progress-metrics.mjs";
import type { BurnEntry, ProgressMetric } from "./progress-components";

export type ProgressGlyphKind = "progress-donut" | "burn-donut" | "waffle-metric";
export type ProgressGlyphPalette = Readonly<{ green: string; red: string; muted: string; dim: string; amber: string }>;
type ProgressGlyphColors = Readonly<Record<"done" | "empty" | "improved" | "worsened" | "unchanged" | "reverted" | "failed", string>>;

const defaults: ProgressGlyphColors = {
  done: "#55b987",
  empty: "#686868",
  improved: "#55b987",
  worsened: "#e06c75",
  unchanged: "#8b8b8b",
  reverted: "#d19a66",
  failed: "#e06c75",
};
const colorsFor = (palette?: ProgressGlyphPalette) => palette ? {
  done: palette.green,
  empty: palette.dim,
  improved: palette.green,
  worsened: palette.red,
  unchanged: palette.muted,
  reverted: palette.amber,
  failed: palette.red,
} : defaults;

const grid = (chars: string[], cellColors: Array<string | null>, cols: number, rows = 1): CellGrid =>
  buildCellGrid(chars, cellColors, Float64Array.from({ length: cols * rows }, () => 0), cols, rows);

function progressQuadrants(value: unknown, requestedCols: number, colors: ProgressGlyphColors): CellGrid {
  const cols = requestedCols < 4 ? 2 : 4;
  const rows = 2;
  const cells = cols * rows;
  const exact = clampProgressPercent(value) / 100 * cells;
  const full = Math.floor(exact);
  const remainder = exact - full;
  const chars = Array.from({ length: cells }, (_, index) => {
    if (index < full) return "█";
    if (index > full || remainder === 0) return "░";
    return remainder >= 2 / 3 ? "▓" : remainder >= 1 / 3 ? "▒" : "░";
  });
  return grid(
    chars,
    chars.map((char) => char === "░" ? colors.worsened : colors.done),
    cols,
    rows,
  );
}

function burns(value: unknown, cols: number, colors: ProgressGlyphColors): CellGrid {
  const entries = Array.isArray(value) ? value as readonly BurnEntry[] : [];
  const groups = allocateBurnCells(entries, cols) as Array<{ name: keyof typeof colors; cells: number }>;
  if (!groups.length) return grid(Array(cols).fill("·"), Array(cols).fill(colors.empty), cols);
  const expanded = groups.flatMap((group) => Array.from({ length: group.cells }, () => group.name));
  return grid(expanded.map(() => "━"), expanded.map((name) => colors[name]), cols);
}

function waffle(value: unknown, requestedCols: number, colors: ProgressGlyphColors): CellGrid {
  const metric = value && typeof value === "object" && !Array.isArray(value) ? value as ProgressMetric : {};
  const data = waffleMetricData(metric) as { failedCells: number; empty: boolean };
  const cols = requestedCols < 5 ? Math.max(2, requestedCols) : 5;
  const rows = cols < 5 ? 3 : 4;
  const cells = cols * rows;
  const failed = data.empty ? 0 : Math.round(data.failedCells / 80 * cells);
  const failedAt = (index: number) => {
    const row = Math.floor(index / cols), column = index % cols;
    return (cols - 1 - column) * rows + (rows - 1 - row) < failed;
  };
  return grid(
    Array.from({ length: cells }, (_, index) => data.empty ? "▫" : failedAt(index) ? "▪" : "▫"),
    Array.from({ length: cells }, (_, index) => data.empty ? colors.empty : failedAt(index) ? colors.failed : colors.done),
    cols,
    rows,
  );
}

/** Real glyphcss CellGrid used by the production OpenTUI GlyphSurface. */
export function progressGlyphFrame(kind: ProgressGlyphKind, value: unknown, width: number, palette?: ProgressGlyphPalette, height = 1): CellGrid {
  const cols = Math.max(2, Math.floor(width)), colors = colorsFor(palette);
  if (kind === "progress-donut") return progressQuadrants(value, cols, colors);
  if (kind === "burn-donut") return burns(value, cols, colors);
  return waffle(value, cols, colors);
}
