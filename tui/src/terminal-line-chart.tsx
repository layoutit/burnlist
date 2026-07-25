import { buildCellGrid, type CellGrid } from "glyphcss";
import { fitText } from "./theme";
import { useTerminalPalette, type TerminalPalette } from "./terminal-accessibility";
import "./glyph-surface";

export type TerminalChartPoint = Readonly<{
  label: string;
  value: number;
  state: "pass" | "fail";
}>;

type ChartColors = Pick<TerminalPalette, "green" | "red" | "dim" | "muted">;
const compact = (value: number) => {
  if (Math.abs(value) >= 100) return Math.round(value).toString();
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/u, "");
  return value.toFixed(2).replace(/\.?0+$/u, "") || "0";
};

function grid(chars: string[], colors: Array<string | null>, cols: number, rows: number): CellGrid {
  return buildCellGrid(chars, colors, Float64Array.from({ length: cols * rows }, () => 0), cols, rows);
}

function setCell(chars: string[], colors: Array<string | null>, cols: number, row: number, col: number, char: string, color: string) {
  if (row < 0 || col < 0 || row * cols + col >= chars.length) return;
  const index = row * cols + col;
  chars[index] = char;
  colors[index] = color;
}

function write(chars: string[], colors: Array<string | null>, cols: number, row: number, col: number, text: string, color: string) {
  [...text].forEach((char, index) => setCell(chars, colors, cols, row, col + index, char, color));
}

function finite(points: readonly TerminalChartPoint[]): TerminalChartPoint[] {
  return points.filter((point) => Number.isFinite(point.value));
}

/** Rasterizes a connected, state-colored line chart into a real glyphcss CellGrid. */
export function terminalLineChartFrame(points: readonly TerminalChartPoint[], width: number, height: number, palette: ChartColors): CellGrid {
  const cols = Math.max(12, Math.floor(width)), rows = Math.max(3, Math.floor(height));
  const chars = Array(cols * rows).fill(" "), colors: Array<string | null> = Array(cols * rows).fill(null);
  const values = finite(points);
  if (!values.length) {
    write(chars, colors, cols, 0, 0, fitText("No chart samples", cols), palette.dim);
    return grid(chars, colors, cols, rows);
  }

  const rawMin = Math.min(...values.map((point) => point.value), 0);
  const rawMax = Math.max(...values.map((point) => point.value), 0);
  const pad = Math.max((rawMax - rawMin) * 0.08, Math.abs(rawMax || rawMin || 1) * 0.02, 0.0001);
  const min = rawMin - pad, max = rawMax + pad, span = Math.max(0.0001, max - min);
  const labelWidth = Math.min(6, Math.max(compact(min).length, compact(max).length) + 1);
  const axis = labelWidth, plotStart = axis + 1, plotEnd = cols - 1, plotWidth = Math.max(2, plotEnd - plotStart);
  const plotBottom = rows - 2, plotHeight = Math.max(1, plotBottom);
  const x = (index: number) => plotStart + Math.round(index / Math.max(1, values.length - 1) * plotWidth);
  const y = (value: number) => Math.max(0, Math.min(plotBottom, Math.round((max - value) / span * plotHeight)));

  write(chars, colors, cols, 0, 0, compact(max).padStart(labelWidth), palette.muted);
  write(chars, colors, cols, plotBottom, 0, compact(min).padStart(labelWidth), palette.muted);
  for (let row = 0; row <= plotBottom; row += 1) setCell(chars, colors, cols, row, axis, row === plotBottom ? "└" : "│", palette.dim);
  for (let col = plotStart; col <= plotEnd; col += 1) setCell(chars, colors, cols, plotBottom, col, "─", palette.dim);

  const plot = values.map((point, index) => ({ ...point, col: x(index), row: y(point.value) }));
  for (let index = 0; index < plot.length - 1; index += 1) {
    const start = plot[index]!, end = plot[index + 1]!;
    const fail = start.state === "fail" || end.state === "fail";
    const color = fail ? palette.red : palette.green;
    const dx = Math.max(1, end.col - start.col);
    for (let step = 0; step <= dx; step += 1) {
      const ratio = step / dx, row = Math.round(start.row + (end.row - start.row) * ratio), col = start.col + step;
      const direction = end.row === start.row ? "─" : end.row < start.row ? "╱" : "╲";
      setCell(chars, colors, cols, row, col, direction, color);
    }
  }
  for (const point of plot) setCell(chars, colors, cols, point.row, point.col, "●", point.state === "fail" ? palette.red : palette.green);

  const first = values[0]!.label, last = values.at(-1)!.label;
  write(chars, colors, cols, rows - 1, plotStart, fitText(first, Math.max(1, plotWidth)), palette.dim);
  const tail = fitText(last, Math.max(1, plotWidth)), tailCol = Math.max(plotStart, cols - tail.length);
  if (values.length > 1 && tailCol > plotStart + first.length) write(chars, colors, cols, rows - 1, tailCol, tail, palette.dim);
  return grid(chars, colors, cols, rows);
}

function sparklineFrame(points: readonly TerminalChartPoint[], width: number, palette: ChartColors): CellGrid {
  const cols = Math.max(8, Math.floor(width)), chars = Array(cols).fill(" "), colors: Array<string | null> = Array(cols).fill(null);
  const values = finite(points), levels = [..."▁▂▃▄▅▆▇█"];
  if (!values.length) return grid(chars, colors, cols, 1);
  const min = Math.min(...values.map((point) => point.value)), max = Math.max(...values.map((point) => point.value)), span = Math.max(0.0001, max - min);
  const sampled = values.slice(-cols);
  sampled.forEach((point, index) => {
    chars[index] = levels[Math.round((point.value - min) / span * (levels.length - 1))]!;
    colors[index] = point.state === "fail" ? palette.red : palette.green;
  });
  return grid(chars, colors, cols, 1);
}

export function TerminalLineChart({ height, points, title, width }: {
  height: number;
  points: readonly TerminalChartPoint[];
  title: string;
  width: number;
}) {
  const palette = useTerminalPalette(), rows = Math.max(2, Math.floor(height));
  const extent = points.length > 1 ? ` · ${points[0]!.label}→${points.at(-1)!.label}` : "";
  if (width < 32 || rows < 5) return <box width={width} height={rows} flexDirection="column" overflow="hidden">
    <text fg={palette.muted}>{fitText(`${title}${extent}`, width)}</text>
    <glyphSurface frame={sparklineFrame(points, width, palette)} width={Math.max(8, Math.floor(width))} height={1} />
    {rows > 2 ? <text><span fg={palette.green}>● pass</span>  <span fg={palette.red}>● fail</span></text> : null}
  </box>;
  const chartRows = rows - 2;
  return <box width={width} height={rows} flexDirection="column" overflow="hidden">
    <text fg={palette.muted}>{fitText(`${title}${extent}`, width)}</text>
    <glyphSurface frame={terminalLineChartFrame(points, width, chartRows, palette)} width={Math.floor(width)} height={chartRows} />
    <text><span fg={palette.green}>● passing path</span>  <span fg={palette.red}>● failing path</span></text>
  </box>;
}
