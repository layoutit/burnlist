import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deriveCandidate } from "./candidate.mjs";

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-candidate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  return root;
}

test("captures a normal worktree with more than 256 files and preserves symlink identity", (t) => {
  const root = repository(t);
  mkdirSync(join(root, "src"));
  for (let index = 0; index < 300; index += 1) {
    writeFileSync(join(root, "src", `${String(index).padStart(3, "0")}.txt`), `${index}\n`);
  }
  symlinkSync("src/000.txt", join(root, "CLAUDE.md"));
  const first = deriveCandidate({ repoRoot: root });
  assert.match(first.id, /^cm1-sha256:[a-f0-9]{64}$/u);
  assert.match(first.context, /files=301/u);
  assert.ok(Buffer.byteLength(first.context) < 65_536);
  assert.equal(deriveCandidate({ repoRoot: root }).id, first.id);
  writeFileSync(join(root, "src", "000.txt"), "changed\n");
  assert.notEqual(deriveCandidate({ repoRoot: root }).id, first.id);
});

test("ignored files do not alter the candidate while untracked worktree files do", (t) => {
  const root = repository(t);
  writeFileSync(join(root, ".gitignore"), "ignored\n");
  writeFileSync(join(root, "tracked"), "a\n");
  const first = deriveCandidate({ repoRoot: root });
  writeFileSync(join(root, "ignored"), "noise\n");
  assert.equal(deriveCandidate({ repoRoot: root }).id, first.id);
  writeFileSync(join(root, "untracked"), "work\n");
  assert.notEqual(deriveCandidate({ repoRoot: root }).id, first.id);
});
