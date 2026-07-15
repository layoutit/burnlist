import assert from "node:assert/strict";
import { fstatSync, mkdtempSync, readSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { captureCard, STREAMING_DIFF_ABSENT, STREAMING_DIFF_MISSING } from "./streaming-diff-capture.mjs";
import { createGitCaptureIo, readContainedFile, snapshotGitPaths } from "./streaming-diff-capture-git.mjs";

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-diff-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test"]);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("git captures tracked ignored paths but denies ignored untracked paths", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.root, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(context.root, "ignored.txt"), "tracked ignored\n");
    writeFileSync(join(context.root, "untracked-ignored.txt"), "inside\n");
    writeFileSync(join(context.root, ".gitignore"), "ignored.txt\nuntracked-ignored.txt\n");
    writeFileSync(join(context.root, "outside.txt"), "outside\n");
    git(context.root, ["add", ".gitignore"]);
    git(context.root, ["add", "-f", "ignored.txt"]);
    git(context.root, ["commit", "--quiet", "-m", "fixture"]);
    const io = createGitCaptureIo(context.root);
    assert.equal(io.isTracked("ignored.txt"), true);
    assert.equal(io.isIgnored("ignored.txt"), false, "Git does not ignore a tracked path for capture");
    assert.equal(io.isTracked("untracked-ignored.txt"), false);
    assert.equal(io.isIgnored("untracked-ignored.txt"), true);
    assert.deepEqual(io.listUntracked(["untracked-ignored.txt"]), []);
    const notGit = mkdtempSync(join(tmpdir(), "not-a-git-"));
    try {
      assert.throws(() => createGitCaptureIo(notGit).isIgnored("x"), /not a git repository/u);
    } finally {
      rmSync(notGit, { recursive: true, force: true });
    }
  } finally {
    context.cleanup();
  }
});

test("descriptor reader rejects a symlink swap and reports oversized files without returning content", () => {
  const context = fixture();
  const outside = mkdtempSync(join(tmpdir(), "burnlist-streaming-diff-outside-"));
  try {
    writeFileSync(join(context.root, "post.txt"), "inside content");
    writeFileSync(join(outside, "secret.txt"), "outside content");
    const io = createGitCaptureIo(context.root, { maxFileBytes: 16 });
    assert.equal(io.inspect("post.txt").contained, true);
    rmSync(join(context.root, "post.txt"));
    symlinkSync(join(outside, "secret.txt"), join(context.root, "post.txt"));
    assert.equal(io.readPost("post.txt"), STREAMING_DIFF_ABSENT);
    rmSync(join(context.root, "post.txt"));
    writeFileSync(join(context.root, "large.txt"), "x".repeat(128));
    assert.deepEqual(io.readPost("large.txt"), { truncated: true, bytes: 128 });
  } finally {
    context.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("descriptor reader bounds reads and rejects a file that grows after fstat", () => {
  const context = fixture();
  try {
    const large = join(context.root, "large.txt");
    writeFileSync(large, "x".repeat(1_024));
    const requested = [];
    const truncated = readContainedFile(realpathSync(context.root), large, 16, {
      read(fd, buffer, offset, length, position) {
        requested.push(length);
        return readSync(fd, buffer, offset, length, position);
      },
    });
    assert.deepEqual(truncated, { truncated: true, bytes: 1_024 });
    assert.deepEqual(requested, [17]);

    const growing = join(context.root, "growing.txt");
    writeFileSync(growing, "before\n");
    let fstats = 0;
    const result = readContainedFile(realpathSync(context.root), growing, 64, {
      fstat(fd) {
        const stat = fstatSync(fd);
        if (++fstats === 1) writeFileSync(growing, "before\nafter growth\n");
        return stat;
      },
    });
    assert.equal(result, STREAMING_DIFF_MISSING);
    const card = captureCard({
      hintedPaths: ["growing.txt"],
      preSnapshot: new Map([["growing.txt", "before\n"]]),
      readPost: () => result,
      toolUseId: "tool-fixture",
      revId: "r-0123456789abcdef01234567",
      now: () => "2026-07-15T09:00:00.000Z",
    });
    assert.deepEqual(card, {
      revId: "r-0123456789abcdef01234567",
      toolUseId: "tool-fixture",
      ts: "2026-07-15T09:00:00.000Z",
      status: "partial",
      partialReason: "post-capture unavailable",
      files: [{ path: "growing.txt", kind: "unavailable", meta: { reason: "post-capture unavailable" } }],
    });
  } finally {
    context.cleanup();
  }
});

test("pre-snapshot builder distinguishes observed absence from a failed snapshot", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.root, "present.txt"), "present\n");
    const snapshot = snapshotGitPaths({ worktreeRoot: context.root, hintedPaths: ["gone.txt", "present.txt"] });
    assert.equal(snapshot.get("gone.txt"), STREAMING_DIFF_ABSENT);
    assert.equal(Buffer.from(snapshot.get("present.txt")).toString("utf8"), "present\n");
  } finally {
    context.cleanup();
  }
});
