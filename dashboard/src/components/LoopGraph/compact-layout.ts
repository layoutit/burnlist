import type { LoopGraphProjection } from "./LoopGraph";
import { loopPrimaryPath, loopSymbols } from "./loop-symbols";

type Position = { x: number; y: number };

function drawing(rows: number, columns: number) {
  const cells = Array.from({ length: rows }, () => Array(columns).fill(" "));
  const lineMasks = Array.from({ length: rows }, () => Array(columns).fill(0));
  const glyphs: Record<number, string> = {
    1: "│", 2: "─", 3: "└", 4: "│", 5: "│", 6: "┌", 7: "├",
    8: "─", 9: "┘", 10: "─", 11: "┴", 12: "┐", 13: "┤", 14: "┬", 15: "┼",
  };
  const put = (x: number, y: number, value: string) => {
    if (x >= 0 && x < columns && y >= 0 && y < rows) {
      cells[y][x] = value;
      lineMasks[y][x] = 0;
    }
  };
  const connect = (x: number, y: number, mask: number) => {
    if (x < 0 || x >= columns || y < 0 || y >= rows || !mask) return;
    lineMasks[y][x] |= mask;
    cells[y][x] = glyphs[lineMasks[y][x]];
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
  return { cells, put, text, horizontal, vertical };
}

type CompactOptions = { showLabels?: boolean; symbols?: Record<string, string> };

function fanoutCompact(run: LoopGraphProjection, options: CompactOptions) {
  const planner = run.graph.nodes.find((node) => node.role === "planner" || node.role === "orchestrator");
  if (!planner) return null;
  const outgoing = (id: string) => run.graph.edges.filter((edge) => edge.from === id);
  const starts = outgoing(planner.id);
  if (starts.length < 2) return null;
  const reachable = (start: string) => {
    const seen = new Set<string>(), queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      outgoing(id).filter((edge) => edge.to !== planner.id).forEach((edge) => queue.push(edge.to));
    }
    return seen;
  };
  const maps = starts.map((edge) => reachable(edge.to));
  const common = run.graph.nodes.find((node) => maps.every((map) => map.has(node.id)));
  if (!common) return null;
  const paths = starts.map((edge) => {
    const path = [edge.to];
    while (path.at(-1) !== common.id) {
      const next = outgoing(path.at(-1)!).find((candidate) => candidate.to !== planner.id);
      if (!next || path.includes(next.to)) return [];
      path.push(next.to);
    }
    return path.slice(0, -1);
  });
  if (paths.some((path) => !path.length)) return null;
  const tail = [common.id];
  while (true) {
    const next = outgoing(tail.at(-1)!).find((edge) => !tail.includes(edge.to) && edge.to !== planner.id);
    if (!next) break;
    tail.push(next.to);
  }
  const symbols = loopSymbols(run.graph.nodes, options.symbols);
  const branchStep = options.showLabels ? 22 : 14;
  const centers = paths.map((_, index) => index * branchStep);
  const center = Math.round((centers[0] + centers.at(-1)!) / 2);
  const maxDepth = Math.max(...paths.map((path) => path.length));
  const commonY = 5 + maxDepth * 3;
  const positions = new Map<string, Position>([[planner.id, { x: center, y: 0 }]]);
  paths.forEach((path, column) => path.forEach((id, row) =>
    positions.set(id, { x: centers[column], y: 4 + row * 3 })));
  tail.forEach((id, row) => positions.set(id, { x: center, y: commonY + row * 3 }));
  const feedback = run.graph.edges.filter((edge) => edge.to === planner.id && positions.has(edge.from));
  const labelClearance = options.showLabels
    ? Math.max(...run.graph.edges.map((edge) => edge.on.length), 0) + 5
    : 4;
  const columns = centers.at(-1)! + labelClearance + 2 + feedback.length * 2;
  const rows = commonY + tail.length * 3 + 2;
  const graph = drawing(rows, columns);
  for (const [id, position] of positions) graph.text(position.x, position.y, symbols.get(id)!);
  graph.vertical(center, 1, 2);
  graph.horizontal(centers[0], centers.at(-1)!, 2);
  centers.forEach((branchCenter) => {
    graph.vertical(branchCenter, 2, 3);
    graph.put(branchCenter, 3, "▼");
  });
  if (options.showLabels) starts.forEach((edge, index) =>
    graph.text(centers[index] + 2, 3, edge.on));
  paths.forEach((path, column) => {
    const branchCenter = centers[column];
    for (let index = 1; index < path.length; index += 1) {
      const from = positions.get(path[index - 1])!, to = positions.get(path[index])!;
      graph.vertical(branchCenter, from.y + 1, to.y - 1);
      graph.put(branchCenter, to.y - 1, "▼");
      if (options.showLabels) {
        const edge = run.graph.edges.find((candidate) =>
          candidate.from === path[index - 1] && candidate.to === path[index]);
        if (edge) graph.text(branchCenter + 2, from.y + 1, edge.on);
      }
    }
    const from = positions.get(path.at(-1)!)!, mergeY = commonY - 2;
    graph.vertical(branchCenter, from.y + 1, mergeY);
    graph.horizontal(branchCenter, center, mergeY);
    if (options.showLabels) {
      const edge = run.graph.edges.find((candidate) =>
        candidate.from === path.at(-1) && candidate.to === common.id);
      if (edge) graph.text(branchCenter + 2, from.y + 1, edge.on);
    }
  });
  graph.vertical(center, commonY - 2, commonY - 1);
  graph.put(center, commonY - 1, "▼");
  for (let index = 1; index < tail.length; index += 1) {
    const from = positions.get(tail[index - 1])!, to = positions.get(tail[index])!;
    graph.vertical(center, from.y + 1, to.y - 1);
    graph.put(center, to.y - 1, "▼");
    if (options.showLabels) {
      const edge = run.graph.edges.find((candidate) =>
        candidate.from === tail[index - 1] && candidate.to === tail[index]);
      if (edge) graph.text(center + 2, from.y + 1, edge.on);
    }
  }
  feedback.forEach((edge, index) => {
    const from = positions.get(edge.from)!, railX = centers.at(-1)! + labelClearance + index * 2;
    graph.horizontal(from.x + 2, railX, from.y);
    graph.vertical(railX, 0, from.y);
    graph.horizontal(center + 2, railX, 0);
    graph.put(center + 2, 0, "◀");
    if (options.showLabels) graph.text(from.x + 2, from.y, edge.on);
  });
  return {
    lines: graph.cells.map((line) => line.join("").trimEnd())
      .filter((line, index, lines) => line.length || lines.slice(index + 1).some(Boolean)),
    positions,
  };
}

