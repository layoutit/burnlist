import type { LoopRunProjection as LoopGraphProjection } from "../../lib/types";
import { loopSymbols } from "./loop-symbols";

type Position = { x: number; y: number };
type Options = { availableCharacters?: number; showLabels?: boolean; symbols?: Record<string, string> };

const glyphs: Record<number, string> = {
  1: "│", 2: "─", 3: "└", 4: "│", 5: "│", 6: "┌", 7: "├",
  8: "─", 9: "┘", 10: "─", 11: "┴", 12: "┐", 13: "┤", 14: "┬", 15: "┼",
};

function canvas(rows: number, columns: number) {
  const cells = Array.from({ length: rows }, () => Array(columns).fill(" "));
  const masks = Array.from({ length: rows }, () => Array(columns).fill(0));
  const put = (x: number, y: number, value: string) => {
    if (x < 0 || x >= columns || y < 0 || y >= rows) return;
    cells[y][x] = value; masks[y][x] = 0;
  };
  const connect = (x: number, y: number, mask: number) => {
    if (x < 0 || x >= columns || y < 0 || y >= rows) return;
    masks[y][x] |= mask; cells[y][x] = glyphs[masks[y][x]];
  };
  const horizontal = (from: number, to: number, y: number) => {
    const left = Math.min(from, to), right = Math.max(from, to);
    for (let x = left; x <= right; x += 1)
      connect(x, y, (x > left ? 8 : 0) | (x < right ? 2 : 0));
  };
  const vertical = (x: number, from: number, to: number) => {
    const top = Math.min(from, to), bottom = Math.max(from, to);
    for (let y = top; y <= bottom; y += 1)
      connect(x, y, (y > top ? 1 : 0) | (y < bottom ? 4 : 0));
  };
  const text = (x: number, y: number, value: string) =>
    [...value].forEach((character, index) => put(x + index, y, character));
  return { cells, put, horizontal, vertical, text };
}

function paddedLabel(value: string) {
  return ` ${value} `;
}

function placeHorizontalLabel(
  graph: ReturnType<typeof canvas>, from: number, to: number, y: number, value: string,
) {
  const label = paddedLabel(value);
  const left = Math.min(from, to), right = Math.max(from, to);
  const room = right - left - 3;
  if (room < label.length) return false;
  graph.text(left + Math.floor((right - left - label.length) / 2), y, label);
  return true;
}

/**
 * A small Sugiyama-style specialisation for the common workflow shape:
 * rank the success spine, wrap it into balanced serpentine rows, then route
 * backwards edges on destination-grouped orthogonal rails.
 */
