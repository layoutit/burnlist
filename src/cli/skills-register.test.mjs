import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { withGlobalSkillsLock } from "./skills-install-lock.mjs";
import { registerSkills, resolveRepoRoot } from "./skills-register.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const registerScript = join(repoRoot, "scripts", "register-skills.mjs");
const unregisterScript = join(repoRoot, "scripts", "unregister-skills.mjs");
const source = join(repoRoot, "skills", "burnlist");
const { BURNLIST_CLAUDE_SKILLS_DIR, BURNLIST_SKILLS_DIR, ...baseEnv } = process.env;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-skills-register-"));
  const repo = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(repo);
  mkdirSync(home);
  return { root, repo, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(script, context, args = [], env = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: context.repo,
    encoding: "utf8",
    env: { ...baseEnv, HOME: context.home, USERPROFILE: context.home, ...env },
  });
}

function linkedTo(path, expected = source) {
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(resolve(dirname(path), readlinkSync(path)), expected);
}

test("global dry-run describes Claude and Codex targets", () => {
  const context = fixture();
  try {
    const output = run(registerScript, context, ["--force-global", "--dry-run"]);
    assert.ok(output.includes(join(context.home, ".claude", "skills", "burnlist")));
    assert.ok(output.includes(join(context.home, ".agents", "skills", "burnlist")));
    assert.equal(lstatOrNull(join(context.home, ".claude", "skills", "burnlist")), null);
    assert.equal(lstatOrNull(join(context.home, ".agents", "skills", "burnlist")), null);
  } finally { context.cleanup(); }
});

test("repo dry-run describes both agent targets at the worktree root", () => {
  const context = fixture();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: context.repo });
    const nested = join(context.repo, "nested", "work");
    mkdirSync(nested, { recursive: true });
    const output = execFileSync(process.execPath, [registerScript, "--dry-run"], {
      cwd: nested,
      encoding: "utf8",
      env: { ...baseEnv, HOME: context.home, USERPROFILE: context.home },
    });
    const worktreeRoot = realpathSync(context.repo);
    assert.ok(output.includes(join(worktreeRoot, ".claude", "skills", "burnlist")));
    assert.ok(output.includes(join(worktreeRoot, ".agents", "skills", "burnlist")));
  } finally { context.cleanup(); }
});

test("each global override affects only its matching agent and remains idempotent", () => {
  for (const { override, overridden, defaultTarget } of [
    {
      override: "BURNLIST_CLAUDE_SKILLS_DIR",
      overridden: "claude-skills",
      defaultTarget: [".agents", "skills"],
    },
    {
      override: "BURNLIST_SKILLS_DIR",
      overridden: "codex-skills",
      defaultTarget: [".claude", "skills"],
    },
  ]) {
    const context = fixture();
    try {
      const target = join(context.root, overridden);
      const otherTarget = join(context.home, ...defaultTarget);
      const env = { [override]: target };
      run(registerScript, context, ["--force-global"], env);
      linkedTo(join(target, "burnlist"));
      linkedTo(join(otherTarget, "burnlist"));
      const output = run(registerScript, context, ["--force-global"], env);
      assert.match(output, /kept .*burnlist/u);
      run(unregisterScript, context, ["--force-global"], env);
      assert.equal(lstatOrNull(join(target, "burnlist")), null);
      assert.equal(lstatOrNull(join(otherTarget, "burnlist")), null);
    } finally { context.cleanup(); }
  }
});

test("global registration uses the shared global skill lock", () => {
  const context = fixture();
  try {
    const env = {
      ...baseEnv,
      HOME: context.home,
      USERPROFILE: context.home,
      BURNLIST_CLAUDE_SKILLS_DIR: join(context.root, "override-claude"),
      BURNLIST_SKILLS_DIR: join(context.root, "override-codex"),
    };
    assert.throws(() => withGlobalSkillsLock(env, () => {
      assert.equal(lstatSync(join(context.home, ".burnlist", ".local", "burnlist", ".lock")).isDirectory(), true);
      return registerSkills({
        sourceRoot: join(repoRoot, "skills"), scope: "global", cwd: context.repo, env, agents: ["codex"], log: () => {},
      });
    }), /Repo state is locked by pid/u);
  } finally { context.cleanup(); }
});

