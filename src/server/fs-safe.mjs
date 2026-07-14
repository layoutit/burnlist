import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export function atomicDirectory(parent, id, files, { replace = false, preserveExisting = false } = {}) {
  mkdirSync(parent, { recursive: true });
  const temporary = join(parent, `.${id}.${randomBytes(8).toString("hex")}`);
  const target = join(parent, id);
  if (existsSync(target) && !replace) throw new Error(`${id} already exists.`);
  mkdirSync(temporary);
  try {
    if (preserveExisting && existsSync(target)) cpSync(target, temporary, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(temporary, name), contents);
    }
    if (!replace || !existsSync(target)) {
      renameSync(temporary, target);
      return target;
    }
    const previous = join(parent, `.${id}.old.${randomBytes(8).toString("hex")}`);
    renameSync(target, previous);
    try {
      renameSync(temporary, target);
    } catch (error) {
      try { renameSync(previous, target); } catch { /* The caller receives the original failure. */ }
      throw error;
    }
    try { rmSync(previous, { recursive: true, force: true }); } catch { /* Best-effort cleanup. */ }
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return target;
}
