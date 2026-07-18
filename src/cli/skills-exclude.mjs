import { randomBytes } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { dirname } from "node:path";

import { filesystemIdentity, removeQuarantinedTarget, sameFilesystemIdentity } from "./atomic-quarantine.mjs";
import { stageAtomicText, writeAtomicText } from "./local-exclude.mjs";

function lstatOrNull(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function snapshotExclude(path) {
  const stat = lstatOrNull(path);
  if (!stat) return { kind: "missing" };
  if (stat.isSymbolicLink()) {
    return { kind: "symlink", identity: filesystemIdentity(path), link: readlinkSync(path), text: readFileSync(path, "utf8"), mode: stat.mode, atime: stat.atime, mtime: stat.mtime };
  }
  if (!stat.isFile()) throw new Error(`refusing to modify non-file git exclude path: ${path}`);
  return { kind: "file", identity: filesystemIdentity(path), text: readFileSync(path, "utf8"), mode: stat.mode, atime: stat.atime, mtime: stat.mtime };
}

export function matchesExcludeSnapshot(path, snapshot) {
  if (snapshot.kind === "missing") return !lstatOrNull(path);
  const stat = lstatOrNull(path);
  if (!sameFilesystemIdentity(stat, snapshot.identity)) return false;
  if (snapshot.kind === "symlink") return stat.isSymbolicLink() && readlinkSync(path) === snapshot.link && readFileSync(path, "utf8") === snapshot.text;
  return stat.isFile() && !stat.isSymbolicLink() && readFileSync(path, "utf8") === snapshot.text;
}

function restoreObject(path, snapshot) {
  mkdirSync(dirname(path), { recursive: true });
  if (snapshot.kind === "symlink") {
    const temporary = `${path}.burnlist-restore-${randomBytes(12).toString("hex")}`;
    try {
      symlinkSync(snapshot.link, temporary);
      renameSync(temporary, path);
    } finally { rmSync(temporary, { force: true }); }
    return;
  }
  writeAtomicText(path, snapshot.text);
  chmodSync(path, snapshot.mode & 0o777);
  utimesSync(path, snapshot.atime, snapshot.mtime);
}

// The exclude file participates in target rollback.  Its current object must
// still be the text/object this transaction wrote before we replace or remove
// it, so an outside edit is left alone instead of being overwritten.
export function restoreExcludeSnapshot({ path, before, written, remove = rmSync }) {
  if (!written) {
    if (!matchesExcludeSnapshot(path, before)) throw new Error(`could not restore exclude file because it changed during this transaction: ${path}`);
    return;
  }
  if (!written || !matchesExcludeSnapshot(path, written)) {
    throw new Error(`could not restore exclude file because it changed after this transaction wrote it: ${path}`);
  }
  const result = removeQuarantinedTarget({
    target: path,
    identity: written.identity,
    validate: (quarantined) => matchesExcludeSnapshot(quarantined, written),
    remove,
  });
  if (result.status !== "removed") throw new Error(`could not restore exclude file because it is no longer the object written by this transaction: ${path}`);
  if (before.kind !== "missing") restoreObject(path, before);
}

export function writeGuardedExclude({ path, before, text, stageAtomic = stageAtomicText, beforeSwap }) {
  const staged = stageAtomic(path, text);
  try {
    beforeSwap?.();
    if (!matchesExcludeSnapshot(path, before)) {
      throw new Error(`refusing to overwrite git exclude file because it changed before this transaction wrote it: ${path}`);
    }
    staged.commit();
    return snapshotExclude(path);
  } finally { staged.discard(); }
}