test("repo registration creates both agent links at a temporary worktree root and is idempotent", () => {
  const context = fixture();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: context.repo });
    run(registerScript, context);
    const claude = join(context.repo, ".claude", "skills", "burnlist");
    const codex = join(context.repo, ".agents", "skills", "burnlist");
    linkedTo(claude);
    linkedTo(codex);
    const output = run(registerScript, context, ["--scope=repo"]);
    assert.match(output, /kept .*burnlist/u);
    linkedTo(claude);
    linkedTo(codex);
  } finally { context.cleanup(); }
});

test("registration rolls every target and the exclude file back when its exclude write fails", () => {
  const context = fixture();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: context.repo });
    const options = {
      sourceRoot: join(repoRoot, "skills"), cwd: context.repo,
      env: { ...baseEnv, HOME: context.home, USERPROFILE: context.home }, log: () => {},
    };
    registerSkills(options);
    const excludePath = join(context.repo, ".git", "info", "exclude");
    const beforeExclude = readFileSync(excludePath, "utf8");
    assert.throws(
      () => registerSkills({ ...options, commit: true, stageAtomic: () => { throw new Error("injected exclude failure"); } }),
      /injected exclude failure/u,
    );
    linkedTo(join(context.repo, ".claude", "skills", "burnlist"));
    linkedTo(join(context.repo, ".agents", "skills", "burnlist"));
    assert.equal(readFileSync(excludePath, "utf8"), beforeExclude);
  } finally { context.cleanup(); }
});

test("exclude rollback preserves the original filesystem object type and mode", () => {
  for (const type of ["file", "symlink"]) {
    const context = fixture();
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: context.repo });
      const excludePath = join(context.repo, ".git", "info", "exclude");
      const original = "# original exclude\n/original/\n";
      let external;
      if (type === "symlink") {
        external = join(context.root, "external-exclude");
        writeFileSync(external, original);
        rmSync(excludePath);
        symlinkSync(external, excludePath);
      } else {
        writeFileSync(excludePath, original);
        chmodSync(excludePath, 0o644);
      }
      assert.throws(() => registerSkills({
        sourceRoot: join(repoRoot, "skills"), cwd: context.repo, agents: ["codex"],
        env: { ...baseEnv, HOME: context.home, USERPROFILE: context.home }, log: () => {},
        afterExcludeWrite: () => { throw new Error("injected post-exclude failure"); },
      }), /injected post-exclude failure/u);
      assert.equal(readFileSync(excludePath, "utf8"), original);
      if (type === "symlink") assert.equal(readlinkSync(excludePath), external);
      else assert.equal(lstatSync(excludePath).mode & 0o777, 0o644);
    } finally { context.cleanup(); }
  }
});

test("commit ignore checks the dereferenced published skill copy", () => {
  const context = fixture();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: context.repo });
    writeFileSync(join(context.repo, ".gitignore"), "*.md\n");
    const packageRoot = join(context.root, "package");
    const skills = join(packageRoot, "skills");
    const skill = join(skills, "burnlist");
    const linked = join(context.root, "linked-content");
    mkdirSync(skill, { recursive: true });
    mkdirSync(linked);
    writeFileSync(join(packageRoot, "package.json"), '{"version":"1.0.0"}\n');
    writeFileSync(join(skill, "SKILL.md"), "skill\n");
    writeFileSync(join(linked, "ignored.md"), "ignored\n");
    symlinkSync(linked, join(skill, "linked"), process.platform === "win32" ? "junction" : "dir");
    const logs = [];
    registerSkills({
      sourceRoot: skills, cwd: context.repo, agents: ["codex"], commit: true,
      env: { ...baseEnv, HOME: context.home, USERPROFILE: context.home }, log: (line) => logs.push(line),
    });
    assert.match(logs.join("\n"), /still ignored .*\*\.md/u);
  } finally { context.cleanup(); }
});

