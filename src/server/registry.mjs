import { createHash, randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lockHolder(lock) {
  try {
    const holder = JSON.parse(readFileSync(lock, "utf8"));
    return Number.isInteger(holder?.pid) && holder.pid > 0 ? holder.pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function lockIsStealable(lock) {
  try {
    statSync(lock);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  return !isAlive(lockHolder(lock));
}

function tryAcquireLock(lock, temp, contents) {
  writeFileSync(temp, contents, { flag: "wx" });
  try {
    linkSync(temp, lock);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}

function releaseLock(lock, token) {
  try {
    if (JSON.parse(readFileSync(lock, "utf8")).token === token) rmSync(lock, { force: true });
  } catch {
    // A replaced or removed lock must not be released by this owner.
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
  const temp = join(dir, `.roots.json.${randomBytes(12).toString("hex")}`);
  try {
    writeFileSync(temp, `${JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, roots })}\n`);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function withRegistryLock({ home = os.homedir() } = {}, fn) {
  const dir = registryDir(home);
  const lock = join(dir, "roots.lock");
  const token = randomBytes(12).toString("hex");
  const temp = join(dir, `.lock.${token}`);
  const recovery = join(dir, ".roots.lock.recovery");
  const recoveryTemp = join(dir, `.roots.lock.recovery.${token}`);
  const stale = join(dir, `.stale.${token}`);
  const contents = JSON.stringify({ pid: process.pid, token, createdAt: Date.now() });
  let holderPid = null;
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if (tryAcquireLock(lock, temp, contents)) {
        if (existsSync(recovery)) {
          releaseLock(lock, token);
          sleep(20);
          continue;
        }
        try {
          return fn();
        } finally {
          releaseLock(lock, token);
        }
      }
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    holderPid = lockHolder(lock);
    if (lockIsStealable(lock)) {
      let recovering = false;
      try {
        recovering = tryAcquireLock(recovery, recoveryTemp, contents);
        if (!recovering) {
          sleep(20);
          continue;
        }
        // The recovery claim is a compare-and-swap guard: contenders may create a
        // lock while it exists, but release it before entering their callback.
        // That leaves this claimant as the only process allowed to replace a dead
        // holder, so the rename cannot displace a newly-entered live holder.
        for (let recoveryAttempt = 0; recoveryAttempt < 50; recoveryAttempt += 1) {
          if (tryAcquireLock(lock, temp, contents)) {
            releaseLock(recovery, token);
            recovering = false;
            try {
              return fn();
            } finally {
              releaseLock(lock, token);
            }
          }
          if (lockIsStealable(lock)) {
            try {
              renameSync(lock, stale);
            } catch (error) {
              if (error?.code === "ENOENT") continue;
              throw error;
            }
            rmSync(stale, { force: true });
          }
          sleep(20);
        }
      } finally {
        if (recovering) releaseLock(recovery, token);
      }
      if (recovering) continue;
    }
    sleep(20);
  }
  throw new RegistryError(`Registry is locked by pid ${holderPid ?? "unknown"}: ${lock}`, "ELOCKED");
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
