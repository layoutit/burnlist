import { randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
