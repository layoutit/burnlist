// Compact IR render helpers for the `burnlist oven` CLI.

function table(header, rows) {
  const widths = header.map((label, index) => Math.max(label.length, ...rows.map((row) => row[index].length)));
  const line = (columns) => columns.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
  return [line(header), line(widths.map((width) => "─".repeat(width))), ...rows.map(line)].join("\n");
}

function nodeName(node) {
  const attributes = ["id", "source", "prop", "value", "modeFrom", "collectionFrom", "selectionFrom"]
    .filter((key) => node.attributes[key] !== undefined)
    .map((key) => `${key}=${node.attributes[key]}`);
  return attributes.length ? `${node.kind} (${attributes.join(", ")})` : node.kind;
}

function walk(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    walk(node.children, visit);
  }
}

export function renderOvenTree(ir) {
  const lines = [];
  const render = (node, depth) => {
    lines.push(`${"  ".repeat(depth)}${nodeName(node)}`);
    for (const child of node.children) render(child, depth + 1);
  };
  for (const node of ir.root) render(node, 0);
  return lines.join("\n") || "(empty oven)";
}

export function sourceTable(ir) {
  const rows = [];
  walk(ir.root, (node) => {
    const name = node.attributes.id ? `${node.kind}#${node.attributes.id}` : node.kind;
    for (const [prop, source] of Object.entries(node.attributes)) {
      if (node.kind !== "bind" && (prop === "source" || prop.endsWith("Source"))) rows.push([name, prop, String(source)]);
    }
    for (const [prop, binding] of Object.entries(node.bindings)) rows.push([name, prop, binding.source]);
  });
  return table(["node", "prop", "source"], rows);
}
