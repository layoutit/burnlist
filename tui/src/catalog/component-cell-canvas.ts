import { buildCellGrid, type CellGrid } from "glyphcss";
import { fitText } from "../theme";

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

export function writeCanvasText(canvas: CellCanvas, x: number, y: number, value: unknown, color: string | null, limit = canvas.width - x) {
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
