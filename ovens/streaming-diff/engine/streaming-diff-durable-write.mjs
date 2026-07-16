import { randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// The replacement is the commit point. Once it succeeds, the new content has
// already been synced and a later parent-directory sync is only best effort.
export function writeDurableAtomic(path, value, { fsyncTemporary = fsyncSync, fsyncParent = fsyncDirectory } = {}) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let fd;
  let renamed = false;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, value);
    fsyncTemporary(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    renamed = true;
    try { fsyncParent(dirname(path)); } catch { /* the replacement is committed */ }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { rmSync(temporary, { force: true }); } catch (error) { if (!renamed) throw error; }
  }
}

// Linking a synced temporary file is an atomic, no-replacement commit. It is
// suitable for immutable records and monotonic marker files: EEXIST means a
// concurrent writer already made the same state visible.
export function writeDurableExclusive(path, value, { fsyncTemporary = fsyncSync, fsyncParent = fsyncDirectory } = {}) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let fd;
  let linked = false;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, value);
    fsyncTemporary(fd);
    closeSync(fd);
    fd = undefined;
    try { linkSync(temporary, path); } catch (error) {
      if (error?.code === "EEXIST") return false;
      throw error;
    }
    linked = true;
    try { fsyncParent(dirname(path)); } catch { /* the link is committed */ }
    return true;
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { rmSync(temporary, { force: true }); } catch (error) { if (!linked) throw error; }
  }
}
