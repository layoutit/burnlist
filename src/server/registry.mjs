import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { withDirectoryLock } from "./dir-lock.mjs";

export const REGISTRY_SCHEMA_VERSION = 1;

export class RegistryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

export function registryDir(home = os.homedir()) {
  return join(home, ".burnlist");
}

export function registryPath(home = os.homedir()) {
  return join(registryDir(home), "roots.json");
}

export function repoKey(canonicalRoot) {
  return createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 12);
}

function corrupt(path) {
  return new RegistryError(`Registry is corrupt: ${path}`, "EREGISTRYCORRUPT");
}

function validateRegistry(registry, path) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)
    || registry.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(registry.roots)
    || registry.roots.some((entry) => !entry || typeof entry !== "object"
      || Array.isArray(entry) || typeof entry.root !== "string" || !isAbsolute(entry.root)
      || entry.root !== resolve(entry.root) || typeof entry.repoKey !== "string"
      || !/^[0-9a-f]{12}$/.test(entry.repoKey) || entry.repoKey !== repoKey(entry.root))) {
    throw corrupt(path);
  }
  return registry;
}

function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeDurableAtomic(path, value) {
  const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, value);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

export function readRegistry({ home = os.homedir() } = {}) {
  const path = registryPath(home);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: REGISTRY_SCHEMA_VERSION, roots: [] };
    throw error;
  }
  try {
    return validateRegistry(JSON.parse(text), path);
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    throw corrupt(path);
  }
}

export function writeRegistry(registry, { home = os.homedir() } = {}) {
  const path = registryPath(home);
  validateRegistry(registry, path);
  const dir = registryDir(home);
  mkdirSync(dir, { recursive: true });
  const roots = [...new Map(registry.roots.map((entry) => [entry.root, entry])).values()]
    .sort((left, right) => left.root.localeCompare(right.root));
  writeDurableAtomic(path, `${JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, roots })}\n`);
}

export function withRegistryLock({ home = os.homedir() } = {}, fn) {
  const dir = registryDir(home);
  const lock = join(dir, "roots.lock");
  return withDirectoryLock({
    lockPath: lock,
    fn,
    errorFactory: ({ holderPid, lockPath }) => new RegistryError(`Registry is locked by pid ${holderPid ?? "unknown"}: ${lockPath}`, "ELOCKED"),
  });
}

function canonicalRoot(rootInput, { missing = false } = {}) {
  const resolved = resolve(process.cwd(), rootInput);
  try {
    return { root: realpathSync(resolved), resolved };
  } catch (error) {
    if (missing && error?.code === "ENOENT") return { root: resolved, resolved };
    if (!missing && error?.code === "ENOENT") throw new Error(`Cannot register a nonexistent root: ${resolved}`);
    throw error;
  }
}

export function registerRoot(rootInput, { home = os.homedir() } = {}) {
  const { root } = canonicalRoot(rootInput);
  const key = repoKey(root);
  let added = false;
  withRegistryLock({ home }, () => {
    const registry = readRegistry({ home });
    if (registry.roots.some((entry) => entry.root === root)) return;
    registry.roots.push({ root, repoKey: key });
    writeRegistry(registry, { home });
    added = true;
  });
  return { added, root, repoKey: key };
}

export function unregisterRoot(rootInput, { home = os.homedir() } = {}) {
  const { root, resolved } = canonicalRoot(rootInput, { missing: true });
  const canonical = root === resolved ? canonicalMissingPath(resolved) : root;
  let removed = false;
  withRegistryLock({ home }, () => {
    const registry = readRegistry({ home });
    const roots = registry.roots.filter((entry) => entry.root !== canonical && entry.root !== resolved);
    removed = roots.length !== registry.roots.length;
    registry.roots = roots;
    writeRegistry(registry, { home });
  });
  return { removed, root };
}

function canonicalMissingPath(path) {
  const suffix = [];
  let current = path;
  while (true) {
    try {
      return resolve(realpathSync(current), ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") return path;
      const parent = resolve(current, "..");
      if (parent === current) return path;
      suffix.push(basename(current));
      current = parent;
    }
  }
}

function hasBurnlist(dir) {
  return readdirSync(dir, { withFileTypes: true }).some((entry) => {
    if (!entry.isDirectory()) return false;
    try {
      return statSync(join(dir, entry.name, "burnlist.md")).isFile();
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
      throw error;
    }
  });
}

function classifyRoot(entry) {
  try {
    statSync(entry.root);
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "unreadable";
  }
  const burnlists = join(entry.root, "notes", "burnlists");
  try {
    if (!statSync(burnlists).isDirectory()) return "empty";
    const lifecycles = ["draft", "ready", "inprogress", "completed"];
    return lifecycles.some((lifecycle) => {
      const lifecycleDir = join(burnlists, lifecycle);
      try {
        return statSync(lifecycleDir).isDirectory() && hasBurnlist(lifecycleDir);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
        throw error;
      }
    }) ? "healthy" : "empty";
  } catch (error) {
    return error?.code === "ENOENT" || error?.code === "ENOTDIR" ? "empty" : "unreadable";
  }
}

export function classifyRoots({ home = os.homedir() } = {}) {
  return readRegistry({ home }).roots.map((entry) => ({ ...entry, status: classifyRoot(entry) }));
}

export function pruneMissing({ home = os.homedir() } = {}) {
  let removed = [];
  withRegistryLock({ home }, () => {
    const registry = readRegistry({ home });
    removed = registry.roots.filter((entry) => classifyRoot(entry) === "missing");
    registry.roots = registry.roots.filter((entry) => !removed.includes(entry));
    writeRegistry(registry, { home });
  });
  return removed;
}
