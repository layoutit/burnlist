import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { mapStreamingDiffHook } from "./streaming-diff-hook-adapters.mjs";
import { managedHookEntry } from "../../../src/cli/hooks-config.mjs";

function worktree() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-hook-adapter-"));
  execFileSync("git", ["init", "--quiet", root]);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("real Claude absolute Write and Edit payloads become contained repo-relative capture hints", () => {
  const context = worktree();
  try {
    const payload = {
      session_id: "claude-session", tool_name: "Write", tool_use_id: "tool-1",
      tool_input: { file_path: `${context.root}/src/new-file.mjs`, content: "export const value = 1;" },
    };
    assert.deepEqual(mapStreamingDiffHook({ agent: "claude", event: "pre", payload, cwd: context.root }), {
      action: "capture", args: ["capture", "--session", "claude-session", "--tool-use-id", "tool-1", "--phase", "pre", "--path", "src/new-file.mjs"], degraded: false,
    });
    const edit = { ...payload, tool_name: "Edit", tool_input: { file_path: `${context.root}/src/new-file.mjs`, old_string: "1", new_string: "2" } };
    assert.equal(mapStreamingDiffHook({ agent: "claude", event: "failure", payload: edit, cwd: context.root }).args.at(-1), "src/new-file.mjs");
    const escaped = { ...payload, tool_input: { file_path: "/tmp/outside.mjs" } };
    assert.equal(mapStreamingDiffHook({ agent: "claude", event: "post", payload: escaped, cwd: context.root }).degraded, true);
  } finally { context.cleanup(); }
});

test("Claude worktree lookup has a finite subprocess timeout", { timeout: 3_000 }, () => {
  const context = worktree();
  const originalPath = process.env.PATH;
  try {
    const bin = join(context.root, "slow-bin");
    mkdirSync(bin);
    const git = join(bin, "git");
    writeFileSync(git, "#!/bin/sh\nsleep 2\n");
    chmodSync(git, 0o755);
    process.env.PATH = `${bin}${delimiter}${originalPath}`;
    const started = Date.now();
    const mapped = mapStreamingDiffHook({
      agent: "claude", event: "pre", cwd: context.root,
      payload: { session_id: "claude-session", tool_name: "Write", tool_use_id: "call-timeout", tool_input: { file_path: join(context.root, "new-file.mjs") } },
    });
    assert.equal(mapped.action, "capture");
    assert.equal(mapped.degraded, true);
    assert.match(mapped.degradedReason, /missing path hints/u);
    assert.ok(Date.now() - started < 1_200);
  } finally {
    process.env.PATH = originalPath;
    context.cleanup();
  }
});

test("real Codex apply_patch command envelope maps every changed path exactly", () => {
  const payload = {
    hook_event_name: "PreToolUse", session_id: "codex-session", tool_name: "apply_patch", tool_use_id: "call-1",
    tool_input: { command: "*** Begin Patch\n*** Update File: lib/a.mjs\n@@\n*** Add File: lib/b.mjs\n+export {};\n*** Delete File: lib/c.mjs\n*** Update File: lib/old.mjs\n*** Move to: lib/new.mjs\n*** End Patch" },
  };
  assert.deepEqual(mapStreamingDiffHook({ agent: "codex", payload }), {
    action: "capture", args: ["capture", "--session", "codex-session", "--tool-use-id", "call-1", "--phase", "pre", "--path", "lib/a.mjs", "--path", "lib/b.mjs", "--path", "lib/c.mjs", "--path", "lib/old.mjs", "--path", "lib/new.mjs"], degraded: false,
  });
});

test("hook adapters cap capture arguments before spawning a capture subprocess", () => {
  const paths = Array.from({ length: 70 }, (_, index) => `lib/${index}.mjs`);
  const payload = {
    session_id: "codex-session", tool_name: "apply_patch", tool_use_id: "call-many",
    tool_input: { command: `*** Begin Patch\n${paths.map((path) => `*** Add File: ${path}`).join("\n")}\n*** Add File: ${"x".repeat(513)}\n*** End Patch` },
  };
  const codex = mapStreamingDiffHook({ agent: "codex", event: "pre", payload });
  const codexPaths = codex.args.filter((value, index) => codex.args[index - 1] === "--path");
  assert.equal(codexPaths.length, 64);
  assert.ok(codexPaths.every((path) => path.length <= 512 && Buffer.byteLength(path, "utf8") <= 512));
  assert.equal(codex.degraded, true);

  const context = worktree();
  try {
    const claude = mapStreamingDiffHook({
      agent: "claude", event: "pre", cwd: context.root,
      payload: { session_id: "claude-session", tool_name: "Write", tool_use_id: "call-long", tool_input: { file_path: join(context.root, ...Array.from({ length: 10 }, () => "x".repeat(60))) } },
    });
    assert.equal(claude.args.includes("--path"), false);
    assert.equal(claude.degraded, true);
  } finally { context.cleanup(); }
});

test("Codex file-tool payload fields remain bounded path hints", () => {
  const payload = { session_id: "codex-session", tool_name: "write_file", tool_use_id: "call-2", tool_input: { file_path: "lib/generated.mjs", content: "export {};" } };
  assert.deepEqual(mapStreamingDiffHook({ agent: "codex", event: "post", payload }).args, [
    "capture", "--session", "codex-session", "--tool-use-id", "call-2", "--phase", "post", "--path", "lib/generated.mjs",
  ]);
});

test("managed hooks use portable commands and narrow host matchers", () => {
  assert.deepEqual(managedHookEntry("claude", "post"), {
    matcher: "Edit|Write|MultiEdit|NotebookEdit",
    hooks: [{ type: "command", command: "burnlist streaming-diff hook --agent claude --event post" }],
  });
  assert.doesNotMatch(managedHookEntry("codex", "post", "win32").hooks[0].command, /cmd|REM|#/iu);
});

test("non-mutating, malformed, and missing-identity payloads are safe no-ops or bounded partial captures", () => {
  assert.equal(mapStreamingDiffHook({ agent: "claude", event: "pre", payload: { tool_name: "Bash" } }).action, "noop");
  assert.doesNotThrow(() => mapStreamingDiffHook({ agent: "claude", event: "post", payload: null }));
  const mapped = mapStreamingDiffHook({ agent: "codex", event: "post", payload: { tool_name: "write_file", tool_input: {} } });
  assert.equal(mapped.action, "capture");
  assert.equal(mapped.degraded, true);
});
