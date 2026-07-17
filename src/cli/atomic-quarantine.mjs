import { lstatSync, mkdtempSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function lstatOrNull(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function filesystemIdentity(path) {
  const stat = lstatSync(path);
  return { dev: stat.dev, ino: stat.ino };
}

export function sameFilesystemIdentity(stat, identity) {
  return Boolean(stat && identity && stat.dev === identity.dev && stat.ino === identity.ino);
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
