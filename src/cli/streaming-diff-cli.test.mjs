import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveStreamingDiffIdentity } from "../../ovens/streaming-diff/engine/streaming-diff-feed.mjs";
import { readJournal } from "../../ovens/streaming-diff/engine/streaming-diff-journal.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-cli-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "target.txt"), "before\n");
  writeFileSync(join(root, "other.txt"), "clean\n");
  git(root, "add", "target.txt", "other.txt");
  git(root, "commit", "--quiet", "-m", "initial");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, ...args) {
  return execFileSync(process.execPath, [binPath, "streaming-diff", ...args], { cwd: context.root, encoding: "utf8" });
}

test("CLI pre/post capture excludes pre-existing dirty-tree changes from a tool card", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.root, "other.txt"), "dirty before tool\n");
    assert.match(run(context, "ensure-feed", "--session", "agent-one"), /Binding: created/u);
    assert.match(run(context, "capture", "--session", "agent-one", "--tool-use-id", "tool-one", "--phase", "pre", "--path", "target.txt"), /Snapshot:/u);
    writeFileSync(join(context.root, "target.txt"), "after\n");
    assert.match(run(context, "capture", "--session", "agent-one", "--tool-use-id", "tool-one", "--phase", "post", "--path", "target.txt"), /Card: r-[a-f0-9]+ \(captured\)/u);
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "agent-one" });
    const card = readJournal(identity.feedDir).cards.find((entry) => entry.status === "captured");
    assert.deepEqual(card.files.map((file) => file.path), ["target.txt"]);
    assert.match(card.files[0].diff, /-before\n\+after/u);
    assert.doesNotMatch(card.files[0].diff, /dirty before tool/u);
  } finally { context.cleanup(); }
});

test("CLI url prints the URL-addressed logical/worktree/session route", () => {
  const context = fixture();
  try {
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "agent-one" });
    assert.equal(
      run(context, "url", "--session", "agent-one").trim(),
      `/ovens/streaming-diff/view?repoKey=${identity.logicalRepoKey}&worktreeKey=${identity.worktreeKey}&session=agent-one`,
    );
  } finally { context.cleanup(); }
});

test("CLI reports an invalid capture phase as a usage error", () => {
  const context = fixture();
  try {
    assert.throws(
      () => run(context, "capture", "--session", "agent-one", "--tool-use-id", "tool-one", "--phase", "later"),
      (error) => error.status === 2 && /phase must be pre or post/u.test(error.stderr),
    );
  } finally { context.cleanup(); }
});
