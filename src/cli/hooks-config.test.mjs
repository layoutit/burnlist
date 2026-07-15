import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HOOK_MARKER, hookCapability, hookConfigStatus, managedHookEntry, updateHookConfigs } from "./hooks-config.mjs";

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

test("Codex install contains only its supported hook events", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".codex", "hooks.json");
    updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: true });
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, "utf8")).hooks).sort(), ["PostToolUse", "PreToolUse", "SessionStart"]);
  } finally { context.cleanup(); }
});

test("Claude install includes its failure hook while Codex does not", () => {
  const context = fixture();
  try {
    updateHookConfigs({ repoRoot: context.root, agents: ["codex", "claude"], install: true });
    const codex = JSON.parse(readFileSync(join(context.root, ".codex", "hooks.json"), "utf8"));
    const claude = JSON.parse(readFileSync(join(context.root, ".claude", "settings.json"), "utf8"));
    assert.equal(Object.hasOwn(codex.hooks, "PostToolUseFailure"), false);
    assert.equal(Object.hasOwn(claude.hooks, "PostToolUseFailure"), true);
  } finally { context.cleanup(); }
});

test("Codex reinstall removes stale owned unsupported events while preserving user hooks", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".codex", "hooks.json");
    mkdirSync(join(context.root, ".codex"));
    const userHook = { matcher: "user-tool", hooks: [{ type: "command", command: "user-hook" }] };
    writeFileSync(path, JSON.stringify({ hooks: { PostToolUseFailure: [managedHookEntry("codex", "failure"), userHook] } }));
    updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: true });
    const reinstalled = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(reinstalled.hooks.PostToolUseFailure, [userHook]);
    assert.deepEqual(Object.keys(reinstalled.hooks).sort(), ["PostToolUse", "PostToolUseFailure", "PreToolUse", "SessionStart"]);
    for (const event of ["SessionStart", "PreToolUse", "PostToolUse"]) {
      assert.equal(reinstalled.hooks[event].some((entry) => entry.hooks[0].command.includes("--agent codex")), true);
    }
  } finally { context.cleanup(); }
});

test("uninstall removes only exact owned hooks and its paired exclude line, then removes an empty created config", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".codex", "hooks.json");
    updateHookConfigs({ repoRoot: context.root, agents: ["codex"], install: true });
    const excludePath = join(context.root, ".git", "info", "exclude");
    const collision = "burnlist streaming-diff hook --agent codex --event post --user-option";
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.hooks.PostToolUse.unshift({ matcher: "apply_patch|write_file|edit_file|create_file|delete_file|rename_file|move_file", hooks: [{ type: "command", command: collision }] });
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

test("install from a subdirectory writes and excludes the worktree-root config", () => {
  const context = fixture();
  try {
    const subdirectory = join(context.root, "nested", "work");
    mkdirSync(subdirectory, { recursive: true });
    const [result] = updateHookConfigs({ repoRoot: subdirectory, agents: ["codex"], install: true });
    assert.equal(result.path.endsWith("/.codex/hooks.json"), true);
    assert.equal(result.excluded, true);
    assert.equal(existsSync(join(subdirectory, ".codex", "hooks.json")), false);
    assert.match(readFileSync(join(context.root, ".git", "info", "exclude"), "utf8"), /\.codex\/hooks\.json/u);
  } finally { context.cleanup(); }
});

test("--untracked forces a tracked config into the local exclusion list", () => {
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
    assert.equal(result.excluded, true);
    assert.match(readFileSync(join(context.root, ".git", "info", "exclude"), "utf8"), /\.codex\/hooks\.json/u);
  } finally { context.cleanup(); }
});

test("malformed hook JSON is never overwritten", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".claude", "settings.json");
    mkdirSync(join(context.root, ".claude"));
    writeFileSync(path, "{ broken");
    assert.throws(() => updateHookConfigs({ repoRoot: context.root, agents: ["claude"], install: true }), /malformed/u);
    assert.equal(readFileSync(path, "utf8"), "{ broken");
  } finally { context.cleanup(); }
});

