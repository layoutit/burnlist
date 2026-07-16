import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveStreamingDiffIdentity, sessionId, snapshotDirectory, streamingDiffBindingPath } from "./streaming-diff-feed.mjs";
import { captureStreamingDiff } from "./streaming-diff-feed-capture.mjs";
import { readJournal } from "./streaming-diff-journal.mjs";
import { writePreSnapshot } from "./streaming-diff-snapshot-store.mjs";

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-feed-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  git(root, "commit", "--allow-empty", "--quiet", "-m", "initial");
  const linked = join(tmpdir(), `burnlist-streaming-feed-worktree-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  git(root, "worktree", "add", "--detach", linked);
  return { root, linked, cleanup: () => { rmSync(root, { recursive: true, force: true }); rmSync(linked, { recursive: true, force: true }); } };
}

test("feed identity partitions linked worktrees under the primary repository state", () => {
  const context = fixture();
  try {
    const primary = resolveStreamingDiffIdentity({ cwd: context.root, session: "agent-a" });
    const linked = resolveStreamingDiffIdentity({ cwd: context.linked, session: "agent-a" });
    assert.equal(primary.logicalRepoRoot, realpathSync(context.root));
    assert.equal(linked.logicalRepoRoot, realpathSync(context.root));
    assert.notEqual(primary.worktreeRoot, linked.worktreeRoot);
    assert.notEqual(primary.worktreeKey, linked.worktreeKey);
    assert.notEqual(primary.feedDir, linked.feedDir);
    assert.match(linked.feedDir, new RegExp(`${linked.logicalRepoKey}/${linked.worktreeKey}/[a-f0-9]{32}$`));
    assert.equal(streamingDiffBindingPath(linked), ".local/burnlist/streaming-diff/v2");
    assert.match(snapshotDirectory(linked), new RegExp(`${linked.worktreeKey}/[a-f0-9]{32}/snapshots$`));
  } finally { context.cleanup(); }
});

test("session and tool identifiers reject hostile input while hashed names preserve exact identities", () => {
  const context = fixture();
  try {
    const oversize = "x".repeat(201);
    for (const value of ["", " \t", "has\u0000nul", "has\nnewline", "has\u001fcontrol", oversize, "lone-\ud800"]) {
      assert.throws(() => sessionId(value), /identifier/u);
      assert.throws(() => writePreSnapshot({ identity: resolveStreamingDiffIdentity({ cwd: context.root, session: "valid" }), toolUseId: value }), /tool use id/u);
    }
    const unusual = "café-😀";
    assert.equal(sessionId(unusual), unusual);
    assert.equal(writePreSnapshot({ identity: resolveStreamingDiffIdentity({ cwd: context.root, session: "valid" }), toolUseId: unusual }).hintedPaths.length, 0);
    const upper = resolveStreamingDiffIdentity({ cwd: context.root, session: "Agent-A" });
    const lower = resolveStreamingDiffIdentity({ cwd: context.root, session: "agent-a" });
    assert.notEqual(upper.feedDir, lower.feedDir);
    captureStreamingDiff({ cwd: context.root, session: "Agent-A", toolUseId: "tool-upper", phase: "pre" });
    captureStreamingDiff({ cwd: context.root, session: "agent-a", toolUseId: "tool-lower", phase: "pre" });
    assert.equal(existsSync(upper.feedDir), true);
    assert.equal(existsSync(lower.feedDir), true);
    assert.equal(readJournal(upper.feedDir).manifest.identity.session, "Agent-A");
    assert.equal(readJournal(lower.feedDir).manifest.identity.session, "agent-a");
    const toolUpper = writePreSnapshot({ identity: upper, toolUseId: "Tool-A" });
    const toolLower = writePreSnapshot({ identity: upper, toolUseId: "tool-a" });
    assert.notEqual(toolUpper.path, toolLower.path);
  } finally { context.cleanup(); }
});

test("path-looking session text is stored as identity data, never as a path component", () => {
  const context = fixture();
  try {
    for (const value of ["../other", "nested/session", ".", "..", "x\\y"]) {
      const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: value });
      assert.equal(identity.session, value);
      assert.match(identity.sessionPath, /^[a-f0-9]{32}$/u);
    }
    assert.throws(() => sessionId(""), /identifier/u);
    mkdirSync(join(context.root, "nested"));
  } finally { context.cleanup(); }
});
