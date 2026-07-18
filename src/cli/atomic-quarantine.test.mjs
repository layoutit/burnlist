import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { filesystemIdentity, removeQuarantinedTarget, sameFilesystemIdentity } from "./atomic-quarantine.mjs";

test("filesystem identity rejects a reused-inode match on mtimeMs alone", () => {
  // Linux reuses inode numbers as soon as a path is unlinked, so a foreign
  // replacement can land on the exact same {dev, ino} as the object it
  // replaced. Prove the guard does not treat that coincidence as a match by
  // constructing the pathological case directly, without depending on any
  // real filesystem's inode allocator behavior.
  const original = { dev: 1, ino: 42, mtimeMs: 1000 };
  const reusedInodeReplacement = { dev: 1, ino: 42, mtimeMs: 2000 };
  assert.equal(sameFilesystemIdentity(reusedInodeReplacement, original), false);
  assert.equal(sameFilesystemIdentity(original, original), true);
});

test("atomic quarantine restores a foreign target interleaved before ownership validation", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-atomic-quarantine-"));
  try {
    const target = join(root, "skill");
    mkdirSync(target);
    const identity = filesystemIdentity(target);
    const result = removeQuarantinedTarget({
      target,
      identity,
      validate: (path) => lstatSync(path).isDirectory(),
      hooks: {
        beforeQuarantine: () => {
          rmSync(target, { recursive: true, force: true });
          writeFileSync(target, "foreign\n");
        },
      },
    });
    assert.equal(result.status, "foreign");
    assert.equal(readFileSync(target, "utf8"), "foreign\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
