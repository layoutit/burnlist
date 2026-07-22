import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ovenId, normalizeOvenPackage, ovenRevision } from "../ovens/oven-contract.mjs";
import {
  assertSupportedOvenRuntime,
  LEGACY_OVEN_RUNTIME_COMPATIBILITY,
  OVEN_RUNTIME_COMPATIBILITY,
} from "../ovens/oven-runtime-compatibility.mjs";
import { atomicDirectory, readTextFileWithLimit, withOvenPackageLock } from "./fs-safe.mjs";
import { assertOvenPackageFileLimits, OVEN_INSTRUCTIONS_MAX_BYTES, OVEN_SOURCE_MAX_BYTES } from "./oven-storage.mjs";

export const OVEN_PIN_MAX_BYTES = 16_384;

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

function optionalEntry(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertPlainDirectory(path) {
  const entry = optionalEntry(path);
  if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
    throw new Error(`Vendored Oven path contains a non-directory or symbolic link: ${path}`);
  }
}

function assertPlainFile(path) {
  const entry = optionalEntry(path);
  if (entry?.isSymbolicLink()) throw new Error(`Vendored Oven path contains a symbolic link: ${path}`);
}

function sameEntry(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
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
  const state = join(resolve(repoRoot), ".burnlist");
  assertPlainDirectory(state);
  assertPlainDirectory(root);
  assertPlainDirectory(path);
  for (const name of ["instructions.md", `${id}.oven`, "pin.json"]) assertPlainFile(join(path, name));
  return path;
}

