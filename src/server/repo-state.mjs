import { randomBytes } from "node:crypto";
import {
  existsSync,
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

export function withRepoStateLock(repoRoot, fn) {
  const dir = containedJoin(repoRoot);
  mkdirSync(dir, { recursive: true });
  const lock = containedJoin(repoRoot, ".lock");
  const token = randomBytes(12).toString("hex");
  const temp = containedJoin(repoRoot, `.lock.${token}`);
  const recovery = containedJoin(repoRoot, ".lock.recovery");
  const recoveryTemp = containedJoin(repoRoot, `.lock.recovery.${token}`);
  const stale = containedJoin(repoRoot, `.stale.${token}`);
  const contents = JSON.stringify({ pid: process.pid, token, createdAt: Date.now() });
  let holderPid = null;
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
  throw new Error(`Repo state is locked by pid ${holderPid ?? "unknown"}: ${lock}`);
}
