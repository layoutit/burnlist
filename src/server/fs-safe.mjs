import { randomBytes } from "node:crypto";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export const OVEN_REV_GRACE_MS = 60_000;

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

function revisionName(value) {
  return /^rev-[a-f0-9]+$/u.test(value) ? value : null;
}

function pointerRevision(value) {
  const match = /^(rev-[a-f0-9]+)\n?$/u.exec(value);
  return match ? revisionName(match[1]) : null;
}

// Readers resolve this once, then use the returned immutable path for every
// file in their package read. ENOENT is deliberately left for callers to treat
// as an ordinary concurrent disappearance.
export function resolveOvenPackageDir(pkgRoot) {
  const pointer = join(pkgRoot, "current");
  const entry = entryAt(pointer);
  if (!entry) return pkgRoot;
  if (!entry.isFile()) throw new Error(`Invalid Oven current pointer at ${pointer}: not a file.`);
  const current = pointerRevision(readFileSync(pointer, "utf8"));
  if (!revisionName(current)) throw new Error(`Invalid Oven current pointer at ${pointer}.`);
  const revisionDir = join(pkgRoot, current);
  if (!entryAt(revisionDir)?.isDirectory()) {
    throw new Error(`Invalid Oven current pointer at ${pointer}: missing revision ${current}.`);
  }
  return revisionDir;
}

function currentRevision(pkgRoot, id) {
  const pointer = join(pkgRoot, "current");
  const entry = entryAt(pointer);
  if (!entry) return null;
  if (!entry.isFile()) throw new Error(`Oven ${id} current pointer is not a file.`);
  const revision = pointerRevision(readFileSync(pointer, "utf8"));
  if (!revisionName(revision)) throw new Error(`Oven ${id} current pointer is invalid.`);
  const revisionDir = join(pkgRoot, revision);
  if (!entryAt(revisionDir)?.isDirectory()) {
    throw new Error(`Oven ${id} current pointer names missing revision ${revision}.`);
  }
  return revisionDir;
}

function legacyPackage(pkgRoot) {
  return ["instructions.md", "detail.json"].every((name) => entryAt(join(pkgRoot, name))?.isFile());
}

function copyPackageFiles(from, to) {
  for (const name of ["instructions.md", "detail.json", "oven.json"]) {
    if (entryAt(join(from, name))?.isFile()) cpSync(join(from, name), join(to, name));
  }
}

function publishCurrent(pkgRoot, id, revision) {
  const temporary = join(pkgRoot, `.current.${randomBytes(8).toString("hex")}`);
  try {
    writeFileSync(temporary, `${revision}\n`);
    renameSync(temporary, join(pkgRoot, "current"));
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch (cleanupFailure) {
      throw cleanupError([error, cleanupFailure], `Could not publish Oven ${id}`);
    }
    throw error;
  }
}

function removeLegacyFiles(pkgRoot) {
  for (const name of ["instructions.md", "detail.json", "oven.json"]) {
    try {
      rmSync(join(pkgRoot, name), { force: true });
    } catch {
      // The pointer is already durable; a later publish can retry this cleanup.
    }
  }
}

function gcOldRevisions(pkgRoot, current) {
  try {
    for (const entry of readdirSync(pkgRoot, { withFileTypes: true })) {
      const path = join(pkgRoot, entry.name);
      if (entry.isFile() && entry.name.startsWith(".current.")) {
        try {
          rmSync(path, { force: true });
        } catch (error) {
          if (!missing(error)) throw error;
        }
        continue;
      }
      if (!entry.isDirectory() || entry.name === current || !revisionName(entry.name)) continue;
      try {
        if (Date.now() - statSync(path).mtimeMs >= OVEN_REV_GRACE_MS) rmSync(path, { recursive: true, force: true });
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

// Custom Oven packages are immutable nested revisions published by atomically
// replacing a small pointer file. A reader that resolved the old revision keeps
// a stable path until grace-period GC makes it eligible for deletion. A reader
// suspended beyond that grace period mid-read is out of scope for this localhost tool.
export function atomicOvenPackage(parent, id, files, { replace = false } = {}) {
  mkdirSync(parent, { recursive: true });
  const pkgRoot = join(parent, id);
  mkdirSync(pkgRoot, { recursive: true });
  const previous = currentRevision(pkgRoot, id);
  const legacy = !previous && legacyPackage(pkgRoot);
  if ((previous || legacy) && !replace) throw Object.assign(new Error(`${id} already exists.`), { code: "EEXIST" });

  const revision = `rev-${randomBytes(8).toString("hex")}`;
  const revisionDir = join(pkgRoot, revision);
  mkdirSync(revisionDir);
  try {
    if (previous) copyPackageFiles(previous, revisionDir);
    else if (legacy) copyPackageFiles(pkgRoot, revisionDir);
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(revisionDir, name), contents);
    // Touch the outgoing rev to now BEFORE the swap so its grace window starts at retirement even if
    // the process dies right after publishCurrent (a post-swap touch could leave it stale for GC).
    if (previous) {
      const retiredAt = new Date();
      utimesSync(previous, retiredAt, retiredAt);
    }
    publishCurrent(pkgRoot, id, revision);
  } catch (error) {
    try {
      rmSync(revisionDir, { recursive: true, force: true });
    } catch (cleanupFailure) {
      throw cleanupError([error, cleanupFailure], `Could not publish Oven ${id}`);
    }
    throw error;
  }
  removeLegacyFiles(pkgRoot);
  gcOldRevisions(pkgRoot, revision);
  return pkgRoot;
}
