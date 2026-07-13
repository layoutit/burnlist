import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveUmbrella } from "./umbrella.mjs";

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function fixture({ separateGitDir = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-umbrella-"));
  const gitDir = separateGitDir ? mkdtempSync(join(tmpdir(), "burnlist-umbrella-git-")) : null;
  git(root, "init", "--quiet", ...(gitDir ? ["--separate-git-dir", gitDir] : []));
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Burnlist Test");
  git(root, "commit", "--allow-empty", "--quiet", "-m", "initial");
  return {
    root,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      if (gitDir) rmSync(gitDir, { recursive: true, force: true });
    },
  };
}

test("resolveUmbrella returns the repository root from a subdirectory", () => {
  const { root, cleanup } = fixture();
  const subdir = join(root, "nested", "directory");
  mkdirSync(subdir, { recursive: true });
  try {
    assert.equal(resolveUmbrella(subdir), realpathSync(root));
  } finally {
    cleanup();
  }
});

test("resolveUmbrella returns the primary root from a linked worktree", () => {
  const { root, cleanup } = fixture();
  const linked = join(root, "linked-worktree");
  try {
    git(root, "worktree", "add", "--detach", linked);
    const subdir = join(linked, "nested");
    mkdirSync(subdir);
    assert.equal(resolveUmbrella(subdir), realpathSync(root));
  } finally {
    cleanup();
  }
});

test("resolveUmbrella resolves a primary worktree with a separate git directory", () => {
  const { root, cleanup } = fixture({ separateGitDir: true });
  try {
    assert.equal(resolveUmbrella(root), realpathSync(root));
  } finally {
    cleanup();
  }
});
