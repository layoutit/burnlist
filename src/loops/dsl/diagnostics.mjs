export const MAX_DIAGNOSTICS = 100;

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function sortDiagnostics(items) {
  return [...items].sort((left, right) =>
    compareUtf8(left.path, right.path) || left.byteOffset - right.byteOffset ||
    compareUtf8(left.code, right.code) || compareUtf8(left.message, right.message));
}

export function finalizeDiagnostics(items) {
  const sorted = sortDiagnostics(items);
  if (sorted.length <= MAX_DIAGNOSTICS) return sorted;
  return sortDiagnostics([...sorted.slice(0, MAX_DIAGNOSTICS - 1), {
    path: "", byteOffset: 0, code: "E_TOO_MANY_DIAGNOSTICS",
    message: "Too many diagnostics (maximum 100)",
  }]);
}

/** A closed, bounded Loop diagnostic accumulator. */
export function createDiagnostics() {
  const values = [];
  return {
    add(path, byteOffset, code, message) {
      values.push({ path, byteOffset, code, message });
    },
    get list() {
      return finalizeDiagnostics(values);
    },
    get all() { return [...values]; },
  };
}

export function renderDiagnostics(items) {
  return sortDiagnostics(items).map(({ path, byteOffset, code, message }) =>
    `${path}:${byteOffset}: ${code}: ${message}\n`).join("");
}
