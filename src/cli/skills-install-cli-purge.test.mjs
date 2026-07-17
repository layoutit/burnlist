import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  const root = mkdtempSync(join(tmpdir(), "burnlist-skills-install-cli-purge-"));
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

function target(context, agent) {
  return join(context.repo, agent === "claude" ? ".claude" : ".agents", "skills", "burnlist");
}

function assertLink(path, source = skillSource) {
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(resolve(dirname(path), readlinkSync(path)), source);
}

function exclude(context) { return readFileSync(join(context.repo, ".git", "info", "exclude"), "utf8"); }

test("failed global purge runs npm first and leaves skill links untouched", () => {
  const context = fixture();
  try {
    const packageRoot = join(context.root, "npm", "lib", "node_modules", "burnlist");
    cpSync(join(sourceRoot, "skills"), join(packageRoot, "skills"), { recursive: true });
    const claudeSkills = join(context.root, "claude-skills");
    const codexSkills = join(context.root, "codex-skills");
    const env = { ...baseEnv, HOME: context.home, USERPROFILE: context.home, BURNLIST_CLAUDE_SKILLS_DIR: claudeSkills, BURNLIST_SKILLS_DIR: codexSkills };
    const logs = [];
    const errors = [];
    const packageSkill = join(packageRoot, "skills", "burnlist");
    assert.equal(runSkillsInstallCli({ args: ["install", "--global"], packageRoot, cwd: context.repo, env, log: (line) => logs.push(line) }), 0);
    assertLink(join(claudeSkills, "burnlist"), packageSkill);
    assertLink(join(codexSkills, "burnlist"), packageSkill);
    const calls = [];
    const failNpm = (command, args) => {
      calls.push({ command, args });
      assertLink(join(claudeSkills, "burnlist"), packageSkill);
      assertLink(join(codexSkills, "burnlist"), packageSkill);
      return { status: 1 };
    };
    assert.equal(runSkillsInstallCli({ args: ["uninstall", "--global", "--purge"], packageRoot, cwd: context.repo, env, log: (line) => logs.push(line), error: (line) => errors.push(line), spawn: failNpm }), 1);
    assert.deepEqual(calls, [{ command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["uninstall", "--global", "--prefix", join(context.root, "npm"), "burnlist"] }]);
    assertLink(join(claudeSkills, "burnlist"), packageSkill);
    assertLink(join(codexSkills, "burnlist"), packageSkill);
    assert.doesNotMatch(logs.join("\n"), /restored|removed/u);
    assert.match(errors.join("\n"), /npm uninstall failed; checking global skill registrations for newly broken links/u);
  } finally { context.cleanup(); }
});

test("global purge dry-run includes managed skill registrations", () => {
  const context = fixture();
  try {
    const env = { ...baseEnv, HOME: context.home, USERPROFILE: context.home };
    assert.equal(runSkillsInstallCli({ args: ["install", "--global"], packageRoot: sourceRoot, cwd: context.repo, env, log: () => {} }), 0);
    const logs = [];
    assert.equal(runSkillsInstallCli({ args: ["uninstall", "--global", "--purge", "--dry-run"], packageRoot: sourceRoot, cwd: context.repo, env, log: (line) => logs.push(line) }), 0);
    assert.match(logs.join("\n"), /would uninstall the global npm package/u);
    assert.match(logs.join("\n"), /would remove .*global managed registration/u);
  } finally { context.cleanup(); }
});

test("npm-successful global purge aggregates every cleanup failure", () => {
  const context = fixture();
  try {
    const packageRoot = join(context.root, "npm", "lib", "node_modules", "burnlist");
    cpSync(join(sourceRoot, "skills"), join(packageRoot, "skills"), { recursive: true });
    const claudeSkills = join(context.root, "claude-skills");
    const codexSkills = join(context.root, "codex-skills");
    const env = { ...baseEnv, HOME: context.home, USERPROFILE: context.home, BURNLIST_CLAUDE_SKILLS_DIR: claudeSkills, BURNLIST_SKILLS_DIR: codexSkills };
    const packageSkill = join(packageRoot, "skills", "burnlist");
    assert.equal(runSkillsInstallCli({ args: ["install", "--global"], packageRoot, cwd: context.repo, env }), 0);
    const attempted = [];
    const errors = [];
    const status = runSkillsInstallCli({
      args: ["uninstall", "--global", "--purge"], packageRoot, cwd: context.repo, env,
      spawn: () => {
        assertLink(join(claudeSkills, "burnlist"), packageSkill);
        assertLink(join(codexSkills, "burnlist"), packageSkill);
        return { status: 0 };
      },
      remove(path) { attempted.push(path); throw new Error(`blocked ${path}`); },
      error: (line) => errors.push(line),
    });
    assert.equal(status, 1);
    assert.equal(attempted.length, 2);
    assert.ok(attempted.every((path) => /\.burnlist\.burnlist-quarantine-.+\/object$/u.test(path)));
    assert.match(errors.join("\n"), /could not remove 2 global skill registration/u);
    assertLink(join(claudeSkills, "burnlist"), packageSkill);
    assertLink(join(codexSkills, "burnlist"), packageSkill);
  } finally { context.cleanup(); }
});

