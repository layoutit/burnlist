import { randomBytes } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

function fileIdentity(entry) {
  return { dev: entry.dev, ino: entry.ino };
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function entryAt(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function plainDirectory(path, label) {
  const entry = entryAt(path);
  if (!entry) {
    throw Object.assign(new Error(`${label} disappeared while it was in use: ${path}`), { code: "ENOENT" });
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${path}`);
  }
  return fileIdentity(entry);
}

function createPlainDirectory(path, label) {
  try {
    mkdirSync(path);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return plainDirectory(path, label);
}

function assertSameDirectory(path, identity, label) {
  const current = plainDirectory(path, label);
  if (!sameFile(current, identity)) throw new Error(`${label} changed while it was in use: ${path}`);
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

export function withLock(dir, fn, { assertPath } = {}) {
  let lockedDir = dir;
  const token = randomBytes(16).toString("hex");
  const lockPath = join(lockedDir, ".lock");
  const temporary = join(lockedDir, `.lock.${token}.tmp`);
  const busy = () => Object.assign(new Error(`${basename(dir)} is busy (locked)`), { code: "ELOCKED" });
  try {
    assertPath?.();
    writeFileSync(temporary, JSON.stringify({ token, pid: process.pid }));
    try {
      assertPath?.();
      linkSync(temporary, lockPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      assertPath?.();
      const owner = lockOwner(lockPath);
      if (!owner || !pidIsDead(owner.pid)) throw busy();
      const claim = `${lockPath}.claim.${token}`;
      try {
        assertPath?.();
        renameSync(lockPath, claim);
      } catch (takeoverError) {
        if (takeoverError?.code === "ENOENT") throw busy();
        throw takeoverError;
      }
      try {
        assertPath?.();
        rmSync(claim, { force: true });
        assertPath?.();
        linkSync(temporary, lockPath);
      } catch (takeoverError) {
        if (takeoverError?.code === "EEXIST") throw busy();
        throw takeoverError;
      }
    }
  } finally {
    assertPath?.();
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
    assertPath?.();
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

export function withOvenPackageLock(root, id, fn, { wait = false, assertPath, createRoot = true } = {}) {
  const lockRoot = ovenPackageLockRoot(root);
  const lockDir = join(lockRoot, id);
  assertPath?.();
  if (createRoot) mkdirSync(root, { recursive: true });
  else plainDirectory(root, "Oven package root");
  assertPath?.();
  let lockRootIdentity = createPlainDirectory(lockRoot, "Oven lock root");
  assertPath?.();
  let lockDirIdentity = createPlainDirectory(lockDir, "Oven package lock directory");
  const assertLockPath = () => {
    assertPath?.();
    assertSameDirectory(lockRoot, lockRootIdentity, "Oven lock root");
    assertSameDirectory(lockDir, lockDirIdentity, "Oven package lock directory");
  };
  const recreateLockPath = () => {
    assertPath?.();
    lockRootIdentity = createPlainDirectory(lockRoot, "Oven lock root");
    assertPath?.();
    lockDirIdentity = createPlainDirectory(lockDir, "Oven package lock directory");
  };
  try {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        let result;
        withLock(lockDir, () => { result = fn(); }, { assertPath: assertLockPath });
        return result;
      } catch (error) {
        if (error?.code === "ENOENT" && attempt < 299) {
          recreateLockPath();
          continue;
        }
        if (!wait || error?.code !== "ELOCKED" || attempt === 299) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  } finally {
    assertLockPath();
    removeEmptyDirectory(lockDir);
    removeEmptyDirectory(lockRoot);
  }
}
