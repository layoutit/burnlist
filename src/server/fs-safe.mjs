import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { assertOvenPackageFileLimits } from "./oven-storage.mjs";

export { readTextFileWithLimit } from "./fs-bounded-read.mjs";
export { ovenPackageLockRoot, withLock, withOvenPackageLock } from "./oven-package-lock.mjs";

export const OVEN_REV_GRACE_MS = 60_000;

export function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
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
  return entry;
}

export function atomicDirectory(parent, id, files, {
  replace = false,
  preserveExisting = false,
  assertPath,
  createParent = true,
} = {}) {
  assertPath?.();
  if (createParent) mkdirSync(parent, { recursive: true });
  else plainDirectory(parent, "Atomic directory parent");
  assertPath?.();
  const temporary = join(parent, `.${id}.${randomBytes(8).toString("hex")}`);
  const target = join(parent, id);
  if (existsSync(target) && !replace) throw Object.assign(new Error(`${id} already exists.`), { code: "EEXIST" });
  assertPath?.();
  mkdirSync(temporary);
  try {
    if (preserveExisting && existsSync(target)) {
      assertPath?.();
      cpSync(target, temporary, { recursive: true });
    }
    for (const [name, contents] of Object.entries(files)) {
      assertPath?.();
      writeFileSync(join(temporary, name), contents);
    }
    assertPath?.();
    if (!replace || !existsSync(target)) {
      renameSync(temporary, target);
      return target;
    }
    const previous = join(parent, `.${id}.old.${randomBytes(8).toString("hex")}`);
    assertPath?.();
    renameSync(target, previous);
    try {
      assertPath?.();
      renameSync(temporary, target);
    } catch (error) {
      try {
        assertPath?.();
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
      assertPath?.();
      rmSync(previous, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`Updated ${id}, but could not clean up ${previous}: ${cleanupError.message}`);
    }
  } catch (error) {
    try {
      assertPath?.();
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

function ovenFiles(pkgRoot) {
  try {
    return readdirSync(pkgRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".oven"))
      .map((entry) => entry.name);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

function legacyPackage(pkgRoot) {
  return entryAt(join(pkgRoot, "instructions.md"))?.isFile()
    && (ovenFiles(pkgRoot).length > 0 || entryAt(join(pkgRoot, "detail.json"))?.isFile());
}

function copyPackageFiles(from, to) {
  for (const name of ["instructions.md", ...ovenFiles(from), "oven.json", "detail.json"]) {
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
  for (const name of ["instructions.md", ...ovenFiles(pkgRoot), "oven.json", "detail.json"]) {
    try {
      rmSync(join(pkgRoot, name), { force: true });
    } catch (error) {
      // The pointer is already durable; a later publish can retry this cleanup.
      console.warn(`Could not remove legacy Oven file ${join(pkgRoot, name)}: ${error.message}`);
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
export function atomicOvenPackage(parent, id, files, { replace = false, assertPath } = {}) {
  assertOvenPackageFileLimits(files, id);
  assertPath?.();
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
  for (const cleanup of [
    () => removeLegacyFiles(pkgRoot),
    () => gcOldRevisions(pkgRoot, revision),
  ]) {
    try {
      cleanup();
    } catch (cleanupError) {
      console.warn(`Published Oven ${id}, but cleanup failed: ${cleanupError.message}`);
    }
  }
  return pkgRoot;
}
