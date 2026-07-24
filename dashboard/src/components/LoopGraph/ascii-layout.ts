export type AsciiNode = {
  id: string;
  kind: string;
  role?: string;
  authority?: "write" | "read";
  capability?: string;
  gateKind?: string;
  measure?: "test" | "metric" | "eval" | "boolean";
  target?: string;
  execution?: null | { model: string; effort: string; authority: "write" | "read" };
};
export type AsciiEdge = { from: string; on: string; to: string };
export type AsciiGraph = { entry?: string; nodes: AsciiNode[]; edges: AsciiEdge[] };
export type AsciiLayout = { lines: string[]; current: { x: number; y: number; width: number } | null };

const preferred = ["complete", "measured", "pass", "target-met", "approve", "success"];

function nodeLabel(node: AsciiNode) {
  return `${node.id.toUpperCase()}${node.kind === "gate" ? "?" : ""}`;
}

function contentLine(left: string, right: string, value: string, width: number) {
  const content = value.slice(0, width - 4);
  return `${left} ${content.padEnd(width - 4)} ${right}`;
}

function nodeLines(node: AsciiNode, width: number) {
  const label = nodeLabel(node);
  if (node.kind === "gate") return [
    `/${"-".repeat(width - 2)}\\`,
    contentLine("<", ">", label, width),
    `\\${"-".repeat(width - 2)}/`,
  ];
  if (node.kind === "terminal") return [
    `/${"-".repeat(width - 2)}\\`,
    contentLine("|", "|", label, width),
    `\\${"-".repeat(width - 2)}/`,
  ];
  return [
    `+${"-".repeat(width - 2)}+`,
    contentLine("|", "|", label, width),
    `+${"-".repeat(width - 2)}+`,
  ];
}

function primaryPath(graph: AsciiGraph) {
  const entry = graph.entry ?? graph.nodes[0]?.id;
  if (!entry) return [];
  const result = [entry], seen = new Set(result);
  let cursor = entry;
  while (cursor) {
    const candidates = graph.edges.filter((edge) => edge.from === cursor && !seen.has(edge.to));
    candidates.sort((left, right) => {
      const rank = (edge: AsciiEdge) => {
        const value = preferred.indexOf(edge.on);
        return value < 0 ? preferred.length : value;
      };
      return rank(left) - rank(right) || left.on.localeCompare(right.on);
    });
    const edge = candidates[0];
    if (!edge) break;
    result.push(edge.to); seen.add(edge.to); cursor = edge.to;
  }
  return result;
}

function canvas(rows: number, columns: number) {
  const cells = Array.from({ length: rows }, () => Array(columns).fill(" "));
  const lineMasks = Array.from({ length: rows }, () => Array(columns).fill(0));
  const glyphs: Record<number, string> = {
    1: "│", 2: "─", 3: "└", 4: "│", 5: "│", 6: "┌", 7: "├",
    8: "─", 9: "┘", 10: "─", 11: "┴", 12: "┐", 13: "┤", 14: "┬", 15: "┼",
  };
  const put = (x: number, y: number, value: string) => {
    if (x < 0 || x >= columns || y < 0 || y >= rows) return;
    cells[y][x] = value;
    lineMasks[y][x] = 0;
  };
  const connect = (x: number, y: number, mask: number) => {
    if (x < 0 || x >= columns || y < 0 || y >= rows || !mask) return;
    lineMasks[y][x] |= mask;
    cells[y][x] = glyphs[lineMasks[y][x]];
  };
  const text = (x: number, y: number, value: string) => [...value].forEach((char, index) => put(x + index, y, char));
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
  return { cells, put, text, horizontal, vertical };
}

