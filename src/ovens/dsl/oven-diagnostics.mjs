export const MAX_DIAGNOSTICS = 100;

export function diagnostics(file = "<oven>") {
  const list = [];
  return {
    list,
    add(code, message, node = {}) {
      if (list.length >= MAX_DIAGNOSTICS) return;
      const span = node.span ?? node;
      list.push({ code, message, file, line: span.line ?? 1, column: span.column ?? 1, path: node.path ?? "" });
    },
  };
}

export function nodePath(node) {
  const names = [];
  for (let current = node; current; current = current.parent) names.unshift(current.name);
  return `/${names.join("/")}`;
}
