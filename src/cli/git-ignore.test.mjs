import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-git-ignore-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return { repo, home: join(root, "home"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, ...args) {
  return execFileSync(process.execPath, [binPath, ...args], {
    cwd: context.repo,
    encoding: "utf8",
    env: { ...process.env, HOME: context.home },
  });
}

function ovenPackage() {
  return {
    instructions: "# Local Oven\n\nKeep this local.",
    detail: {
      version: 1,
      columns: 2,
      rows: 2,
      rowHeight: 48,
      cells: [{
        id: "summary", title: "Summary", description: "Current state.", widget: "metric", source: "/summary", format: "plain",
        column: 1, row: 1, columnSpan: 2, rowSpan: 1,
      }],
    },
  };
}

test("oven writes require ignored local storage only in Git repositories", () => {
  const gitContext = fixture();
  const gitPackage = join(gitContext.repo, "oven.json");
  const gitOven = join(gitContext.repo, ".local", "burnlist", "ovens", "guarded-oven");
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: gitContext.repo, stdio: "ignore" });
    writeFileSync(gitPackage, JSON.stringify(ovenPackage()));
    assert.throws(
      () => run(gitContext, "oven", "create", "guarded-oven", "--package", gitPackage),
      (error) => String(error.stderr).includes("refusing to write .local/burnlist/ovens: not git-ignored"),
    );
    assert.equal(existsSync(gitOven), false);

    run(gitContext, "init", gitContext.repo);
    run(gitContext, "oven", "create", "guarded-oven", "--package", gitPackage);
    assert.equal(existsSync(join(gitOven, "current")), true);
  } finally { gitContext.cleanup(); }

  const nonGitContext = fixture();
  const nonGitPackage = join(nonGitContext.repo, "oven.json");
  try {
    writeFileSync(nonGitPackage, JSON.stringify(ovenPackage()));
    run(nonGitContext, "oven", "create", "non-git-oven", "--package", nonGitPackage);
    assert.equal(existsSync(join(nonGitContext.repo, ".local", "burnlist", "ovens", "non-git-oven", "current")), true);
  } finally { nonGitContext.cleanup(); }
});
