import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runSkillsInstallCli } from "./skills-install-cli.mjs";

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

test("install and uninstall round-trip both repository agent links without removing parent directories", () => {
  const context = fixture();
  try {
    assert.equal(run(context, ["install"]).status, 0);
    const claude = target(context, "claude");
    const codex = target(context, "codex");
    assertLink(claude);
    assertLink(codex);
    assert.equal(run(context, ["uninstall"]).status, 0);
    assert.equal(existsSync(claude), false);
    assert.equal(existsSync(codex), false);
    assert.equal(lstatSync(dirname(claude)).isDirectory(), true);
    assert.equal(lstatSync(dirname(codex)).isDirectory(), true);
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
    assert.equal(readlinkSync(target(context, "codex")), firstLink);
    assertLink(target(context, "claude"));
  } finally { context.cleanup(); }
});

test("global install and uninstall honor isolated skill-directory overrides", () => {
  const context = fixture();
  try {
    const claudeSkills = join(context.root, "claude-skills");
    const codexSkills = join(context.root, "codex-skills");
    const env = { BURNLIST_CLAUDE_SKILLS_DIR: claudeSkills, BURNLIST_SKILLS_DIR: codexSkills };
    assert.equal(run(context, ["install", "--global"], env).status, 0);
    assertLink(join(claudeSkills, "burnlist"));
    assertLink(join(codexSkills, "burnlist"));
    assert.equal(existsSync(join(context.home, ".claude", "skills", "burnlist")), false);
    assert.equal(existsSync(join(context.home, ".agents", "skills", "burnlist")), false);
    assert.equal(run(context, ["uninstall", "--global"], env).status, 0);
    assert.equal(existsSync(join(claudeSkills, "burnlist")), false);
    assert.equal(existsSync(join(codexSkills, "burnlist")), false);
  } finally { context.cleanup(); }
});

test("failed global purge restores exactly the removed links without running npm", () => {
  const context = fixture();
  try {
    const packageRoot = join(context.root, "npm", "lib", "node_modules", "burnlist");
    cpSync(join(sourceRoot, "skills"), join(packageRoot, "skills"), { recursive: true });
    const claudeSkills = join(context.root, "claude-skills");
    const codexSkills = join(context.root, "codex-skills");
    const env = {
      ...baseEnv,
      HOME: context.home,
      USERPROFILE: context.home,
      BURNLIST_CLAUDE_SKILLS_DIR: claudeSkills,
      BURNLIST_SKILLS_DIR: codexSkills,
    };
    const logs = [];
    const packageSkill = join(packageRoot, "skills", "burnlist");
    assert.equal(runSkillsInstallCli({ args: ["install", "--global"], packageRoot, cwd: context.repo, env, log: (line) => logs.push(line) }), 0);
    assertLink(join(claudeSkills, "burnlist"), packageSkill);
    assertLink(join(codexSkills, "burnlist"), packageSkill);

    const calls = [];
    const failNpm = (command, args) => {
      calls.push({ command, args });
      mkdirSync(join(packageRoot, "skills", "foreign"));
      writeFileSync(join(packageRoot, "skills", "foreign", "SKILL.md"), "---\nname: foreign\n---\n");
      symlinkSync(join(context.root, "foreign-skill"), join(claudeSkills, "foreign"));
      return { status: 1 };
    };
    assert.equal(runSkillsInstallCli({ args: ["uninstall", "--global", "--purge"], packageRoot, cwd: context.repo, env, log: (line) => logs.push(line), spawn: failNpm }), 1);

    assert.deepEqual(calls, [{ command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["uninstall", "--global", "--prefix", join(context.root, "npm"), "burnlist"] }]);
    assertLink(join(claudeSkills, "burnlist"), packageSkill);
    assertLink(join(codexSkills, "burnlist"), packageSkill);
    assert.equal(readlinkSync(join(claudeSkills, "foreign")), join(context.root, "foreign-skill"));
    assert.match(logs.join("\n"), /restored .*burnlist/u);
  } finally { context.cleanup(); }
});

test("--agent scopes the install and uninstall to the requested agent", () => {
  const context = fixture();
  try {
    assert.equal(run(context, ["install", "--agent", "codex"]).status, 0);
    assertLink(target(context, "codex"));
    assert.equal(existsSync(target(context, "claude")), false);
    assert.equal(run(context, ["uninstall", "--agent", "codex"]).status, 0);
    assert.equal(existsSync(target(context, "codex")), false);
  } finally { context.cleanup(); }
});

test("--dry-run prints intended links without writing", () => {
  const context = fixture();
  try {
    const result = run(context, ["install", "--dry-run"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /would link .*\.claude.*burnlist/u);
    assert.match(result.stdout, /would link .*\.agents.*burnlist/u);
    assert.equal(existsSync(join(context.repo, ".claude")), false);
    assert.equal(existsSync(join(context.repo, ".agents")), false);
  } finally { context.cleanup(); }
});

test("unknown --agent values fail with valid choices", () => {
  const context = fixture();
  try {
    const result = run(context, ["install", "--agent", "cursor"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown --agent value: cursor\. Valid agents: codex, claude\./u);
  } finally { context.cleanup(); }
});
