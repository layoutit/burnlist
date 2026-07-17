import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cli = join(sourceRoot, "bin", "burnlist.mjs");
const skillSource = join(sourceRoot, "skills", "burnlist");
const { BURNLIST_CLAUDE_SKILLS_DIR, BURNLIST_SKILLS_DIR, ...baseEnv } = process.env;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-skills-install-cli-"));
  const repo = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(repo);
  mkdirSync(home);
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  return { root, repo, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: context.repo,
    encoding: "utf8",
    env: { ...baseEnv, HOME: context.home, USERPROFILE: context.home, ...env },
  });
}

function target(context, agent, root = context.repo) {
  return join(root, agent === "claude" ? ".claude" : ".agents", "skills", "burnlist");
}

function assertLink(path, source = skillSource) {
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(resolve(dirname(path), readlinkSync(path)), source);
}

function exclude(context) { return readFileSync(join(context.repo, ".git", "info", "exclude"), "utf8"); }
function gitStatus(context) { return execFileSync("git", ["status", "--porcelain"], { cwd: context.repo, encoding: "utf8" }); }
function gitCheckIgnore(context, path) { return execFileSync("git", ["check-ignore", "-v", "--", path], { cwd: context.repo, encoding: "utf8" }); }

test("default repository install is local and excluded, then uninstall restores its exclude lines", () => {
  const context = fixture();
  try {
    const excludePath = join(context.repo, ".git", "info", "exclude");
    writeFileSync(excludePath, `${readFileSync(excludePath, "utf8")}# unrelated\n/custom/\n`);
    const before = exclude(context);
    const installed = run(context, ["install"]);
    assert.equal(installed.status, 0);
    assert.match(installed.stdout, /mode untracked \(local, \.git\/info\/exclude\); exclude entry written/u);
    const claude = target(context, "claude");
    const codex = target(context, "codex");
    assertLink(claude);
    assertLink(codex);
    assert.match(exclude(context), /^\/\.claude\/skills\/burnlist$/mu);
    assert.match(exclude(context), /^\/\.agents\/skills\/burnlist$/mu);
    assert.equal(gitStatus(context), "");
    assert.match(gitCheckIgnore(context, ".claude/skills/burnlist"), /\.claude\/skills\/burnlist/u);
    assert.match(gitCheckIgnore(context, ".agents/skills/burnlist"), /\.agents\/skills\/burnlist/u);
    assert.equal(run(context, ["uninstall"]).status, 0);
    assert.equal(existsSync(claude), false);
    assert.equal(existsSync(codex), false);
    assert.equal(exclude(context), before);
    assert.equal(existsSync(dirname(claude)), false);
    assert.equal(existsSync(dirname(codex)), false);
  } finally { context.cleanup(); }
});

test("reinstall is idempotent and retains exact-source links", () => {
  const context = fixture();
  try {
    assert.equal(run(context, ["install"]).status, 0);
    const firstLink = readlinkSync(target(context, "codex"));
    const second = run(context, ["install"]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /kept .*burnlist/u);
    assert.match(second.stdout, /mode untracked \(local, \.git\/info\/exclude\)/u);
    assert.equal(readlinkSync(target(context, "codex")), firstLink);
    assertLink(target(context, "claude"));
    assert.equal((exclude(context).match(/^\/\.claude\/skills\/burnlist$/gmu) ?? []).length, 1);
    assert.equal((exclude(context).match(/^\/\.agents\/skills\/burnlist$/gmu) ?? []).length, 1);
  } finally { context.cleanup(); }
});

