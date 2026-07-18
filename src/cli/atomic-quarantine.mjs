import { lstatSync, mkdtempSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function lstatOrNull(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// {dev, ino} alone cannot prove "this is the exact object I created": Linux
// (ext4 and friends) reuses inode numbers as soon as the old one is unlinked,
// so a foreign object that replaces ours at the same path can land on the
// identical {dev, ino} by pure allocator coincidence — inode uniqueness is a
// macOS/APFS behavior, not a POSIX guarantee. Pairing the pair with mtimeMs
// (set fresh at creation, never inherited from a prior tenant of a reused
// inode) means a false match additionally requires the replacement to land
// in the very same clock tick as the original. mtime is deliberately used
// instead of ctime: quarantineTarget below holds an object by *renaming* it
// to a private path before validating it, and rename(2) always bumps ctime
// (even for the exact same object) but never touches mtime — so ctime would
// make every legitimate match look foreign, while mtime survives it. For a
// local, single-process, lock-serialized installer this tuple is a
// proportionate, best-effort defense-in-depth check — not a cryptographic
// guarantee — and it is honest cross-platform where a bare {dev, ino} check
// was not.
export function filesystemIdentity(path) {
  const stat = lstatSync(path);
  return { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs };
}

export function sameFilesystemIdentity(stat, identity) {
  return Boolean(
    stat && identity && stat.dev === identity.dev && stat.ino === identity.ino && stat.mtimeMs === identity.mtimeMs,
  );
}

// Rename to an owned quarantine path before deciding whether the object is
// ours. The returned object must be removed or restored by the caller.
export function quarantineTarget({ target, quarantined, identity, validate = () => true, hooks }) {
  hooks?.beforeQuarantine?.({ target, quarantined });
  let held = false;
  try {
    try { renameSync(target, quarantined); } catch (error) {
      if (error.code === "ENOENT") return { status: "missing" };
      throw error;
    }
    held = true;
    const stat = lstatOrNull(quarantined);
    if ((identity && !sameFilesystemIdentity(stat, identity)) || !validate(quarantined, stat)) {
      renameSync(quarantined, target);
      held = false;
      return { status: "foreign" };
    }
    return { status: "quarantined", quarantined };
  } catch (error) {
    if (held && lstatOrNull(quarantined)) {
      try { renameSync(quarantined, target); } catch (restoreError) {
        throw new AggregateError([error, restoreError], `could not remove quarantined target ${target}`);
      }
    }
    throw error;
  }
}

// Deletion is the common quarantine operation. It always removes the private
// quarantined pathname, never the caller-visible target pathname.
export function removeQuarantinedTarget({ target, identity, validate = () => true, remove = rmSync, hooks }) {
  const parent = dirname(target);
  const container = mkdtempSync(join(parent, `.${basename(target)}.burnlist-quarantine-`));
  const quarantined = join(container, "object");
  try {
    const held = quarantineTarget({ target, quarantined, identity, validate, hooks });
    if (held.status !== "quarantined") return held;
    try { remove(quarantined, { recursive: true, force: true }); } catch (error) {
      if (lstatOrNull(quarantined)) {
        try { renameSync(quarantined, target); } catch (restoreError) {
          throw new AggregateError([error, restoreError], `could not remove quarantined target ${target}`);
        }
      }
      throw error;
    }
    return { status: "removed" };
  } finally {
    try { rmdirSync(container); } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
    }
  }
}
