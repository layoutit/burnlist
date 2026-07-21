import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { repoStateDir } from "./repo-state.mjs";

export const OVEN_INSTRUCTIONS_MAX_BYTES = 65_536;
export const OVEN_SOURCE_MAX_BYTES = 131_072;
// Retained during the staged migration for legacy readers outside this module.
export const OVEN_DETAIL_MAX_BYTES = OVEN_SOURCE_MAX_BYTES;
export const OVEN_LINEAGE_MAX_BYTES = OVEN_SOURCE_MAX_BYTES;

function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === ""
    || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

function nearestRealPath(path) {
  const suffix = [];
  let current = resolve(path);
  while (true) {
    try {
      return resolve(realpathSync(current), ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      suffix.push(basename(current));
      current = parent;
    }
  }
}

function optionalLstat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function escapeError(root) {
  return new Error(`Custom Oven storage escapes repo state ${repoStateDir(root)}.`);
}

export function assertCustomOvensDirContained(repoRoot, ovensDir) {
  const repo = nearestRealPath(repoRoot);
  const realState = nearestRealPath(repoStateDir(repoRoot));
  const realOvens = nearestRealPath(ovensDir);
  if (!isWithin(repo, realState) || !isWithin(realState, realOvens)) throw escapeError(repoRoot);
  return ovensDir;
}

export function resolveCustomOvensDir(repoRoot, override, { unsafe = false } = {}) {
  const ovensDir = override === undefined ? join(repoStateDir(repoRoot), "ovens") : resolve(repoRoot, override);
  assertCustomOvensDir(repoRoot, ovensDir, { unsafe });
  return ovensDir;
}

export function assertCustomOvensDir(repoRoot, ovensDir, { unsafe = false } = {}) {
  const rootEntry = optionalLstat(ovensDir);
  if (rootEntry && !rootEntry.isDirectory() && !rootEntry.isSymbolicLink()) {
    throw new Error(`Custom Oven storage is not a directory: ${ovensDir}.`);
  }
  if (!unsafe) assertCustomOvensDirContained(repoRoot, ovensDir);
  return ovensDir;
}

export function assertCustomOvenPath(repoRoot, ovensDir, id, { unsafe = false } = {}) {
  const path = join(ovensDir, id);
  assertCustomOvensDir(repoRoot, ovensDir, { unsafe });
  const rootEntry = optionalLstat(ovensDir);
  const ovenEntry = optionalLstat(path);
  if (ovenEntry && !ovenEntry.isDirectory() && !ovenEntry.isSymbolicLink()) {
    throw new Error(`Custom Oven ${id} is not a directory: ${path}.`);
  }
  if (rootEntry && ovenEntry) {
    const realRoot = realpathSync(ovensDir);
    const realOven = realpathSync(path);
    if (!isWithin(realRoot, realOven)) throw new Error(`Custom Oven ${id} escapes ${ovensDir}.`);
  }
  return path;
}

export function serializeOvenPackage({ id, instructions, oven, sidecar } = {}) {
  const files = {
    "instructions.md": `${instructions}\n`,
    [`${id}.oven`]: `${String(oven).replace(/[\r\n]+$/u, "")}\n`,
    ...(sidecar ? { "oven.json": `${JSON.stringify(sidecar, null, 2)}\n` } : {}),
  };
  assertOvenPackageFileLimits(files, id);
  return files;
}

export function assertOvenPackageFileLimits(files, id) {
  const limits = {
    "instructions.md": OVEN_INSTRUCTIONS_MAX_BYTES,
    [`${id}.oven`]: OVEN_SOURCE_MAX_BYTES,
    "oven.json": OVEN_LINEAGE_MAX_BYTES,
  };
  for (const [name, maxBytes] of Object.entries(limits)) {
    if (files[name] === undefined) continue;
    const bytes = Buffer.byteLength(files[name], "utf8");
    if (bytes > maxBytes) throw new Error(`Oven ${name} is ${bytes} bytes, over the ${maxBytes} byte limit.`);
  }
}