export function layoutCompactLoop(run: LoopGraphProjection, options: CompactOptions = {}) {
  const fanout = fanoutCompact(run, options);
  if (fanout) return fanout;
  const path = loopPrimaryPath(run.graph);
  const symbols = loopSymbols(run.graph.nodes, options.symbols);
  const primaryEdges = path.slice(0, -1).map((from, index) =>
    run.graph.edges.find((edge) => edge.from === from && edge.to === path[index + 1])!);
  const positions = new Map<string, Position>();
  let cursor = 0;
  path.forEach((id, index) => {
    positions.set(id, { x: cursor, y: 0 });
    const edge = primaryEdges[index];
    if (edge) cursor += options.showLabels ? edge.on.length + 7 : 6;
  });
  const primary = new Set(path.slice(0, -1).map((from, index) => `${from}\0${path[index + 1]}`));
  const alternate = run.graph.edges.filter((edge) => !primary.has(`${edge.from}\0${edge.to}`));
  const backwards = alternate.filter((edge) => {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    return from && to && to.x < from.x;
  });
  const branches = alternate.filter((edge) => !backwards.includes(edge));
  const branchStart = 2 + backwards.length * 2;
  const columns = Math.max(1, cursor + 2, ...branches.map((edge) =>
    (positions.get(edge.from)?.x ?? 0) + (options.showLabels ? edge.on.length + 8 : 8)));
  const rows = Math.max(1, branchStart + branches.length * 3);
  const graph = drawing(rows, columns);

  path.forEach((id, index) => {
    const position = positions.get(id)!;
    graph.text(position.x, 0, symbols.get(id)!);
    if (index === 0) return;
    const previous = positions.get(path[index - 1])!;
    graph.horizontal(previous.x + 2, position.x - 2, 0);
    graph.put(position.x - 2, 0, "▶");
    if (options.showLabels) graph.text(previous.x + 3, 0, primaryEdges[index - 1].on);
  });

  backwards.forEach((edge, index) => {
    const from = positions.get(edge.from)!, to = positions.get(edge.to)!;
    const rail = 2 + index * 2;
    graph.vertical(from.x, 1, rail);
    graph.horizontal(to.x, from.x, rail);
    graph.vertical(to.x, 1, rail);
    graph.put(to.x, 1, "▲");
    if (options.showLabels) graph.text(to.x + 2, rail, edge.on);
  });

  branches.forEach((edge, index) => {
    const from = positions.get(edge.from);
    if (!from) return;
    const existingTarget = positions.get(edge.to);
    if (existingTarget) {
      const rail = Math.max(from.y + 1, branchStart + index * 2);
      graph.vertical(from.x, from.y + 1, rail);
      graph.horizontal(from.x, existingTarget.x, rail);
      graph.vertical(existingTarget.x, 1, rail);
      graph.put(existingTarget.x, 1, "▲");
      if (options.showLabels) graph.text(Math.min(from.x, existingTarget.x) + 2, rail, edge.on);
      return;
    }
    const y = branchStart + index * 3 + 2;
    const distance = options.showLabels ? edge.on.length + 5 : 6;
    const x = Math.min(columns - 1, from.x + distance);
    positions.set(edge.to, { x, y: y - 1 });
    graph.vertical(from.x, 1, y - 1);
    graph.horizontal(from.x, x - 2, y - 1);
    graph.put(x - 2, y - 1, "▶");
    graph.text(x, y - 1, symbols.get(edge.to)!);
    if (options.showLabels) graph.text(from.x + 2, y - 1, edge.on);
  });

  return {
    lines: graph.cells.map((line) => line.join("").trimEnd())
      .filter((line, index, lines) => line.length || lines.slice(index + 1).some(Boolean)),
    positions,
  };
}
