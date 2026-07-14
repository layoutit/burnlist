import { randomBytes } from "node:crypto";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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

function isPositivePid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function lockOwner(lockPath) {
  const owner = readLock(lockPath);
  return isPositivePid(owner?.pid) && typeof owner.token === "string" && owner.token ? owner : null;
}

function pidIsDead(pid) {
  if (!isPositivePid(pid)) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

export function withLock(dir, fn) {
  let lockedDir = dir;
  const token = randomBytes(16).toString("hex");
  const lockPath = join(lockedDir, ".lock");
  const temporary = join(lockedDir, `.lock.${token}.tmp`);
  const busy = () => Object.assign(new Error(`${basename(dir)} is busy (locked)`), { code: "ELOCKED" });
  try {
    writeFileSync(temporary, JSON.stringify({ token, pid: process.pid }));
    try {
      linkSync(temporary, lockPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = lockOwner(lockPath);
      if (!owner || !pidIsDead(owner.pid)) throw busy();
      const claim = `${lockPath}.claim.${token}`;
      try {
        renameSync(lockPath, claim);
      } catch (takeoverError) {
        if (takeoverError?.code === "ENOENT") throw busy();
        throw takeoverError;
      }
      try {
        rmSync(claim, { force: true });
        linkSync(temporary, lockPath);
      } catch (takeoverError) {
        if (takeoverError?.code === "EEXIST") throw busy();
        throw takeoverError;
      }
    }
  } finally {
    rmSync(temporary, { force: true });
  }
  try {
    const movedDir = fn({
      retarget(movedDir) {
        if (typeof movedDir === "string") lockedDir = movedDir;
      },
    });
    if (typeof movedDir === "string") lockedDir = movedDir;
    return movedDir;
  } finally {
    const finalLockPath = join(lockedDir, ".lock");
    if (readLock(finalLockPath)?.token === token) rmSync(finalLockPath, { force: true });
  }
}

export function ovenPackageLockRoot(root) {
  return join(root, ".oven-locks");
}

function removeEmptyDirectory(path) {
  try {
    rmdirSync(path);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes(error?.code)) throw error;
  }
}

export function withOvenPackageLock(root, id, fn, { wait = false } = {}) {
  const lockRoot = ovenPackageLockRoot(root);
  const lockDir = join(lockRoot, id);
  mkdirSync(lockDir, { recursive: true });
  try {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        let result;
        withLock(lockDir, () => { result = fn(); });
        return result;
      } catch (error) {
        if (error?.code === "ENOENT" && attempt < 299) {
          mkdirSync(lockDir, { recursive: true });
          continue;
        }
        if (!wait || error?.code !== "ELOCKED" || attempt === 299) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  } finally {
    removeEmptyDirectory(lockDir);
    removeEmptyDirectory(lockRoot);
  }
}

export function atomicDirectory(parent, id, files, { replace = false, preserveExisting = false } = {}) {
  mkdirSync(parent, { recursive: true });
  const temporary = join(parent, `.${id}.${randomBytes(8).toString("hex")}`);
  const target = join(parent, id);
  if (existsSync(target) && !replace) throw Object.assign(new Error(`${id} already exists.`), { code: "EEXIST" });
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
      try {
        renameSync(previous, target);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Could not update ${id}: publish failed and rollback failed; original remains at ${previous}.`,
        );
      }
      throw error;
    }
    try {
      rmSync(previous, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new Error(`Updated ${id}, but could not clean up ${previous}: ${cleanupError.message}`, { cause: cleanupError });
    }
  } catch (error) {
    try {
      rmSync(temporary, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Could not update ${id}: cleanup of temporary directory ${temporary} failed.`,
      );
    }
    throw error;
  }
  return target;
}

function missing(error) {
  return error?.code === "ENOENT";
}

function entryAt(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function cleanupError(errors, message) {
  if (errors.length === 1) return new Error(`${message}: ${errors[0].message}`, { cause: errors[0] });
  return new AggregateError(errors, message);
}

function publishPackageLink(parent, id, revisionDir, target) {
  const temporary = join(parent, `.${id}.link.${randomBytes(8).toString("hex")}`);
  try {
    symlinkSync(basename(revisionDir), temporary);
    renameSync(temporary, target);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch (cleanupFailure) {
      throw cleanupError([error, cleanupFailure], `Could not publish ${id}`);
    }
    throw error;
  }
}

function migrateLegacyPackage(parent, id, target) {
  const revisionDir = join(parent, `.${id}.${randomBytes(8).toString("hex")}`);
  renameSync(target, revisionDir);
  try {
    publishPackageLink(parent, id, revisionDir, target);
  } catch (error) {
    try {
      renameSync(revisionDir, target);
    } catch (rollbackFailure) {
      throw cleanupError([error, rollbackFailure], `Could not migrate legacy Oven ${id}; original remains at ${revisionDir}`);
    }
    throw error;
  }
  return revisionDir;
}

function cleanupOldPackageDirs(parent, id, current, previous) {
  const errors = [];
  const prefix = `.${id}.`;
  let currentMtime;
  try {
    currentMtime = statSync(current).mtimeMs;
  } catch (error) {
    throw cleanupError([error], `Published ${id}, but could not inspect its revision directory`);
  }
  try {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === basename(current) || !entry.name.startsWith(prefix)) continue;
      const candidate = join(parent, entry.name);
      try {
        if (candidate === previous || statSync(candidate).mtimeMs <= currentMtime) rmSync(candidate, { recursive: true, force: true });
      } catch (error) {
        if (!missing(error)) errors.push(error);
      }
    }
  } catch (error) {
    if (!missing(error)) errors.push(error);
  }
  if (errors.length) throw cleanupError(errors, `Published ${id}, but could not clean up old Oven revisions`);
}

// Custom Oven packages are immutable revision directories published through a
// symlink pointer. The pointer rename leaves readers either on the old complete
// package or the new complete package; readers never need the writer lock.
export function atomicOvenPackage(parent, id, files, { replace = false } = {}) {
  mkdirSync(parent, { recursive: true });
  const target = join(parent, id);
  const existing = entryAt(target);
  if (existing && !replace) throw Object.assign(new Error(`${id} already exists.`), { code: "EEXIST" });

  let previous = null;
  if (existing) previous = realpathSync(target);
  const revisionDir = join(parent, `.${id}.${randomBytes(8).toString("hex")}`);
  mkdirSync(revisionDir);
  try {
    if (previous) cpSync(previous, revisionDir, { recursive: true });
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(revisionDir, name), contents);
    if (existing?.isDirectory() && !existing.isSymbolicLink()) previous = migrateLegacyPackage(parent, id, target);
    publishPackageLink(parent, id, revisionDir, target);
  } catch (error) {
    try {
      rmSync(revisionDir, { recursive: true, force: true });
    } catch (cleanupFailure) {
      throw cleanupError([error, cleanupFailure], `Could not publish Oven ${id}`);
    }
    throw error;
  }
  cleanupOldPackageDirs(parent, id, revisionDir, previous);
  return target;
}