test("--commit installs portable marked copies that git can add, is idempotent, and uninstalls them", () => {
  const context = fixture();
  try {
    const first = run(context, ["install", "--commit"]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /mode committable \(portable copy; run git add to track\); no owned exclude entry to remove/u);
    for (const agent of ["claude", "codex"]) {
      const destination = target(context, agent);
      assert.equal(lstatSync(destination).isDirectory(), true);
      assert.equal(lstatSync(destination).isSymbolicLink(), false);
      assert.equal(existsSync(join(destination, "SKILL.md")), true);
      const marker = JSON.parse(readFileSync(join(destination, ".burnlist-managed.json"), "utf8"));
      assert.deepEqual(marker, { managedBy: "burnlist", skill: "burnlist", mode: "commit", version: "0.0.2" });
      assert.equal(Object.hasOwn(marker, "sourceRelative"), false);
      assert.doesNotMatch(JSON.stringify(marker), new RegExp(context.root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
    assert.doesNotMatch(exclude(context), /\/\.(?:claude|agents)\/skills\/burnlist/u);
    assert.match(gitStatus(context), /\?\? \.agents\//u);
    assert.match(gitStatus(context), /\?\? \.claude\//u);
    const second = run(context, ["install", "--commit"]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /kept .*mode committable/u);
    assert.equal(run(context, ["uninstall"]).status, 0);
    assert.equal(existsSync(target(context, "claude")), false);
    assert.equal(existsSync(target(context, "codex")), false);
  } finally { context.cleanup(); }
});

test("uninstall leaves a foreign copy without the provenance marker untouched", () => {
  const context = fixture();
  try {
    assert.equal(run(context, ["install", "--commit", "--agent", "codex"]).status, 0);
    const destination = target(context, "codex");
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination);
    writeFileSync(join(destination, "SKILL.md"), "foreign\n");
    const result = run(context, ["uninstall", "--agent", "codex"]);
    assert.equal(result.status, 0);
    assert.equal(lstatSync(destination).isDirectory(), true);
    assert.match(result.stderr, /left .* untouched/u);
  } finally { context.cleanup(); }
});

test("uninstall removes owned excludes for missing or foreign targets without touching them", () => {
  const context = fixture();
  try {
    assert.equal(run(context, ["install"]).status, 0);
    const claude = target(context, "claude");
    const codex = target(context, "codex");
    rmSync(claude, { recursive: true, force: true });
    rmSync(codex, { recursive: true, force: true });
    mkdirSync(codex);
    writeFileSync(join(codex, "SKILL.md"), "foreign\n");
    const result = run(context, ["uninstall"]);
    assert.equal(result.status, 0);
    assert.equal(lstatSync(codex).isDirectory(), true);
    assert.doesNotMatch(exclude(context), /# burnlist-managed:skills@1\n\/\.(?:claude|agents)\/skills\/burnlist/u);
    assert.match(result.stderr, /left .* untouched/u);
  } finally { context.cleanup(); }
});

test("default install in a non-git directory remains a local symlink and reports no exclude destination", () => {
  const context = fixture();
  try {
    rmSync(join(context.repo, ".git"), { recursive: true, force: true });
    const result = run(context, ["install", "--agent", "codex"]);
    assert.equal(result.status, 0);
    assertLink(target(context, "codex"));
    assert.match(result.stdout, /mode symlink \(no git repo to exclude into\)/u);
  } finally { context.cleanup(); }
});

test("--commit in a non-git directory installs a marked portable copy without git instructions", () => {
  const context = fixture();
  try {
    rmSync(join(context.repo, ".git"), { recursive: true, force: true });
    const installed = run(context, ["install", "--commit", "--agent", "codex"]);
    const destination = target(context, "codex");
    assert.equal(installed.status, 0);
    assert.doesNotMatch(installed.stdout, /git add/u);
    assert.match(installed.stdout, /mode portable copy \(no git repo\)/u);
    assert.equal(lstatSync(destination).isDirectory(), true);
    assert.equal(lstatSync(destination).isSymbolicLink(), false);
    assert.deepEqual(JSON.parse(readFileSync(join(destination, ".burnlist-managed.json"), "utf8")), {
      managedBy: "burnlist", skill: "burnlist", mode: "commit", version: "0.0.2",
    });
    const uninstalled = run(context, ["uninstall", "--agent", "codex"]);
    assert.equal(uninstalled.status, 0);
    assert.doesNotMatch(uninstalled.stdout, /git add/u);
    assert.match(uninstalled.stdout, /mode portable copy \(no git repo\)/u);
    assert.equal(existsSync(destination), false);
  } finally { context.cleanup(); }
});

test("default install refuses a target already tracked by git instead of excluding it", () => {
  const context = fixture();
  try {
    const destination = target(context, "claude");
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "SKILL.md"), "tracked\n");
    execFileSync("git", ["add", ".claude/skills/burnlist/SKILL.md"], { cwd: context.repo });
    const before = exclude(context);
    const result = run(context, ["install"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already tracked by git; refusing to hide a tracked skill/u);
    assert.equal(exclude(context), before);
  } finally { context.cleanup(); }
});

test("--commit reports a content-file ignore even when the copy directory is not ignored", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.repo, ".gitignore"), "*.md\n");
    const result = run(context, ["install", "--commit", "--agent", "codex"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /mode still ignored \(portable copy; ignored by .*\.gitignore:1:\*\.md/u);
    assert.match(gitCheckIgnore(context, ".agents/skills/burnlist/SKILL.md"), /\.gitignore/u);
    assert.equal(spawnSync("git", ["check-ignore", "--", ".agents/skills/burnlist"], { cwd: context.repo }).status, 1);
  } finally { context.cleanup(); }
});

test("default install refuses to downgrade a portable copy unless --force is explicit", () => {
  const context = fixture();
  try {
    assert.equal(run(context, ["install", "--commit", "--agent", "codex"]).status, 0);
    const refused = run(context, ["install", "--agent", "codex"]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /would downgrade a committed copy.*pass --force/u);
    assert.equal(lstatSync(target(context, "codex")).isSymbolicLink(), false);
    const forced = run(context, ["install", "--force", "--agent", "codex"]);
    assert.equal(forced.status, 0);
    assertLink(target(context, "codex"));
  } finally { context.cleanup(); }
});

test("--force refuses to downgrade a tracked portable copy", () => {
  const context = fixture();
  try {
    assert.equal(run(context, ["install", "--commit", "--agent", "codex"]).status, 0);
    execFileSync("git", ["add", ".agents/skills/burnlist"], { cwd: context.repo });
    const forced = run(context, ["install", "--force", "--agent", "codex"]);
    assert.equal(forced.status, 1);
    assert.match(forced.stderr, /tracked portable copy; refusing to replace.*Run git rm/u);
    assert.equal(lstatSync(target(context, "codex")).isSymbolicLink(), false);
  } finally { context.cleanup(); }
});

test("uninstall removes empty skill parents but retains a parent containing a foreign entry", () => {
  const context = fixture();
  try {
    assert.equal(run(context, ["install"]).status, 0);
    const codexSkills = dirname(target(context, "codex"));
    mkdirSync(join(codexSkills, "foreign"));
    writeFileSync(join(codexSkills, "foreign", "SKILL.md"), "foreign\n");
    assert.equal(run(context, ["uninstall"]).status, 0);
    assert.equal(existsSync(join(context.repo, ".claude")), false);
    assert.equal(lstatSync(codexSkills).isDirectory(), true);
    assert.equal(existsSync(join(codexSkills, "foreign", "SKILL.md")), true);
  } finally { context.cleanup(); }
});

test("global install and uninstall honor isolated skill-directory overrides", () => {
  const context = fixture();
  try {
    const claudeSkills = join(context.root, "claude-skills");
    const codexSkills = join(context.root, "codex-skills");
    const env = { BURNLIST_CLAUDE_SKILLS_DIR: claudeSkills, BURNLIST_SKILLS_DIR: codexSkills };
    const installed = run(context, ["install", "--global"], env);
    assert.equal(installed.status, 0);
    assert.match(installed.stdout, /global symlink \(no repo exclude\)/u);
    assertLink(join(claudeSkills, "burnlist"));
    assertLink(join(codexSkills, "burnlist"));
    assert.equal(existsSync(join(context.home, ".claude", "skills", "burnlist")), false);
    assert.equal(existsSync(join(context.home, ".agents", "skills", "burnlist")), false);
    const uninstalled = run(context, ["uninstall", "--global"], env);
    assert.equal(uninstalled.status, 0);
    assert.match(uninstalled.stdout, /global symlink \(no repo exclude\)/u);
    assert.equal(existsSync(join(claudeSkills, "burnlist")), false);
    assert.equal(existsSync(join(codexSkills, "burnlist")), false);
    assert.equal(lstatSync(claudeSkills).isDirectory(), true);
    assert.equal(lstatSync(codexSkills).isDirectory(), true);
  } finally { context.cleanup(); }
});

test("global install refuses foreign files, directories, and symlinks without touching them", () => {
  for (const foreign of ["file", "directory", "symlink"]) {
    const context = fixture();
    try {
      const claudeSkills = join(context.root, "claude-skills");
      const codexSkills = join(context.root, "codex-skills");
      const destination = join(claudeSkills, "burnlist");
      const env = { BURNLIST_CLAUDE_SKILLS_DIR: claudeSkills, BURNLIST_SKILLS_DIR: codexSkills };
      mkdirSync(claudeSkills, { recursive: true });
      if (foreign === "file") writeFileSync(destination, "foreign\n");
      else if (foreign === "directory") mkdirSync(destination);
      else {
        const foreignSource = join(context.root, "foreign-burnlist");
        mkdirSync(foreignSource);
        writeFileSync(join(foreignSource, "SKILL.md"), "foreign\n");
        symlinkSync(foreignSource, destination, process.platform === "win32" ? "junction" : "dir");
      }

      const result = run(context, ["install", "--global"], env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, foreign === "symlink"
        ? /already links to a different skill source/u
        : /not a Burnlist-managed symlink or provenance-marked portable copy/u);
      assert.equal(lstatSync(destination).isSymbolicLink(), foreign === "symlink");
      assert.equal(lstatSync(destination).isDirectory(), foreign === "directory");
      if (foreign === "file") assert.equal(readFileSync(destination, "utf8"), "foreign\n");
      if (foreign === "symlink") assert.notEqual(readlinkSync(destination), skillSource);
      assert.equal(existsSync(join(codexSkills, "burnlist")), false);
    } finally { context.cleanup(); }
  }
});