function fanoutLayout(graph: AsciiGraph, currentNode: string, columns: number, width: number): AsciiLayout | null {
  const planner = graph.nodes.find((node) => node.role === "planner" || node.role === "orchestrator");
  if (!planner) return null;
  const branchEdges = graph.edges.filter((edge) => edge.from === planner.id);
  if (branchEdges.length < 2 || width * branchEdges.length + 8 * (branchEdges.length - 1) > columns - 4) return null;
  const outgoing = (id: string) => graph.edges.filter((edge) => edge.from === id);
  const reachable = (start: string) => {
    const result = new Map<string, number>(), queue = [[start, 0] as const];
    while (queue.length) {
      const [id, depth] = queue.shift()!;
      if (result.has(id)) continue;
      result.set(id, depth);
      for (const edge of outgoing(id)) if (edge.to !== planner.id) queue.push([edge.to, depth + 1]);
    }
    return result;
  };
  const maps = branchEdges.map((edge) => reachable(edge.to));
  const common = graph.nodes
    .filter((node) => maps.every((map) => map.has(node.id)))
    .sort((left, right) => maps.reduce((sum, map) => sum + map.get(left.id)!, 0)
      - maps.reduce((sum, map) => sum + map.get(right.id)!, 0))[0];
  if (!common) return null;
  const branchPaths = branchEdges.map((edge) => {
    const path = [edge.to];
    while (path.at(-1) !== common.id) {
      const next = outgoing(path.at(-1)!).filter((candidate) => candidate.to !== planner.id)
        .sort((left, right) => (maps[0].get(left.to) ?? 999) - (maps[0].get(right.to) ?? 999))[0];
      if (!next || path.includes(next.to)) return [];
      path.push(next.to);
    }
    return path.slice(0, -1);
  });
  if (branchPaths.some((path) => !path.length)) return null;
  const tail = [common.id];
  while (true) {
    const next = outgoing(tail.at(-1)!).filter((edge) => !tail.includes(edge.to) && edge.to !== planner.id)
      .sort((left, right) => preferred.indexOf(right.on) - preferred.indexOf(left.on))[0];
    if (!next) break;
    tail.push(next.to);
  }
  const maxBranch = Math.max(...branchPaths.map((path) => path.length));
  const tailStart = 9 + maxBranch * 5;
  const rows = tailStart + tail.length * 5 + graph.edges.length * 2 + 4;
  const drawing = canvas(rows, columns), byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const positions = new Map<string, { x: number; y: number }>();
  const branchLeft = 2;
  const branchStep = (columns - 4 - width) / Math.max(1, branchPaths.length - 1);
  const branchXs = branchPaths.map((_, index) => Math.round(branchLeft + index * branchStep));
  const totalWidth = branchXs.at(-1)! + width - branchLeft;
  const plannerX = Math.floor((columns - width) / 2);
  positions.set(planner.id, { x: plannerX, y: 2 });
  branchPaths.forEach((path, column) => path.forEach((id, row) =>
    positions.set(id, { x: branchXs[column], y: 8 + row * 5 })));
  tail.forEach((id, row) => positions.set(id, { x: plannerX, y: tailStart + row * 5 }));
  for (const [id, position] of positions) {
    const lines = nodeLines(byId.get(id)!, width);
    drawing.text(position.x, position.y, lines[0]); drawing.text(position.x, position.y + 1, lines[1]);
    drawing.text(position.x, position.y + 2, lines[2]);
  }
  const plannerCenter = plannerX + Math.floor(width / 2), splitY = 6;
  const branchCenters = branchXs.map((x) => x + Math.floor(width / 2));
  drawing.vertical(plannerCenter, 5, splitY); drawing.horizontal(branchCenters[0], branchCenters.at(-1)!, splitY);
  branchEdges.forEach((edge, index) => {
    const center = branchCenters[index];
    drawing.vertical(center, splitY, 7); drawing.put(center, 7, "▼");
    drawing.text(center + 2, 7, edge.on);
  });
  drawing.put(plannerCenter, splitY, "┴");
  branchCenters.forEach((center, index) =>
    drawing.put(center, splitY, index === 0 ? "┌" : index === branchCenters.length - 1 ? "┐" : "┬"));
  branchPaths.forEach((path, column) => {
    const center = branchCenters[column];
    for (let index = 1; index < path.length; index += 1) {
      const from = positions.get(path[index - 1])!, to = positions.get(path[index])!;
      const edge = graph.edges.find((candidate) => candidate.from === path[index - 1] && candidate.to === path[index])!;
      drawing.vertical(center, from.y + 3, to.y - 1); drawing.put(center, to.y - 1, "▼");
      drawing.text(center + 2, from.y + 3, edge.on);
    }
    const last = path.at(-1)!, from = positions.get(last)!, join = positions.get(common.id)!;
    const edge = graph.edges.find((candidate) => candidate.from === last && candidate.to === common.id)!;
    const mergeY = join.y - 2;
    drawing.vertical(center, from.y + 3, mergeY); drawing.horizontal(center, plannerCenter, mergeY);
    drawing.put(center, mergeY, column === 0 ? "└" : column === branchPaths.length - 1 ? "┘" : "┴");
    drawing.text(center + 2, Math.min(mergeY, from.y + 3), edge.on);
  });
  drawing.vertical(plannerCenter, tailStart - 2, tailStart - 1); drawing.put(plannerCenter, tailStart - 1, "▼");
  drawing.put(plannerCenter, tailStart - 2, "┬");
  for (let index = 1; index < tail.length; index += 1) {
    const from = positions.get(tail[index - 1])!, to = positions.get(tail[index])!;
    const edge = graph.edges.find((candidate) => candidate.from === tail[index - 1] && candidate.to === tail[index])!;
    drawing.vertical(plannerCenter, from.y + 3, to.y - 1); drawing.put(plannerCenter, to.y - 1, "▼");
    drawing.text(plannerCenter + 2, from.y + 3, edge.on);
  }
  const feedback = graph.edges.filter((edge) => positions.has(edge.from) && edge.to === planner.id);
  feedback.forEach((edge, index) => {
    const from = positions.get(edge.from)!;
    const plannerPosition = positions.get(planner.id)!;
    const railX = Math.min(columns - 3, branchLeft + totalWidth + 4 + index * 2);
    const sourceY = from.y + 1 + index;
    drawing.horizontal(from.x + width, railX, sourceY);
    drawing.vertical(railX, plannerPosition.y + 1, sourceY);
    drawing.horizontal(plannerPosition.x + width, railX, plannerPosition.y + 1);
    drawing.put(plannerPosition.x + width, plannerPosition.y + 1, "◀");
    drawing.text(from.x + width + 2, sourceY, edge.on);
  });
  drawing.text(plannerX, 0, "INPUT");
  const active = positions.get(currentNode);
  return {
    lines: drawing.cells.map((line) => line.join("").trimEnd())
      .filter((line, index, lines) => line.length || lines.slice(index + 1).some(Boolean)),
    current: active ? { x: active.x, y: active.y, width } : null,
  };
}

