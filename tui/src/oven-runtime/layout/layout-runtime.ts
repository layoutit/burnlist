import type { TerminalNode } from "../terminal-contract";

export type LayoutRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type LayoutCell = Readonly<{ path: string; kind: string; rect: LayoutRect; text?: string; collapsed?: boolean }>;
export type LayoutResult = Readonly<{ cells: readonly LayoutCell[]; scroll: Readonly<{ top: number; height: number; focusedVisible: boolean }> }>;
const positive = (value: unknown, fallback: number) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
const gap = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const inset = (node: TerminalNode) => node.kind === "box" || node.kind === "panel" ? 1 : 0;
const label = (node: TerminalNode) => node.kind === "text" && typeof node.attributes.text === "string" ? node.attributes.text : node.kind === "icon" && typeof node.attributes.name === "string" ? node.attributes.name : undefined;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
// The pinned Bun entrypoint omits OpenTUI's declared stringWidth export. This
// grapheme implementation handles the terminal sequences this renderer accepts.
const codepoints = (value: string) => [...value].map((part) => part.codePointAt(0)!);
const cellSize = (value: string) => { const points = codepoints(value); if (!points.length || points.every((point) => /\p{Mark}/u.test(String.fromCodePoint(point)))) return 0; const regional = points.filter((point) => point >= 0x1f1e6 && point <= 0x1f1ff); if (regional.length === 2 || points.includes(0x200d) || points.some((point) => point >= 0x1f300 && point <= 0x1faff)) return 2; return points.some((point) => /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(String.fromCodePoint(point))) ? 2 : 1; };
export const cellWidth = (value: string) => [...segmenter.segment(value)].reduce((total, part) => total + cellSize(part.segment), 0);
/** Clips by terminal cells, never UTF-16 code units. */
export function fitLayoutText(value: string, width: number): string {
  if (width <= 0) return "";
  const words = value.replace(/\s+/gu, " ").trim();
  if (cellWidth(words) <= width) return words;
  if (width === 1) return "…";
  let out = "", used = 0;
  for (const part of segmenter.segment(words)) { const size = cellSize(part.segment); if (used + size > width - 1) break; out += part.segment; used += size; }
  return `${out}…`;
}
const inner = (node: TerminalNode, rect: LayoutRect): LayoutRect => { const amount = inset(node); return { x: rect.x + amount, y: rect.y + amount, width: Math.max(0, rect.width - amount * 2), height: Math.max(0, rect.height - amount * 2) }; };
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const tracks = (space: number, count: number, between: number) => {
  const usable = Math.max(0, space - between * Math.max(0, count - 1)), base = Math.floor(usable / count), remainder = usable % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
};
const offsets = (sizes: readonly number[], start: number, between: number) => { let cursor = start; return sizes.map((size) => { const value = cursor; cursor += size + between; return value; }); };
function gridShape(node: TerminalNode, width: number) {
  const columns = positive(node.attributes.columns, 1), spacing = 0, narrow = columns > 1 && Math.floor(width / columns) <= 12;
  const count = narrow ? 1 : columns;
  const placements = node.children.map((child, index) => narrow ? { column: 1, row: index + 1, columnSpan: 1, rowSpan: 1 } : {
    column: Math.min(count, positive(child.attributes.column, (index % count) + 1)), row: positive(child.attributes.row, Math.floor(index / count) + 1),
    columnSpan: Math.min(count, positive(child.attributes.columnSpan, 1)), rowSpan: positive(child.attributes.rowSpan, 1),
  });
  const rows = Math.max(positive(node.attributes.rows, 1), ...placements.map((item) => item.row + item.rowSpan - 1));
  return { columns: count, rows, spacing, narrow, placements };
}
function measure(node: TerminalNode, width: number): number {
  if (node.kind === "text" || node.kind === "icon") return 1;
  const contentWidth = Math.max(0, width - inset(node) * 2), spacing = gap(node.attributes.gap);
  if (node.kind === "stack") {
    const row = node.attributes.direction === "row" && node.children.length > 1 && Math.floor(Math.max(0, contentWidth - spacing * (node.children.length - 1)) / node.children.length) >= 12;
    if (row) return Math.max(1, ...node.children.map((child) => measure(child, Math.max(1, Math.floor(contentWidth / node.children.length))))) + inset(node) * 2;
    return Math.max(1, sum(node.children.map((child) => measure(child, contentWidth))) + spacing * Math.max(0, node.children.length - 1) + inset(node) * 2);
  }
  if (node.kind === "grid") {
    const shape = gridShape(node, contentWidth), fixed = positive(node.attributes.rowHeight, 0);
    if (fixed) return fixed * shape.rows + spacing * Math.max(0, shape.rows - 1) + inset(node) * 2;
    const heights = Array.from({ length: shape.rows }, () => 1);
    node.children.forEach((child, index) => { const item = shape.placements[index]!, needed = Math.ceil(measure(child, Math.max(1, Math.floor(contentWidth / shape.columns))) / item.rowSpan); for (let row = item.row - 1; row < item.row - 1 + item.rowSpan; row += 1) heights[row] = Math.max(heights[row]!, needed); });
    return sum(heights) + spacing * Math.max(0, shape.rows - 1) + inset(node) * 2;
  }
  return Math.max(1, sum(node.children.map((child) => measure(child, contentWidth))) + spacing * Math.max(0, node.children.length - 1) + inset(node) * 2);
}
function place(node: TerminalNode, rect: LayoutRect, path: string, out: LayoutCell[], inheritedCollapse = false): void {
  const own = label(node), collapsed = inheritedCollapse || rect.width < 1 || rect.height < 1;
  out.push({ path, kind: node.kind, rect, ...(own === undefined ? {} : { text: fitLayoutText(own, rect.width) }), ...(collapsed ? { collapsed: true } : {}) });
  const content = inner(node, rect); if (!node.children.length || !content.width || !content.height) return;
  const spacing = gap(node.attributes.gap);
  if (node.kind === "stack") {
    const horizontal = node.attributes.direction === "row" && node.children.length > 1 && Math.floor(Math.max(0, content.width - spacing * (node.children.length - 1)) / node.children.length) >= 12;
    const sizes = horizontal ? tracks(content.width, node.children.length, spacing) : node.children.map((child) => measure(child, content.width));
    let cursor = horizontal ? content.x : content.y;
    node.children.forEach((child, index) => { const size = Math.min(sizes[index]!, horizontal ? content.x + content.width - cursor : content.y + content.height - cursor); place(child, horizontal ? { x: cursor, y: content.y, width: size, height: content.height } : { x: content.x, y: cursor, width: content.width, height: size }, `${path}/${index}`, out, inheritedCollapse || (node.attributes.direction === "row" && !horizontal)); cursor += size + spacing; });
    return;
  }
  if (node.kind === "grid") {
    const shape = gridShape(node, content.width), widths = tracks(content.width, shape.columns, shape.spacing), fixed = positive(node.attributes.rowHeight, 0);
    const heights = fixed ? Array.from({ length: shape.rows }, () => fixed) : Array.from({ length: shape.rows }, () => 1);
    if (!fixed) node.children.forEach((child, index) => { const item = shape.placements[index]!, needed = Math.ceil(measure(child, Math.max(1, widths[item.column - 1] ?? content.width)) / item.rowSpan); for (let row = item.row - 1; row < item.row - 1 + item.rowSpan; row += 1) heights[row] = Math.max(heights[row]!, needed); });
    const xs = offsets(widths, content.x, shape.spacing), ys = offsets(heights, content.y, shape.spacing);
    node.children.forEach((child, index) => { const item = shape.placements[index]!, x = xs[item.column - 1]!, y = ys[item.row - 1]!, width = sum(widths.slice(item.column - 1, item.column - 1 + item.columnSpan)) + shape.spacing * (item.columnSpan - 1), height = sum(heights.slice(item.row - 1, item.row - 1 + item.rowSpan)) + shape.spacing * (item.rowSpan - 1); place(child, { x, y, width: Math.min(width, content.x + content.width - x), height: Math.min(height, content.y + content.height - y) }, `${path}/${index}`, out, inheritedCollapse || shape.narrow); });
    return;
  }
  let y = content.y;
  node.children.forEach((child, index) => { const height = measure(child, content.width); place(child, { x: content.x, y, width: content.width, height }, `${path}/${index}`, out, inheritedCollapse); y += height + spacing; });
}
const clip = (rect: LayoutRect, top: number, bottom: number): LayoutRect | null => { const y = Math.max(rect.y, top), end = Math.min(rect.y + rect.height, bottom); return end > y ? { x: rect.x, y: y - top, width: rect.width, height: end - y } : null; };

/** Deterministic structural geometry, with a two-row footer reservation by default. */
export function layoutTerminalNodes(nodes: readonly TerminalNode[], viewport: Readonly<{ width: number; height: number }>, focusedPath?: string, footer = 2): LayoutResult {
  const width = Math.max(1, Math.floor(viewport.width)), height = Math.max(1, Math.floor(viewport.height)), available = Math.max(1, height - Math.max(0, footer)), all: LayoutCell[] = [];
  let y = 0; nodes.forEach((node, index) => { const nodeHeight = measure(node, width); place(node, { x: 0, y, width, height: nodeHeight }, `root/${index}`, all); y += nodeHeight; });
  const focused = focusedPath ? all.find((cell) => cell.path === focusedPath) : undefined, total = Math.max(available, y), desired = focused ? focused.rect.y - Math.floor((available - focused.rect.height) / 2) : 0, top = Math.max(0, Math.min(desired, total - available));
  const cells = all.flatMap((cell) => { const rect = clip(cell.rect, top, top + available); return rect ? [{ ...cell, rect }] : []; });
  const visible = !focused || focused.rect.y >= top && focused.rect.y + focused.rect.height <= top + available;
  return { cells, scroll: { top, height: available, focusedVisible: visible } };
}
