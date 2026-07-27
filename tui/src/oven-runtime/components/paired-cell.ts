import { buildCellGrid, type CellGrid } from "glyphcss";
import { fitText } from "../../theme";
import { terminalCellWidth } from "../../terminal-text";
import { terminalSeriesFrameFromModel, type NormalizedTerminalSeries } from "../../terminal-series-chart-model";

export type PairPalette = Readonly<{
  foreground: string;
  soft: string;
  muted: string;
  dim: string;
  blue: string;
  green: string;
  red: string;
  amber: string;
}>;

export type CellCanvas = {
  width: number;
  height: number;
  char: string[];
  color: Array<string | null>;
};

export type PairKpiItem = Readonly<{
  heading: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
  frame?: CellGrid;
}>;
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
  { id: "age", label: "AGE", minWidth: 5 },
  { id: "frame", label: "FRAME", minWidth: 5, align: "right" },
  { id: "result", label: "RESULT", minWidth: 7, align: "right", grow: 2 },
  { id: "delta", label: "DELTA", minWidth: 6, align: "right" },
  { id: "done", label: "DONE", minWidth: 5, align: "right" },
]);

export function createCellCanvas(width: number, height: number): CellCanvas {
  const safeWidth = Math.max(1, Math.floor(width)), safeHeight = Math.max(1, Math.floor(height));
  return {
    width: safeWidth,
    height: safeHeight,
    char: Array(safeWidth * safeHeight).fill(" "),
    color: Array(safeWidth * safeHeight).fill(null),
  };
}

export function setCanvasCell(canvas: CellCanvas, x: number, y: number, char: string, color: string | null) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const index = y * canvas.width + x;
  canvas.char[index] = [...char][0] ?? " ";
  canvas.color[index] = color;
}

export function writeCanvasText(
  canvas: CellCanvas,
  x: number,
  y: number,
  value: unknown,
  color: string | null,
  limit = canvas.width - x,
) {
  const fitted = fitText(value, Math.max(0, Math.min(limit, canvas.width - x)));
  [...fitted].forEach((char, offset) => setCanvasCell(canvas, x + offset, y, char, color));
}

export function fillCanvasRow(canvas: CellCanvas, y: number, x: number, width: number, char: string, color: string | null) {
  for (let offset = 0; offset < Math.max(0, width); offset += 1) setCanvasCell(canvas, x + offset, y, char, color);
}

export function pasteCellGrid(canvas: CellCanvas, frame: CellGrid, x: number, y: number) {
  for (let row = 0; row < frame.rows; row += 1) for (let column = 0; column < frame.cols; column += 1) {
    const index = row * frame.cols + column;
    setCanvasCell(canvas, x + column, y + row, frame.char[index] ?? " ", frame.color[index] ?? null);
  }
}

export function canvasCellGrid(canvas: CellCanvas): CellGrid {
  return buildCellGrid(
    canvas.char,
    canvas.color,
    Float64Array.from({ length: canvas.width * canvas.height }, () => 0),
    canvas.width,
    canvas.height,
  );
}

export function cellGridText(frame: CellGrid): string {
  return Array.from({ length: frame.rows }, (_, row) =>
    frame.char.slice(row * frame.cols, (row + 1) * frame.cols).join("").trimEnd()
  ).join("\n");
}

export function renderPairHeader(canvas: CellCanvas, title: string, meta: string, palette: PairPalette) {
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
  if (item.frame) {
    if (width < item.frame.cols + terminalCellWidth(item.heading) + 2) {
      writeCanvasText(canvas, x, y, item.heading, palette.dim, width);
      pasteCellGrid(canvas, item.frame, x, y + 1);
      writeCanvasText(canvas, x + item.frame.cols + 1, y + 1, item.value, color, Math.max(1, width - item.frame.cols - 1));
      return;
    }
    pasteCellGrid(canvas, item.frame, x, y);
    const textX = x + item.frame.cols + 1, textWidth = Math.max(1, width - item.frame.cols - 1);
    writeCanvasText(canvas, textX, y, item.heading, palette.dim, textWidth);
    writeCanvasText(canvas, textX, y + 1, item.value, color, textWidth);
    return;
  }
  writeCanvasText(canvas, x, y, item.heading, palette.dim, width);
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
  pasteCellGrid(canvas, terminalSeriesFrameFromModel(model, width, Math.max(2, height - titleRows), palette), x, y + titleRows);
}

/** Crops the shared two-row chart model into a footer-safe inline spark row. */
export function renderPairSeriesSparkRow(
  canvas: CellCanvas,
  model: NormalizedTerminalSeries,
  x: number,
  y: number,
  width: number,
  palette: PairPalette,
) {
  const frame = terminalSeriesFrameFromModel(model, width, 2, palette);
  for (let column = 0; column < frame.cols; column += 1) {
    setCanvasCell(canvas, x + column, y, frame.char[column] ?? " ", frame.color[column] ?? null);
  }
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
  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) widths[growOrder[cursor % growOrder.length]!]! += 1;
  return widths;
}

function tableCell(value: string, width: number, align: "left" | "right") {
  const clipped = fitText(value, width).trimEnd();
  return { value: clipped, offset: align === "right" ? Math.max(0, width - terminalCellWidth(clipped)) : 0 };
}

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
    const cell = tableCell(column.label, widths[index]!, column.align ?? "left");
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
