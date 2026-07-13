// Box-drawing render helpers for the `burnlist oven` CLI.
// Draws an Oven's detail skeleton as a character canvas so an agent can see the
// layout it is describing. Section borders are accumulated as a per-cell direction
// bitmask, so shared edges between adjacent sections render as clean
// ├ ┤ ┬ ┴ ┼ junctions rather than doubled lines.
const DIR = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 };
const BOX_CHAR = {
  0: " ",
  1: "│",
  2: "│",
  3: "│",
  4: "─",
  5: "┘",
  6: "┐",
  7: "┤",
  8: "─",
  9: "└",
  10: "┌",
  11: "├",
  12: "─",
  13: "┴",
  14: "┬",
  15: "┼",
};

function truncate(text, width) {
  if (width <= 0) return "";
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function renderGrid(detail, cellWidth, cellHeight) {
  const { columns, rows, cells } = detail;
  const width = columns * cellWidth + 1;
  const height = rows * cellHeight + 1;
  const mask = new Map();
  const text = Array.from({ length: height }, () => Array(width).fill(" "));
  const addBit = (x, y, bit) => {
    const key = y * width + x;
    mask.set(key, (mask.get(key) ?? 0) | bit);
  };
  const horizontal = (x0, x1, y) => {
    for (let x = x0; x <= x1; x += 1) addBit(x, y, (x > x0 ? DIR.LEFT : 0) | (x < x1 ? DIR.RIGHT : 0));
  };
  const vertical = (y0, y1, x) => {
    for (let y = y0; y <= y1; y += 1) addBit(x, y, (y > y0 ? DIR.UP : 0) | (y < y1 ? DIR.DOWN : 0));
  };
  const writeText = (x, y, value) => {
    for (let index = 0; index < value.length && x + index < width; index += 1) text[y][x + index] = value[index];
  };

  for (const cell of cells) {
    const x0 = (cell.column - 1) * cellWidth;
    const y0 = (cell.row - 1) * cellHeight;
    const x1 = (cell.column - 1 + cell.columnSpan) * cellWidth;
    const y1 = (cell.row - 1 + cell.rowSpan) * cellHeight;
    horizontal(x0, x1, y0);
    horizontal(x0, x1, y1);
    vertical(y0, y1, x0);
    vertical(y0, y1, x1);
    const innerWidth = x1 - x0 - 3;
    const badge = cell.format && cell.format !== "plain" ? `${cell.widget}·${cell.format}` : cell.widget;
    const label = [cell.id, badge, cell.source || "·unbound"];
    for (let line = 0; line < label.length; line += 1) {
      const y = y0 + 1 + line;
      if (y >= y1) break;
      writeText(x0 + 2, y, truncate(label[line], innerWidth));
    }
  }

  const lines = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const bits = mask.get(y * width + x);
      row += bits ? BOX_CHAR[bits] : text[y][x];
    }
    lines.push(row.replace(/\s+$/u, ""));
  }
  return lines.join("\n");
}

export function sectionTable(detail) {
  const header = ["section", "widget", "format", "source", "cell", "span"];
  const rows = detail.cells.map((cell) => [
    cell.id,
    cell.widget,
    cell.format,
    cell.source || "(unbound)",
    `r${cell.row}c${cell.column}`,
    `${cell.rowSpan}×${cell.columnSpan}`,
  ]);
  const widths = header.map((label, index) => Math.max(label.length, ...rows.map((row) => row[index].length)));
  const line = (cols) => cols.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
  return [line(header), line(widths.map((width) => "─".repeat(width))), ...rows.map(line)].join("\n");
}
