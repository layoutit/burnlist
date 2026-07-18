export function resolvePointer(payload, pointer) {
  if (pointer === "" || pointer === "/") return payload;
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;

  const segments = pointer.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let value = payload;
  for (const segment of segments) {
    if (value === null || value === undefined || (typeof value !== "object" && typeof value !== "function")) return undefined;
    if (!Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}