test("failed npm purge removes and reports only newly dangling global links", () => {
  const context = fixture();
  try {
    const packageRoot = join(context.root, "npm", "lib", "node_modules", "burnlist");
    cpSync(join(sourceRoot, "skills"), join(packageRoot, "skills"), { recursive: true });
    const claudeSkills = join(context.root, "claude-skills");
    const codexSkills = join(context.root, "codex-skills");
    const env = { ...baseEnv, HOME: context.home, USERPROFILE: context.home, BURNLIST_CLAUDE_SKILLS_DIR: claudeSkills, BURNLIST_SKILLS_DIR: codexSkills };
    assert.equal(runSkillsInstallCli({ args: ["install", "--global"], packageRoot, cwd: context.repo, env }), 0);
    const errors = [];
    const status = runSkillsInstallCli({
      args: ["uninstall", "--global", "--purge"], packageRoot, cwd: context.repo, env,
      spawn: () => { rmSync(packageRoot, { recursive: true, force: true }); return { status: 1 }; },
      error: (line) => errors.push(line),
    });
    assert.equal(status, 1);
    assert.equal(existsSync(join(claudeSkills, "burnlist")), false);
    assert.equal(existsSync(join(codexSkills, "burnlist")), false);
    assert.match(errors.join("\n"), /removed now-broken global skill link\(s\):/u);
    assert.match(errors.join("\n"), new RegExp(claudeSkills, "u"));
    assert.match(errors.join("\n"), new RegExp(codexSkills, "u"));
  } finally { context.cleanup(); }
});

test("global purge rechecks snapshot ownership before removing registrations", () => {
  const context = fixture();
  try {
    const packageRoot = join(context.root, "npm", "lib", "node_modules", "burnlist");
    cpSync(join(sourceRoot, "skills"), join(packageRoot, "skills"), { recursive: true });
    const claudeSkills = join(context.root, "claude-skills");
    const codexSkills = join(context.root, "codex-skills");
    const env = { ...baseEnv, HOME: context.home, USERPROFILE: context.home, BURNLIST_CLAUDE_SKILLS_DIR: claudeSkills, BURNLIST_SKILLS_DIR: codexSkills };
    const packageSkill = join(packageRoot, "skills", "burnlist");
    assert.equal(runSkillsInstallCli({ args: ["install", "--global"], packageRoot, cwd: context.repo, env }), 0);
    const foreignSource = join(context.root, "foreign-skill");
    mkdirSync(foreignSource);
    writeFileSync(join(foreignSource, "SKILL.md"), "foreign\n");
    assert.equal(runSkillsInstallCli({
      args: ["uninstall", "--global", "--purge"], packageRoot, cwd: context.repo, env,
      spawn: () => {
        rmSync(join(codexSkills, "burnlist"), { recursive: true, force: true });
        symlinkSync(foreignSource, join(codexSkills, "burnlist"), process.platform === "win32" ? "junction" : "dir");
        return { status: 0 };
      },
    }), 0);
    assert.equal(existsSync(join(claudeSkills, "burnlist")), false);
    assert.equal(readlinkSync(join(codexSkills, "burnlist")), foreignSource);
    assert.notEqual(readlinkSync(join(codexSkills, "burnlist")), packageSkill);
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

test("--dry-run reports the honest mode and exclude outcome without writing", () => {
  const context = fixture();
  try {
    const result = run(context, ["install", "--dry-run"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /would link .*\.claude.*burnlist/u);
    assert.match(result.stdout, /would link .*\.agents.*burnlist/u);
    assert.match(result.stdout, /mode untracked \(local, \.git\/info\/exclude\); would write exclude entry/u);
    const committed = run(context, ["install", "--commit", "--dry-run"]);
    assert.equal(committed.status, 0);
    assert.match(committed.stdout, /would copy .*mode committable \(portable copy; run git add to track\); no owned exclude entry to remove/u);
    assert.equal(existsSync(join(context.repo, ".claude")), false);
    assert.equal(existsSync(join(context.repo, ".agents")), false);
    assert.doesNotMatch(exclude(context), /\/\.(?:claude|agents)\/skills\/burnlist/u);
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
