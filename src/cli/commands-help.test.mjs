import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cli = join(root, "bin", "burnlist.mjs");

function fixture({ git = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-command-help-"));
  if (git) execFileSync("git", ["init", "--quiet", directory]);
  return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

test("install, uninstall, and hooks subcommand help exit successfully with usage", () => {
  const context = fixture({ git: false });
  try {
    for (const [args, usage] of [
      [["install", "--help"], /Usage: burnlist install/u],
      [["uninstall", "--help"], /Usage: burnlist uninstall/u],
      [["hooks", "install", "--help"], /Usage: burnlist hooks/u],
      [["hooks", "uninstall", "--help"], /Usage: burnlist hooks/u],
      [["hooks", "status", "--help"], /Usage: burnlist hooks/u],
    ]) {
      const result = run(context.directory, args);
      assert.equal(result.status, 0, args.join(" "));
      assert.match(result.stdout, usage);
      assert.doesNotMatch(result.stderr, /unexpected argument/u);
    }
  } finally { context.cleanup(); }
});

test("top-level and Oven help expose the validated use and set flow", () => {
  const context = fixture({ git: false });
  try {
    const top = run(context.directory, ["--help"]);
    assert.equal(top.status, 0, top.stderr);
    assert.match(top.stdout, /burnlist -i \[--server <url>\]/u);
    assert.match(top.stdout, /-i, --interactive\s+Open the interactive terminal UI/u);
    assert.match(top.stdout, /burnlist oven <[^\n]*use[^\n]*set[^\n]*>/u);

    const oven = run(context.directory, ["oven", "help"]);
    assert.equal(oven.status, 0, oven.stderr);
    assert.match(oven.stdout, /burnlist oven use <id> \[--repo <path>\] \[--force\]/u);
    assert.match(oven.stdout, /burnlist oven set <id> <path\|-\|json> \[--repo <path>\]/u);
    assert.match(oven.stdout, /same runtime validator/u);
    assert.match(oven.stdout, /shape-only/u);
    assert.match(oven.stdout, /\.local\/burnlist\/data\/<id>\.json/u);
  } finally { context.cleanup(); }
});

test("empty skill and hook uninstalls report that there is nothing to remove", () => {
  const context = fixture();
  try {
    for (const args of [["uninstall"], ["hooks", "uninstall"]]) {
      const result = run(context.directory, args);
      assert.equal(result.status, 0, args.join(" "));
      assert.match(result.stdout, /Burnlist: nothing installed to remove\./u);
    }
  } finally { context.cleanup(); }
});

test("hooks status labels CLI capability and identifies the inspected config", () => {
  const context = fixture();
  try {
    const result = run(context.directory, ["hooks", "status", "--agent", "codex"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /codex: none;.*config .*\.codex\/hooks\.json/u);
    assert.match(result.stdout, /^codex cli: /mu);
  } finally { context.cleanup(); }
});

test("hooks install outside Git gives a friendly actionable error", () => {
  const context = fixture({ git: false });
  try {
    mkdirSync(join(context.directory, "nested"));
    const result = run(join(context.directory, "nested"), ["hooks", "install"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hooks install must run inside a Git repository/u);
    assert.doesNotMatch(result.stderr, /fatal:/u);
  } finally { context.cleanup(); }
});

test("hooks status and uninstall name their own Git requirement", () => {
  const context = fixture({ git: false });
  try {
    for (const command of ["status", "uninstall"]) {
      const result = run(context.directory, ["hooks", command]);
      assert.equal(result.status, 1, command);
      assert.match(result.stderr, new RegExp(`hooks ${command} must run inside a Git repository`, "u"));
      assert.doesNotMatch(result.stderr, /hooks install must run/u);
    }
  } finally { context.cleanup(); }
});
