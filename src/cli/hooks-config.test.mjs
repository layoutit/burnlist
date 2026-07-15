import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HOOK_MARKER, hookConfigStatus, updateHookConfigs } from "./hooks-config.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-hooks-"));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("hook install merges existing hooks, is idempotent, and uninstall is ownership-scoped", () => {
  const context = fixture();
  try {
    const configPath = join(context.root, ".claude", "settings.json");
    mkdirSync(join(context.root, ".claude"));
    writeFileSync(configPath, JSON.stringify({ keep: true, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user-hook" }] }] } }));
    updateHookConfigs({ repoRoot: context.root, agents: ["claude"], install: true });
    const installed = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(installed.keep, true);
    assert.equal(installed.hooks.PreToolUse[0].hooks[0].command, "user-hook");
    assert.equal(installed.hooks.PreToolUse.at(-1).matcher, "Edit|Write|MultiEdit|NotebookEdit");
    assert.equal(JSON.stringify(installed).includes(HOOK_MARKER), false);
    updateHookConfigs({ repoRoot: context.root, agents: ["claude"], install: true });
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).hooks.PreToolUse.filter((entry) => entry.hooks[0].command === "burnlist streaming-diff hook --agent claude --event pre").length, 1);
    updateHookConfigs({ repoRoot: context.root, agents: ["claude"], install: false });
    const removed = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(removed.keep, true);
    assert.deepEqual(removed.hooks.PreToolUse, [{ matcher: "Bash", hooks: [{ type: "command", command: "user-hook" }] }]);
    assert.doesNotMatch(JSON.stringify(removed), /streaming-diff hook/u);
  } finally { context.cleanup(); }
});

test("hook install reports the current local exclusion on idempotent install", () => {
  const context = fixture();
  try {
    const [result] = updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: true });
    assert.equal(result.mode, "untracked");
    assert.equal(result.excluded, true);
    const exclude = readFileSync(join(context.root, ".git", "info", "exclude"), "utf8");
    assert.match(exclude, /\.codex\/hooks\.json/u);
    assert.equal(hookConfigStatus({ repoRoot: context.root, agents: ["codex"] })[0].installed, true);
    assert.equal(updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: true })[0].excluded, true);
  } finally { context.cleanup(); }
});

test("uninstall removes only exact owned hooks and its paired exclude line, then removes an empty created config", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".codex", "hooks.json");
    updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: true });
    const excludePath = join(context.root, ".git", "info", "exclude");
    const collision = "echo burnlist-managed:streaming-diff-hooks@1 burnlist streaming-diff hook --agent codex --event post";
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.hooks.PostToolUse.unshift({ matcher: "user", hooks: [{ type: "command", command: collision }] });
    writeFileSync(path, JSON.stringify(config));
    updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: false });
    const removed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(removed.hooks.PostToolUse[0].hooks[0].command, collision);
    assert.doesNotMatch(readFileSync(excludePath, "utf8"), /\.codex\/hooks\.json/u);
    // A config containing exactly Burnlist's entries is the local config it created.
    updateHookConfigs({ repoRoot: context.root, agents: ["claude"], install: true });
    const created = join(context.root, ".claude", "settings.json");
    updateHookConfigs({ repoRoot: context.root, agents: ["claude"], install: false });
    assert.equal(existsSync(created), false);
  } finally { context.cleanup(); }
});

test("uninstall preserves an empty config that existed before Burnlist installed hooks", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".codex", "hooks.json");
    mkdirSync(join(context.root, ".codex"));
    writeFileSync(path, "{}\n");
    updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: true });
    updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: false });
    assert.equal(existsSync(path), true);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {});
  } finally { context.cleanup(); }
});

test("status is partial when one expected event is absent", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".claude", "settings.json");
    updateHookConfigs({ repoRoot: context.root, agents: ["claude"], install: true });
    const config = JSON.parse(readFileSync(path, "utf8"));
    delete config.hooks.PostToolUseFailure;
    writeFileSync(path, JSON.stringify(config));
    const status = hookConfigStatus({ repoRoot: context.root, agents: ["claude"] })[0];
    assert.equal(status.installed, false);
    assert.equal(status.state, "partial");
  } finally { context.cleanup(); }
});

test("a fatal Git preflight fails before a config write", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-hooks-not-git-"));
  try {
    assert.throws(() => updateHookConfigs({ repoRoot: root, agents: ["codex"], install: true }), /Git|git/u);
    assert.equal(existsSync(join(root, ".codex", "hooks.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("tracked config stays honestly tracked even when --untracked is requested", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".codex", "hooks.json");
    mkdirSync(join(context.root, ".codex"));
    writeFileSync(path, "{}\n");
    execFileSync("git", ["-C", context.root, "add", ".codex/hooks.json"]);
    execFileSync("git", ["-C", context.root, "commit", "--quiet", "-m", "tracked config"]);
    const [result] = updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: true, untracked: true });
    assert.equal(result.mode, "tracked");
    assert.equal(result.forcedUntracked, true);
    assert.equal(existsSync(join(context.root, ".git", "info", "exclude")) && readFileSync(join(context.root, ".git", "info", "exclude"), "utf8").includes(".codex/hooks.json"), false);
  } finally { context.cleanup(); }
});

test("malformed hook JSON is backed up and never overwritten", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".claude", "settings.json");
    mkdirSync(join(context.root, ".claude"));
    writeFileSync(path, "{ broken");
    assert.throws(() => updateHookConfigs({ repoRoot: context.root, agents: ["claude"], install: true }), /malformed/u);
    assert.equal(readFileSync(path, "utf8"), "{ broken");
    assert.ok(readdirSync(join(context.root, ".claude")).some((name) => name.includes(".burnlist-malformed-") && name.endsWith(".bak")));
  } finally { context.cleanup(); }
});
