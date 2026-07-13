import { readFileSync, statSync } from "node:fs";

export function readTextFileWithLimit(path, maxBytes, label) {
  const stat = statSync(path);
  if (stat.size > maxBytes) throw new Error(`${label} is ${stat.size} bytes, over the ${maxBytes} byte limit`);
  return readFileSync(path, "utf8");
}

export function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
