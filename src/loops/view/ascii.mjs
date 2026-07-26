const FORWARD = ["complete", "pass", "approve"];

function primaryPath(ir) {
  const path = [];
  const seen = new Set();
  let id = ir.entry;
  while (id && !seen.has(id)) {
    path.push(id);
    seen.add(id);
    const edge = FORWARD
      .map((outcome) => ir.edges.find((item) => item.from === id && item.on === outcome))
      .find(Boolean);
    id = edge?.to;
  }
  return path;
}

function title(id, node) {
  if (id === "start") return "START";
  if (node?.kind === "terminal" && node.state === "converged") return "BURN";
  return id.replaceAll("-", " ").toUpperCase();
}

function write(row, column, value) {
  for (let index = 0; index < value.length; index += 1) row[column + index] = value[index];
}

function horizontal(row, from, to) {
  for (let column = from; column <= to; column += 1) if (row[column] === " ") row[column] = "─";
}

/**
 * A compact vertical drawing. The primary success path owns the centre column;
 * bounded return edges share one rail per target so loops remain visible
 * without turning the CLI view into a wide edge table.
 */
export function renderLoopAscii(ir) {
  const path = primaryPath(ir);
  const index = new Map(path.map((id, position) => [id, position]));
  const nodes = new Map(ir.nodes.map((node) => [node.id, node]));
  const primary = new Set(path.slice(0, -1).map((from, position) => `${from}\0${path[position + 1]}`));
  const returns = ir.edges.filter((edge) => index.has(edge.from) && index.has(edge.to)
    && index.get(edge.to) < index.get(edge.from) && !primary.has(`${edge.from}\0${edge.to}`));
  const targets = [...new Set(returns.map((edge) => edge.to))];
  const names = path.map((id) => `[${title(id, nodes.get(id))}]`);
  const centre = 2;
  const railStart = Math.max(...names.map((name) => name.length), 12) + 18;
  const width = railStart + targets.length * 3 + 2;
  const rows = Array.from({ length: Math.max(1, path.length * 2 - 1) }, () => Array(width).fill(" "));

  path.forEach((id, position) => {
    const y = position * 2;
    write(rows[y], centre, names[position]);
    if (position + 1 < path.length) {
      const edge = ir.edges.find((item) => item.from === id && item.to === path[position + 1]);
      rows[y + 1][centre + 2] = "▼";
      write(rows[y + 1], centre + 4, edge?.on ?? "");
    }
  });

  targets.forEach((target, targetIndex) => {
    const rail = railStart + targetIndex * 3;
    const targetY = index.get(target) * 2;
    const grouped = returns.filter((edge) => edge.to === target);
    const lowest = Math.max(...grouped.map((edge) => index.get(edge.from) * 2));
    for (let y = targetY; y <= lowest; y += 1) if (rows[y][rail] === " ") rows[y][rail] = "│";
    horizontal(rows[targetY], centre + names[index.get(target)].length + 2, rail);
    rows[targetY][centre + names[index.get(target)].length + 1] = "◀";
    rows[targetY][rail] = "┐";
    for (const edge of grouped) {
      const y = index.get(edge.from) * 2;
      const label = ` ${edge.on} `;
      const start = Math.max(centre + names[index.get(edge.from)].length + 1, rail - label.length - 2);
      horizontal(rows[y], centre + names[index.get(edge.from)].length, rail);
      write(rows[y], start, label);
      rows[y][rail] = y === lowest ? "┘" : "┤";
    }
  });

  return rows.map((row) => row.join("").trimEnd()).join("\n");
}
