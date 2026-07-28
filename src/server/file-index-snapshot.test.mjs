import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileIndexSnapshot } from "./file-index-snapshot.mjs";

test("file index snapshots reuse unchanged values and rebuild after a tracked write", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "burnlist-file-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tracked = join(root, "burnlist.md");
  writeFileSync(tracked, "one");
  let builds = 0;
  const index = createFileIndexSnapshot({
    scope: () => [{ repoKey: "aaaaaaaaaaaa", root }],
    paths: () => [tracked],
    build: () => ({ builds: ++builds }),
  });

  assert.strictEqual(index.snapshot(), index.snapshot());
  writeFileSync(tracked, "a longer replacement");
  assert.equal(index.snapshot().builds, 2);
});