export function layoutSerialCompact(
  run: LoopGraphProjection, path: string[], options: Options,
) {
  if (path.length < 6) return null;
  const pathIndex = new Map(path.map((id, index) => [id, index]));
  const primary = path.slice(0, -1).map((from, index) =>
    run.graph.edges.find((edge) => edge.from === from && edge.to === path[index + 1])!);
  const primaryKeys = new Set(primary.map((edge) => `${edge.from}\0${edge.to}`));
  const feedback = run.graph.edges.filter((edge) =>
    !primaryKeys.has(`${edge.from}\0${edge.to}`)
    && pathIndex.has(edge.from) && pathIndex.has(edge.to)
    && pathIndex.get(edge.to)! < pathIndex.get(edge.from)!);
  const other = run.graph.edges.filter((edge) =>
    !primaryKeys.has(`${edge.from}\0${edge.to}`) && !feedback.includes(edge));
  if (other.some((edge) => pathIndex.has(edge.from) || pathIndex.has(edge.to))) return null;

  const symbols = loopSymbols(run.graph.nodes, options.symbols);
  const labelWidth = options.showLabels
    ? Math.max(0, ...primary.map((edge) => edge.on.length)) : 0;
  const slot = Math.max(9, labelWidth + 9, ...path.map((id) => symbols.get(id)!.length + 7));
  const available = Math.max(24, options.availableCharacters ?? 72);
  const candidates = Array.from(
    { length: Math.max(1, Math.min(5, path.length) - 1) },
    (_, index) => index + 2,
  );
  const perRow = candidates.map((columns) => {
    const rows = Math.ceil(path.length / columns);
    const estimatedWidth = (columns - 1) * slot + 2;
    const estimatedHeight = rows * 5;
    const overflow = Math.max(0, estimatedWidth - available);
    const aspect = estimatedWidth / Math.max(1, estimatedHeight * 2);
    return {
      columns,
      score: overflow * 1_000
        + Math.abs(Math.log(Math.max(.01, aspect) / 2.2)) * 20
        + Math.abs(columns - 4) * 2 + rows * .15,
    };
  }).sort((left, right) => left.score - right.score || right.columns - left.columns)[0].columns;
  const rowCount = Math.ceil(path.length / perRow);
  const rowHeight = 4 + Math.max(0, ...Array.from({ length: rowCount }, (_, row) =>
    feedback.filter((edge) => Math.floor(pathIndex.get(edge.to)! / perRow) === row).length));
  const positions = new Map<string, Position>();
  path.forEach((id, index) => {
    const row = Math.floor(index / perRow), offset = index % perRow;
    const column = row % 2 ? perRow - offset - 1 : offset;
    positions.set(id, { x: column * slot, y: row * rowHeight });
  });
  const routedFeedback = [...feedback].sort((left, right) => {
    const leftFrom = positions.get(left.from)!, leftTo = positions.get(left.to)!;
    const rightFrom = positions.get(right.from)!, rightTo = positions.get(right.to)!;
    const leftSpan = Math.abs(leftFrom.x - leftTo.x);
    const rightSpan = Math.abs(rightFrom.x - rightTo.x);
    return leftSpan - rightSpan
      || rightTo.x - leftTo.x
      || pathIndex.get(left.from)! - pathIndex.get(right.from)!;
  });
  const width = Math.min(available, Math.max(...[...positions.values()].map((point) => point.x)) + slot);
  const graph = canvas(rowCount * rowHeight, width);

  primary.forEach((edge) => {
    const from = positions.get(edge.from)!, to = positions.get(edge.to)!;
    if (from.y === to.y) {
      const right = from.x < to.x;
      graph.horizontal(from.x + (right ? 2 : -2), to.x + (right ? -2 : 2), from.y);
      graph.put(to.x + (right ? -2 : 2), to.y, right ? "▶" : "◀");
      if (options.showLabels)
        placeHorizontalLabel(graph, from.x, to.x, from.y, edge.on);
    } else {
      graph.vertical(from.x, from.y + 1, to.y - 1);
      graph.put(to.x, to.y - 1, "▼");
      if (options.showLabels) graph.text(from.x + 2, from.y + 1, edge.on);
    }
  });

  const targetRowOffsets = new Map<number, number>();
  routedFeedback.forEach((edge) => {
    const from = positions.get(edge.from)!, to = positions.get(edge.to)!;
    const targetRow = Math.floor(pathIndex.get(edge.to)! / perRow);
    const offset = targetRowOffsets.get(targetRow) ?? 0;
    targetRowOffsets.set(targetRow, offset + 1);
    const feedbackY = to.y + 2 + offset;
    const fromAttachY = feedbackY < from.y ? from.y - 1 : from.y + 1;
    graph.vertical(from.x, Math.min(fromAttachY, feedbackY), Math.max(fromAttachY, feedbackY));
    graph.horizontal(to.x, from.x, feedbackY);
    graph.vertical(to.x, to.y + 1, feedbackY);
    graph.put(to.x, to.y + 1, "▲");
    if (options.showLabels)
      placeHorizontalLabel(graph, to.x, from.x, feedbackY, edge.on);
  });

  for (const [id, position] of positions) graph.text(position.x, position.y, symbols.get(id)!);
  return {
    lines: graph.cells.map((line) => line.join("").trimEnd())
      .filter((line, index, lines) => line.length || lines.slice(index + 1).some(Boolean)),
    positions,
  };
}
