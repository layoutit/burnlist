import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { filesystemIdentity, removeQuarantinedTarget } from "./atomic-quarantine.mjs";

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
