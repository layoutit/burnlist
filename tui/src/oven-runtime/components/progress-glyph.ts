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
  const squareCols = cols < 4 ? 2 : 4, rows = 2, cells = squareCols * rows;
  const groups = allocateBurnCells(entries, cells) as Array<{ name: keyof typeof colors; cells: number }>;
  if (!groups.length) return grid(Array(cells).fill("·"), Array(cells).fill(colors.empty), squareCols, rows);
  const expanded = groups.flatMap((group) => Array.from({ length: group.cells }, () => group.name));
  const shades: Record<string, string> = { improved: "█", worsened: "▓", unchanged: "▒", reverted: "░" };
  return grid(expanded.map((name) => shades[name] ?? "·"), expanded.map((name) => colors[name]), squareCols, rows);
}

const brailleBit = (x: number, y: number) => (
  x === 0 ? [0x01, 0x02, 0x04, 0x40][y] : [0x08, 0x10, 0x20, 0x80][y]
)!;
const braille = (mask: number) => String.fromCodePoint(0x2800 + mask);

function waffle(value: unknown, _requestedCols: number, colors: ProgressGlyphColors): CellGrid {
  const metric = value && typeof value === "object" && !Array.isArray(value) ? value as ProgressMetric : {};
  const data = waffleMetricData(metric) as { empty: boolean };
  const cols = 5, rows = 3;
  const total = Math.max(0, Number(metric.total) || 0);
  const nonPassing = Math.max(0, (Number(metric.failed) || 0) + (Number(metric.blocked) || 0));
  const failed = data.empty ? 0 : Math.round(Math.min(1, nonPassing / total) * 100);
  const chars: string[] = [], cellColors: string[] = [];
  for (let cellY = 0; cellY < rows; cellY += 1) for (let cellX = 0; cellX < cols; cellX += 1) {
    let failedMask = 0, passingMask = 0;
    for (let dotY = 0; dotY < 4; dotY += 1) for (let dotX = 0; dotX < 2; dotX += 1) {
      const x = cellX * 2 + dotX, y = cellY * 4 + dotY;
      if (y >= 10) continue;
      const isFailed = (9 - x) * 10 + (9 - y) < failed;
      if (isFailed) failedMask |= brailleBit(dotX, dotY);
      else passingMask |= brailleBit(dotX, dotY);
    }
    chars.push(braille(failedMask || passingMask));
    cellColors.push(data.empty ? colors.empty : failedMask ? colors.failed : colors.done);
  }
  return grid(chars, cellColors, cols, rows);
}

/** Real glyphcss CellGrid used by the production OpenTUI GlyphSurface. */
export function progressGlyphFrame(kind: ProgressGlyphKind, value: unknown, width: number, palette?: ProgressGlyphPalette, height = 1): CellGrid {
  const cols = Math.max(2, Math.floor(width)), colors = colorsFor(palette);
  if (kind === "progress-donut") return progressQuadrants(value, cols, colors);
  if (kind === "burn-donut") return burns(value, cols, colors);
  return waffle(value, cols, colors);
}
