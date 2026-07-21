import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ovenId, normalizeOvenPackage, ovenRevision } from "../ovens/oven-contract.mjs";
import { atomicDirectory, withOvenPackageLock } from "./fs-safe.mjs";

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

function assertVendoredOvenPath(repoRoot, id) {
  const root = vendoredOvensDir(repoRoot);
  const path = vendoredOvenPath(repoRoot, id);
  const repo = nearestRealPath(resolve(repoRoot));
  const realRoot = nearestRealPath(root);
  const realPath = nearestRealPath(path);
  if (!isWithin(resolve(root), resolve(path)) || !isWithin(repo, realRoot) || !isWithin(realRoot, realPath)) {
    throw new Error(`Vendored Oven path escapes ${root}: ${path}`);
  }
  return path;
}

function readFileIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function validatePin(pin, pkg) {
  const expectedKeys = ["id", "version", "revision", "source", "pinnedAt"];
  if (!pin || typeof pin !== "object" || Array.isArray(pin)
    || Object.keys(pin).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(pin, key))) {
    throw new Error("Vendored Oven pin is invalid.");
  }
  const revision = ovenRevision(pkg);
  if (pin.id !== pkg.id || pin.version !== pkg.version || pin.revision !== revision
    || typeof pin.source !== "string" || !pin.source
    || typeof pin.pinnedAt !== "string" || new Date(pin.pinnedAt).toISOString() !== pin.pinnedAt) {
    throw new Error(`Vendored Oven ${pkg.id} pin does not match its source.`);
  }
  return pin;
}

function readOvenPackageDir(root, id) {
  const safeId = ovenId(id);
  const directory = join(root, safeId);
  const instructions = readFileIfPresent(join(directory, "instructions.md"));
  const oven = readFileIfPresent(join(directory, `${safeId}.oven`));
  if (instructions === null || oven === null) return null;
  const pkg = normalizeOvenPackage({ id: safeId, instructions, oven });
  return { id: safeId, instructions, oven, version: pkg.version, revision: ovenRevision({ id: safeId, instructions, oven }) };
}

export function vendoredOvensDir(repoRoot) {
  return join(resolve(repoRoot), ".burnlist", "ovens");
}

export function vendoredOvenPath(repoRoot, id) {
  return join(vendoredOvensDir(repoRoot), ovenId(id));
}

export function readVendoredOven(repoRoot, id) {
  const safeId = ovenId(id);
  const directory = assertVendoredOvenPath(repoRoot, safeId);
  const instructions = readFileIfPresent(join(directory, "instructions.md"));
  const oven = readFileIfPresent(join(directory, `${safeId}.oven`));
  const pinText = readFileIfPresent(join(directory, "pin.json"));
  if (instructions === null || oven === null || pinText === null) return null;
  let pin;
  try {
    pin = JSON.parse(pinText);
  } catch (error) {
    throw new Error(`Vendored Oven ${safeId} pin is invalid: ${error.message}`);
  }
  const normalized = normalizeOvenPackage({ id: safeId, instructions, oven });
  const pkg = { id: safeId, instructions, oven, version: normalized.version };
  const revision = ovenRevision(pkg);
  return { ...pkg, revision, pin: validatePin(pin, pkg) };
}

export function writeVendoredOven(repoRoot, { id, instructions, oven, source = "built-in", now } = {}) {
  const safeId = ovenId(id);
  const normalized = normalizeOvenPackage({ id: safeId, instructions, oven });
  if (typeof source !== "string" || !source) throw new Error("Vendored Oven source must be a non-empty string.");
  const pkg = { id: safeId, instructions, oven, version: normalized.version };
  const revision = ovenRevision(pkg);
  const pin = {
    id: safeId,
    version: normalized.version,
    revision,
    source,
    pinnedAt: (now ?? new Date()).toISOString(),
  };
  const root = vendoredOvensDir(repoRoot);
  mkdirSync(root, { recursive: true });
  assertVendoredOvenPath(repoRoot, safeId);
  withOvenPackageLock(root, safeId, () => atomicDirectory(root, safeId, {
    "instructions.md": instructions,
    [`${safeId}.oven`]: oven,
    "pin.json": `${JSON.stringify(pin, null, 2)}\n`,
  }, { replace: true }));
  return { ...pkg, revision, pin };
}

export function resolveOvenForRepo({ repoRoot, builtInOvensDir, customOvensDir, id } = {}) {
  const vendored = readVendoredOven(repoRoot, id);
  if (vendored) return vendored;
  return readOvenPackageDir(builtInOvensDir, id) ?? readOvenPackageDir(customOvensDir, id);
}
