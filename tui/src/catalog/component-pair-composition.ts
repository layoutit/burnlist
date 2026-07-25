import { fitText } from "../theme";
import { terminalCellWidth } from "../terminal-text";
import { terminalSeriesFrameFromModel, type NormalizedTerminalSeries } from "../terminal-series-chart-model";
import {
  fillCanvasRow,
  pasteCellGrid,
  writeCanvasText,
  type CellCanvas,
  type PairPalette,
} from "./component-cell-canvas";

export type PairKpiItem = Readonly<{ heading: string; value: string; tone?: "good" | "bad" | "neutral" }>;
export type PairTableColumn = Readonly<{
  id: string;
  label: string;
  minWidth: number;
  align?: "left" | "right";
  grow?: number;
}>;
export type PairTableRow = Readonly<{
  cells: Readonly<Record<string, string>>;
  tone?: "good" | "bad" | "neutral";
}>;
export const PAIR_RUN_LOG_COLUMNS: readonly PairTableColumn[] = Object.freeze([
  { id: "age", label: "Age", minWidth: 5, align: "left" },
  { id: "frame", label: "Frame", minWidth: 5, align: "right" },
  { id: "result", label: "Result", minWidth: 7, align: "right", grow: 2 },
  { id: "delta", label: "Delta", minWidth: 6, align: "right" },
  { id: "done", label: "Done", minWidth: 5, align: "right" },
]);

export function renderPairHeader(
  canvas: CellCanvas,
  title: string,
  meta: string,
  palette: PairPalette,
) {
  const metaWidth = Math.min(meta.length, Math.max(10, Math.floor(canvas.width * 0.42)));
  const metaX = Math.max(1, canvas.width - metaWidth - 1);
  writeCanvasText(canvas, 1, 0, title, palette.foreground, Math.max(1, metaX - 2));
  writeCanvasText(canvas, metaX, 0, meta, palette.dim, metaWidth);
}

export function renderPairKpiItem(
  canvas: CellCanvas,
  item: PairKpiItem,
  x: number,
  y: number,
  width: number,
  palette: PairPalette,
) {
  const color = item.tone === "good" ? palette.green : item.tone === "bad" ? palette.red : palette.foreground;
  writeCanvasText(canvas, x, y, item.heading.toUpperCase(), palette.dim, width);
  writeCanvasText(canvas, x, y + 1, item.value, color, width);
}

export function renderPairKpiStrip(
  canvas: CellCanvas,
  items: readonly PairKpiItem[],
  x: number,
  y: number,
  width: number,
  palette: PairPalette,
) {
  const itemWidth = Math.max(5, Math.floor(width / Math.max(1, items.length)));
  items.forEach((item, index) => {
    const itemX = x + index * itemWidth;
    renderPairKpiItem(canvas, item, itemX, y, Math.min(itemWidth - 1, x + width - itemX), palette);
  });
}

export function renderPairSeriesChart(
  canvas: CellCanvas,
  model: NormalizedTerminalSeries,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: PairPalette,
  title?: string,
) {
  const titleRows = title ? 1 : 0;
  if (title) writeCanvasText(canvas, x, y, title, palette.muted, width);
  const chartHeight = Math.max(2, height - titleRows);
  pasteCellGrid(canvas, terminalSeriesFrameFromModel(model, width, chartHeight, palette), x, y + titleRows);
}

export function pairTableColumnWidths(columns: readonly PairTableColumn[], width: number): readonly number[] {
  if (!columns.length) return [];
  const safeWidth = Math.max(columns.length, Math.floor(width));
  const widths = columns.map((column) => Math.max(2, Math.floor(column.minWidth)));
  let remaining = safeWidth - widths.reduce((sum, value) => sum + value, 0);
  while (remaining < 0) {
    const index = widths.reduce((best, value, candidate) => value > widths[best]! ? candidate : best, 0);
    if (widths[index]! <= 2) break;
    widths[index]! -= 1;
    remaining += 1;
  }
  const growOrder = columns.flatMap((column, index) =>
    Array.from({ length: Math.max(1, Math.floor(column.grow ?? 1)) }, () => index));
  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) {
    widths[growOrder[cursor % growOrder.length]!]! += 1;
  }
  return widths;
}

function tableCell(value: string, width: number, align: "left" | "right") {
  const clipped = fitText(value, width).trimEnd();
  return { value: clipped, offset: align === "right" ? Math.max(0, width - terminalCellWidth(clipped)) : 0 };
}

/** Relaxed measured table primitive shared by the standalone Table and TopCard Run Log. */
export function renderPairTable(
  canvas: CellCanvas,
  columns: readonly PairTableColumn[],
  rows: readonly PairTableRow[],
  x: number,
  y: number,
  width: number,
  height: number,
  palette: PairPalette,
  title?: string,
) {
  let rowY = y;
  if (title) {
    writeCanvasText(canvas, x, rowY, title, palette.foreground, width);
    rowY += 1;
  }
  const widths = pairTableColumnWidths(columns, width);
  let columnX = x;
  columns.forEach((column, index) => {
    const cell = tableCell(column.label.toUpperCase(), widths[index]!, column.align ?? "left");
    writeCanvasText(canvas, columnX + cell.offset, rowY, cell.value, palette.dim, widths[index]! - cell.offset);
    columnX += widths[index]!;
  });
  fillCanvasRow(canvas, rowY + 1, x, width, "─", palette.dim);
  rows.slice(0, Math.max(0, height - (title ? 3 : 2))).forEach((row, rowIndex) => {
    let cellX = x;
    const color = row.tone === "good" ? palette.green : row.tone === "bad" ? palette.red : palette.muted;
    columns.forEach((column, index) => {
      const cell = tableCell(row.cells[column.id] ?? "", widths[index]!, column.align ?? "left");
      writeCanvasText(canvas, cellX + cell.offset, rowY + 2 + rowIndex, cell.value, color, widths[index]! - cell.offset);
      cellX += widths[index]!;
    });
  });
  return { widths, headerY: rowY, dividerY: rowY + 1 };
}