test("status reports structurally corrupt hook config without throwing", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".codex", "hooks.json");
    mkdirSync(join(context.root, ".codex"));
    writeFileSync(path, JSON.stringify({ hooks: { PostToolUse: "not an array" } }));
    const [status] = hookConfigStatus({ repoRoot: context.root, agents: ["codex"] });
    assert.equal(status.state, "corrupt");
    assert.equal(status.installed, false);
  } finally { context.cleanup(); }
});

test("status distinguishes an old Codex from an absent Claude CLI", () => {
  const context = fixture();
  try {
    const capability = (agent) => hookCapability(agent, {
      spawn: (binary) => binary === "codex"
        ? { status: 0, stdout: "codex-cli 0.39.0\n", stderr: "" }
        : { error: { code: "ENOENT" }, status: null, stdout: "", stderr: "" },
    });
    const status = hookConfigStatus({ repoRoot: context.root, agents: ["codex", "claude"], capability });
    assert.deepEqual(status.map(({ agent, capability: result }) => [agent, result.state, result.minimumVersion]), [
      ["codex", "installed-but-hooks-unsupported", "0.114.0"],
      ["claude", "not-installed", undefined],
    ]);
  } finally { context.cleanup(); }
});

test("multi-agent install preflights every config before writing either one", () => {
  const context = fixture();
  try {
    const claudePath = join(context.root, ".claude", "settings.json");
    mkdirSync(join(context.root, ".claude"));
    writeFileSync(claudePath, "{ malformed");
    assert.throws(() => updateHookConfigs({ repoRoot: context.root, agents: ["codex", "claude"], install: true }), /malformed hook config.*settings\.json/u);
    assert.equal(existsSync(join(context.root, ".codex", "hooks.json")), false);
    assert.equal(readFileSync(claudePath, "utf8"), "{ malformed");
    assert.equal(existsSync(join(context.root, ".local", "burnlist", "hooks-config-provenance.json")), false);
  } finally { context.cleanup(); }
});

test("a second config write failure restores the first config and leaves provenance unsaved", () => {
  const context = fixture();
  try {
    const codexPath = join(context.root, ".codex", "hooks.json");
    const claudePath = join(context.root, ".claude", "settings.json");
    mkdirSync(join(context.root, ".codex"));
    mkdirSync(join(context.root, ".claude"));
    writeFileSync(codexPath, '{"codexBefore":true}\n');
    writeFileSync(claudePath, '{"claudeBefore":true}\n');
    let writes = 0;
    assert.throws(() => updateHookConfigs({
      repoRoot: context.root,
      agents: ["codex", "claude"],
      install: true,
      writeJson(path, value) {
        writes += 1;
        if (writes === 2) throw new Error("simulated second config write failure");
        writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
      },
    }), /simulated second config write failure/u);
    assert.equal(readFileSync(codexPath, "utf8"), '{"codexBefore":true}\n');
    assert.equal(readFileSync(claudePath, "utf8"), '{"claudeBefore":true}\n');
    assert.equal(existsSync(join(context.root, ".local", "burnlist", "hooks-config-provenance.json")), false);
  } finally { context.cleanup(); }
});

test("a rollback restore failure identifies the config that may need manual cleanup", () => {
  const context = fixture();
  try {
    const codexPath = join(context.root, ".codex", "hooks.json");
    const claudePath = join(context.root, ".claude", "settings.json");
    mkdirSync(join(context.root, ".codex"));
    mkdirSync(join(context.root, ".claude"));
    writeFileSync(codexPath, '{"codexBefore":true}\n');
    writeFileSync(claudePath, '{"claudeBefore":true}\n');
    let writes = 0;
    assert.throws(() => updateHookConfigs({
      repoRoot: context.root,
      agents: ["codex", "claude"],
      install: true,
      writeJson(path, value) {
        writes += 1;
        if (writes === 2) throw new Error("simulated second config write failure");
        writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
      },
      restoreFile(change) {
        if (change.path.endsWith("/.codex/hooks.json")) throw new Error("simulated rollback restore failure");
        writeFileSync(change.path, change.before);
      },
    }), /rollback failed for .*\.codex\/hooks\.json.*partial state.*manual cleanup/u);
    assert.equal(existsSync(join(context.root, ".local", "burnlist", "hooks-config-provenance.json")), false);
  } finally { context.cleanup(); }
});
