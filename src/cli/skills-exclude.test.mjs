import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { snapshotExclude, writeGuardedExclude } from "./skills-exclude.mjs";

test("guarded exclude write preserves an edit made after staging", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-skills-exclude-"));
  const path = join(root, "exclude");
  try {
    writeFileSync(path, "# before\n");
    const before = snapshotExclude(path);
    assert.throws(() => writeGuardedExclude({
      path,
      before,
      text: "# managed\n",
      beforeSwap: () => writeFileSync(path, "# concurrent edit\n"),
    }), /refusing to overwrite git exclude file because it changed/u);
    assert.equal(readFileSync(path, "utf8"), "# concurrent edit\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