function ensureVendoredOvensDir(repoRoot, id) {
  const state = join(resolve(repoRoot), ".burnlist");
  const root = vendoredOvensDir(repoRoot);
  assertVendoredOvenPath(repoRoot, id);
  for (const directory of [state, root]) {
    if (!optionalEntry(directory)) {
      try {
        mkdirSync(directory);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    assertVendoredOvenPath(repoRoot, id);
  }
  return root;
}

function vendoredPathGuard(repoRoot, id) {
  const state = join(resolve(repoRoot), ".burnlist");
  const root = vendoredOvensDir(repoRoot);
  assertVendoredOvenPath(repoRoot, id);
  const expectedState = lstatSync(state);
  const expectedRoot = lstatSync(root);
  return () => {
    assertVendoredOvenPath(repoRoot, id);
    const currentState = lstatSync(state);
    const currentRoot = lstatSync(root);
    if (!sameEntry(expectedState, currentState) || !sameEntry(expectedRoot, currentRoot)) {
      throw new Error(`Vendored Oven storage changed while it was in use: ${root}`);
    }
  };
}

function vendoredReadGuard(repoRoot, id) {
  const state = join(resolve(repoRoot), ".burnlist");
  const root = vendoredOvensDir(repoRoot);
  const directory = vendoredOvenPath(repoRoot, id);
  assertVendoredOvenPath(repoRoot, id);
  const paths = [state, root, directory];
  const expected = paths.map(optionalEntry);
  if (expected.some((entry) => !entry)) return null;
  return () => {
    assertVendoredOvenPath(repoRoot, id);
    const current = paths.map((path) => lstatSync(path));
    if (current.some((entry, index) => !sameEntry(expected[index], entry))) {
      throw new Error(`Vendored Oven package changed while it was being read: ${directory}`);
    }
  };
}

function readFileIfPresent(path, maxBytes, label, assertPath) {
  try {
    return readTextFileWithLimit(path, maxBytes, label, { assertPath });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function validatePin(pin, pkg) {
  const legacyKeys = ["id", "version", "revision", "source", "pinnedAt"];
  const expectedKeys = [...legacyKeys, "runtimeCompatibility"];
  const keys = pin && typeof pin === "object" && !Array.isArray(pin) ? Object.keys(pin) : [];
  const current = keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(pin, key));
  const legacy = keys.length === legacyKeys.length && legacyKeys.every((key) => Object.hasOwn(pin, key));
  if (!pin || typeof pin !== "object" || Array.isArray(pin)
    || (!current && !legacy)) {
    throw new Error("Vendored Oven pin is invalid.");
  }
  const revision = ovenRevision(pkg);
  if (pin.id !== pkg.id || pin.version !== pkg.version || pin.revision !== revision
    || typeof pin.source !== "string" || !pin.source
    || typeof pin.pinnedAt !== "string" || new Date(pin.pinnedAt).toISOString() !== pin.pinnedAt) {
    throw new Error(`Vendored Oven ${pkg.id} pin does not match its source.`);
  }
  const declaredCompatibility = legacy
    ? LEGACY_OVEN_RUNTIME_COMPATIBILITY
    : pin.runtimeCompatibility;
  const runtimeCompatibility = assertSupportedOvenRuntime(
    declaredCompatibility,
    `Vendored Oven ${pkg.id} runtimeCompatibility`,
  );
  return { ...pin, runtimeCompatibility };
}

function readOvenPackageDir(root, id) {
  const safeId = ovenId(id);
  const directory = join(root, safeId);
  const instructions = readFileIfPresent(join(directory, "instructions.md"), OVEN_INSTRUCTIONS_MAX_BYTES, "Oven instructions");
  const oven = readFileIfPresent(join(directory, `${safeId}.oven`), OVEN_SOURCE_MAX_BYTES, "Oven source");
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
  const assertPath = vendoredReadGuard(repoRoot, safeId);
  if (!assertPath) return null;
  const instructions = readFileIfPresent(
    join(directory, "instructions.md"), OVEN_INSTRUCTIONS_MAX_BYTES, "Vendored Oven instructions", assertPath,
  );
  const oven = readFileIfPresent(
    join(directory, `${safeId}.oven`), OVEN_SOURCE_MAX_BYTES, "Vendored Oven source", assertPath,
  );
  const pinText = readFileIfPresent(join(directory, "pin.json"), OVEN_PIN_MAX_BYTES, "Vendored Oven pin", assertPath);
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
  const result = { ...pkg, revision, pin: validatePin(pin, pkg) };
  assertPath();
  return result;
}

export function writeVendoredOven(repoRoot, {
  id,
  instructions,
  oven,
  source = "built-in",
  now,
  runtimeCompatibility = OVEN_RUNTIME_COMPATIBILITY,
} = {}) {
  const safeId = ovenId(id);
  const normalized = normalizeOvenPackage({ id: safeId, instructions, oven });
  if (typeof source !== "string" || !source) throw new Error("Vendored Oven source must be a non-empty string.");
  const compatibility = assertSupportedOvenRuntime(runtimeCompatibility);
  const pkg = { id: safeId, instructions, oven, version: normalized.version };
  assertOvenPackageFileLimits({ "instructions.md": instructions, [`${safeId}.oven`]: oven }, safeId);
  const revision = ovenRevision(pkg);
  const pin = {
    id: safeId,
    version: normalized.version,
    revision,
    source,
    runtimeCompatibility: compatibility,
    pinnedAt: (now ?? new Date()).toISOString(),
  };
  const pinText = `${JSON.stringify(pin, null, 2)}\n`;
  const pinBytes = Buffer.byteLength(pinText, "utf8");
  if (pinBytes > OVEN_PIN_MAX_BYTES) {
    throw new Error(`Vendored Oven pin is ${pinBytes} bytes, over the ${OVEN_PIN_MAX_BYTES} byte limit.`);
  }
  const root = ensureVendoredOvensDir(repoRoot, safeId);
  const assertPath = vendoredPathGuard(repoRoot, safeId);
  withOvenPackageLock(root, safeId, () => atomicDirectory(root, safeId, {
    "instructions.md": instructions,
    [`${safeId}.oven`]: oven,
    "pin.json": pinText,
  }, { replace: true, assertPath, createParent: false }), { assertPath, createRoot: false });
  return { ...pkg, revision, pin };
}

export function resolveOvenForRepo({ repoRoot, findOfficialOven, customOvensDir, id } = {}) {
  const safeId = ovenId(id);
  const vendored = readVendoredOven(repoRoot, id);
  if (vendored) return vendored;
  const official = typeof findOfficialOven === "function" ? findOfficialOven(safeId) : null;
  if (official && official.id !== safeId) throw new Error(`Official Oven resolver returned ${official.id} for ${safeId}.`);
  return official ?? readOvenPackageDir(customOvensDir, safeId);
}
