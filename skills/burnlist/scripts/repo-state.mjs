import { randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const LOCK_STALE_MS = 60_000;

export function repoStateDir(repoRoot) {
  return join(resolve(repoRoot), ".local", "burnlist");
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

function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === ""
    || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

export function containedJoin(repoRoot, ...segments) {
  const repo = nearestRealPath(resolve(repoRoot));
  const state = repoStateDir(repoRoot);
  const target = join(state, ...segments);
  if (!isWithin(state, target)) {
    throw new Error(`Repo state path escapes ${state}: ${target}`);
  }
  const realState = nearestRealPath(state);
  const realTarget = nearestRealPath(target);
  if (!isWithin(repo, realState) || !isWithin(realState, realTarget)) {
    throw new Error(`Repo state path escapes ${state}: ${target}`);
  }
  return target;
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
    if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  return !isAlive(lockHolder(lock));
}

export function withRepoStateLock(repoRoot, fn) {
  const dir = containedJoin(repoRoot);
  mkdirSync(dir, { recursive: true });
  const lock = containedJoin(repoRoot, ".lock");
  const token = randomBytes(12).toString("hex");
  const temp = containedJoin(repoRoot, `.lock.${token}`);
  const stale = containedJoin(repoRoot, `.stale.${token}`);
  let holderPid = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let acquired = false;
    try {
      writeFileSync(temp, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }), { flag: "wx" });
      try {
        linkSync(temp, lock);
        acquired = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      } finally {
        rmSync(temp, { force: true });
      }
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    if (!acquired) {
      holderPid = lockHolder(lock);
      if (lockIsStealable(lock)) {
        try {
          renameSync(lock, stale);
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw error;
        }
        rmSync(stale, { force: true });
        continue;
      }
      sleep(20);
      continue;
    }
    try {
      return fn();
    } finally {
      try {
        if (JSON.parse(readFileSync(lock, "utf8")).token === token) rmSync(lock, { force: true });
      } catch {
        // A replaced or removed lock must not be released by this owner.
      }
    }
  }
  throw new Error(`Repo state is locked by pid ${holderPid ?? "unknown"}: ${lock}`);
}