test("revalidation keeps a target that becomes correct immediately before mutation", () => {
  const context = fixture();
  try {
    const target = join(context.repo, ".agents", "skills", "burnlist");
    const logs = [];
    let inode;
    const planned = registerSkills({
      sourceRoot: join(repoRoot, "skills"), cwd: context.repo,
      env: { ...baseEnv, HOME: context.home, USERPROFILE: context.home }, agents: ["codex"],
      log: (line) => logs.push(line),
      beforeTargetMutation: () => {
        symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
        inode = lstatSync(target).ino;
      },
    });
    assert.equal(planned[0].action, "keep");
    assert.equal(lstatSync(target).ino, inode);
    linkedTo(target);
    assert.match(logs.join("\n"), /kept .*burnlist/u);
  } finally { context.cleanup(); }
});

test("registration refuses foreign files and directories without overwriting them", () => {
  for (const foreign of ["file", "directory"]) {
    const context = fixture();
    try {
      const target = join(context.repo, ".claude", "skills", "burnlist");
      mkdirSync(dirname(target), { recursive: true });
      if (foreign === "file") writeFileSync(target, "foreign\n");
      else mkdirSync(target);
      assert.throws(
        () => run(registerScript, context),
        (error) => String(error.stderr).includes("not a Burnlist-managed symlink"),
      );
      assert.equal(lstatSync(target).isDirectory(), foreign === "directory");
      assert.equal(lstatOrNull(join(context.repo, ".agents", "skills", "burnlist")), null);
    } finally { context.cleanup(); }
  }
});

test("registration refuses a symlink to a different skill source without replacing it", () => {
  const context = fixture();
  try {
    const target = join(context.repo, ".claude", "skills", "burnlist");
    const foreignSource = join(context.root, "foreign-burnlist");
    mkdirSync(dirname(target), { recursive: true });
    mkdirSync(foreignSource);
    writeFileSync(join(foreignSource, "SKILL.md"), "foreign\n");
    symlinkSync(foreignSource, target, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => run(registerScript, context),
      (error) => String(error.stderr).includes("already links to a different skill source"),
    );
    linkedTo(target, foreignSource);
    assert.equal(lstatOrNull(join(context.repo, ".agents", "skills", "burnlist")), null);
  } finally { context.cleanup(); }
});

test("repository root resolution fails closed for operational git errors", () => {
  const context = fixture();
  try {
    assert.throws(
      () => resolveRepoRoot(join(context.root, "missing-directory")),
      /could not resolve repository root/u,
    );
  } finally { context.cleanup(); }
});

test("unregister removes only exact managed symlinks and preserves foreign entries", () => {
  const context = fixture();
  try {
    run(registerScript, context);
    const claudeTarget = join(context.repo, ".claude", "skills", "burnlist");
    const codexTarget = join(context.repo, ".agents", "skills", "burnlist");
    const foreignTarget = join(context.repo, ".agents", "skills", "foreign");
    unlinkSync(codexTarget);
    mkdirSync(codexTarget);
    writeFileSync(join(codexTarget, "SKILL.md"), "foreign\n");
    symlinkSync(source, foreignTarget, process.platform === "win32" ? "junction" : "dir");
    run(unregisterScript, context);
    assert.equal(lstatOrNull(claudeTarget), null);
    assert.equal(lstatSync(codexTarget).isDirectory(), true);
    assert.equal(lstatSync(foreignTarget).isSymbolicLink(), true);
    assert.equal(lstatOrNull(dirname(claudeTarget)), null);
    assert.equal(lstatSync(dirname(codexTarget)).isDirectory(), true);
  } finally { context.cleanup(); }
});

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