export function layoutAsciiGraph(graph: AsciiGraph, currentNode: string, availableCharacters: number): AsciiLayout {
  if (!graph.nodes.length) return { lines: [], current: null };
  const columns = Math.max(36, Math.floor(availableCharacters));
  const desiredWidth = Math.max(...graph.nodes.map((node) => nodeLabel(node).length + 4));
  const width = Math.max(16, Math.min(24, columns - 8, desiredWidth));
  const fanout = fanoutLayout(graph, currentNode, columns, width);
  if (fanout) return fanout;
  const path = primaryPath(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const sideNodes = graph.nodes.filter((node) => !path.includes(node.id));
  const ordered = [...path, ...sideNodes.map((node) => node.id)];
  const usableColumns = Math.max(width, columns - 8);
  const perRow = Math.max(1, Math.min(3, Math.floor((usableColumns + 4) / (width + 4)), ordered.length));
  const gap = perRow > 1 ? Math.floor((usableColumns - perRow * width) / (perRow - 1)) : 0;
  const positions = new Map<string, { x: number; y: number }>();
  ordered.forEach((id, index) => {
    const row = Math.floor(index / perRow), offset = index % perRow;
    const count = Math.min(perRow, ordered.length - row * perRow);
    const visualColumn = row % 2 === 0 ? offset : count - offset - 1;
    positions.set(id, { x: 2 + visualColumn * (width + gap), y: 2 + row * 7 });
  });
  const rows = Math.max(...[...positions.values()].map((position) => position.y)) + 5 + graph.edges.length * 2;
  const drawing = canvas(rows, columns);
  for (const [id, position] of positions) {
    const rendered = nodeLines(byId.get(id)!, width);
    drawing.text(position.x, position.y, rendered[0]);
    drawing.text(position.x, position.y + 1, rendered[1]);
    drawing.text(position.x, position.y + 2, rendered[2]);
  }
  const primaryKeys = new Set<string>();
  for (let index = 0; index < path.length - 1; index += 1) {
    const edge = graph.edges.find((candidate) => candidate.from === path[index] && candidate.to === path[index + 1]);
    if (!edge) continue;
    primaryKeys.add(`${edge.from}\0${edge.on}\0${edge.to}`);
    const from = positions.get(edge.from)!, to = positions.get(edge.to)!;
    if (from.y === to.y) {
      const forward = from.x < to.x;
      const start = forward ? from.x + width : from.x - 1;
      const end = forward ? to.x - 1 : to.x + width;
      drawing.horizontal(start, end, from.y + 1);
      drawing.put(end, from.y + 1, forward ? "▶" : "◀");
      drawing.text(Math.min(start, end) + 1, from.y, edge.on.slice(0, Math.max(1, Math.abs(end - start) - 2)));
    } else {
      const fromCenter = from.x + Math.floor(width / 2), toCenter = to.x + Math.floor(width / 2);
      const turnY = from.y + 5;
      drawing.vertical(fromCenter, from.y + 3, turnY);
      drawing.horizontal(fromCenter, toCenter, turnY);
      drawing.vertical(toCenter, turnY, to.y - 1);
      drawing.put(toCenter, to.y - 1, "▼");
      drawing.text(Math.min(fromCenter, toCenter) + 1, turnY, edge.on);
    }
  }
  const alternate = graph.edges.filter((edge) => !primaryKeys.has(`${edge.from}\0${edge.on}\0${edge.to}`));
  const localRails = new Map<number, number>();
  alternate.forEach((edge, index) => {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (!from || !to) return;
    const fromCenter = from.x + Math.floor(width / 2), toCenter = to.x + Math.floor(width / 2);
    if (from.y === to.y) {
      const offset = localRails.get(from.y) ?? 0;
      localRails.set(from.y, offset + 1);
      const railY = from.y + 4 + offset;
      drawing.vertical(fromCenter, from.y + 3, railY);
      drawing.horizontal(fromCenter, toCenter, railY);
      drawing.vertical(toCenter, to.y + 3, railY);
      drawing.put(toCenter, to.y + 3, "▲");
      drawing.text(Math.min(fromCenter, toCenter) + 1, railY, edge.on);
      return;
    }
    const turnY = to.y - 1;
    drawing.vertical(fromCenter, from.y + 3, turnY);
    drawing.horizontal(fromCenter, toCenter, turnY);
    drawing.vertical(toCenter, turnY, to.y - 1);
    drawing.put(toCenter, to.y - 1, "▼");
    drawing.text(Math.min(fromCenter, toCenter) + 1, turnY, edge.on);
  });
  const entryPosition = positions.get(graph.entry ?? graph.nodes[0].id);
  if (entryPosition) drawing.text(entryPosition.x, 0, "INPUT");
  const active = positions.get(currentNode);
  return {
    lines: drawing.cells.map((line) => line.join("").trimEnd())
      .filter((line, index, lines) => line.length || lines.slice(index + 1).some(Boolean)),
    current: active ? { x: active.x, y: active.y, width } : null,
  };
}
