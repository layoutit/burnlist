import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveStreamingDiffIdentity } from "../../ovens/streaming-diff/engine/streaming-diff-feed.mjs";
import { readJournal } from "../../ovens/streaming-diff/engine/streaming-diff-journal.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-cli-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "target.txt"), "before\n");
  writeFileSync(join(root, "other.txt"), "clean\n");
  git(root, "add", "target.txt", "other.txt");
  git(root, "commit", "--quiet", "-m", "initial");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, ...args) {
  return execFileSync(process.execPath, [binPath, "streaming-diff", ...args], { cwd: context.root, encoding: "utf8" });
}

function hookProcess(context, agent, event) {
  const child = spawn(process.execPath, [binPath, "streaming-diff", "hook", "--agent", agent, "--event", event], {
    cwd: context.root, stdio: ["pipe", "ignore", "ignore"],
  });
  child.stdin.on("error", () => {});
  return child;
}

function hook(context, agent, event, payload, env = process.env) {
  return execFileSync(process.execPath, [binPath, "streaming-diff", "hook", "--agent", agent, "--event", event], {
    cwd: context.root, env, input: JSON.stringify(payload), stdio: "pipe", timeout: 5_000,
  });
}

function exitsWithin(child, milliseconds) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`hook did not exit within ${milliseconds}ms`));
    }, milliseconds);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }); });
  });
}

test("CLI pre/post capture excludes pre-existing dirty-tree changes from a tool card", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.root, "other.txt"), "dirty before tool\n");
    assert.match(run(context, "ensure-feed", "--session", "agent-one"), /Binding: created/u);
    assert.match(run(context, "capture", "--session", "agent-one", "--tool-use-id", "tool-one", "--phase", "pre", "--path", "target.txt"), /Snapshot:/u);
    writeFileSync(join(context.root, "target.txt"), "after\n");
    assert.match(run(context, "capture", "--session", "agent-one", "--tool-use-id", "tool-one", "--phase", "post", "--path", "target.txt"), /Card: r-[a-f0-9]+ \(captured\)/u);
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "agent-one" });
    const card = readJournal(identity.feedDir).cards.find((entry) => entry.status === "captured");
    assert.deepEqual(card.files.map((file) => file.path), ["target.txt"]);
    assert.match(card.files[0].diff, /-before\n\+after/u);
    assert.doesNotMatch(card.files[0].diff, /dirty before tool/u);
  } finally { context.cleanup(); }
});

test("CLI url prints the URL-addressed logical/worktree/session route", () => {
  const context = fixture();
  try {
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "agent-one" });
    assert.equal(
      run(context, "url", "--session", "agent-one").trim(),
      `/ovens/streaming-diff/view?repoKey=${identity.logicalRepoKey}&worktreeKey=${identity.worktreeKey}&session=agent-one`,
    );
  } finally { context.cleanup(); }
});

test("CLI reports an invalid capture phase as a usage error", () => {
  const context = fixture();
  try {
    assert.throws(
      () => run(context, "capture", "--session", "agent-one", "--tool-use-id", "tool-one", "--phase", "later"),
      (error) => error.status === 2 && /phase must be pre or post/u.test(error.stderr),
    );
  } finally { context.cleanup(); }
});

test("hook entrypoint accepts malformed or non-mutating payloads without failing the host agent", () => {
  const context = fixture();
  try {
    assert.doesNotThrow(() => execFileSync(process.execPath, [binPath, "streaming-diff", "hook", "--agent", "claude", "--event", "pre"], {
      cwd: context.root, input: "not JSON", stdio: "pipe", timeout: 5_000,
    }));
    assert.doesNotThrow(() => execFileSync(process.execPath, [binPath, "streaming-diff", "hook", "--agent", "codex", "--event", "post"], {
      cwd: context.root, input: JSON.stringify({ tool_name: "shell" }), stdio: "pipe", timeout: 5_000,
    }));
  } finally { context.cleanup(); }
});

test("malformed hook flags still exit zero without using the regular flag parser", () => {
  const context = fixture();
  try {
    assert.doesNotThrow(() => execFileSync(process.execPath, [binPath, "streaming-diff", "hook", "--agent"], {
      cwd: context.root, stdio: "pipe", timeout: 5_000,
    }));
  } finally { context.cleanup(); }
});

test("hook stdin stops at its byte cap and timeout instead of waiting for EOF", { timeout: 4_000 }, async () => {
  const context = fixture();
  try {
    const oversized = hookProcess(context, "codex", "post");
    oversized.stdin.write("x".repeat(300 * 1024));
    assert.deepEqual(await exitsWithin(oversized, 1_500), { code: 0, signal: null });

    const slow = hookProcess(context, "codex", "post");
    slow.stdin.write("{");
    assert.deepEqual(await exitsWithin(slow, 1_500), { code: 0, signal: null });

    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "unknown-session" });
    const cards = readJournal(identity.feedDir).cards.filter((card) => card.toolUseId === "unknown-tool-use");
    assert.equal(cards.every((card) => card.status === "partial"), true);
    assert.equal(cards.some((card) => /byte limit/u.test(card.partialReason)), true);
    assert.equal(cards.some((card) => /timed out/u.test(card.partialReason)), true);
  } finally { context.cleanup(); }
});

test("a Codex payload with truncated path hints records a partial terminal card", () => {
  const context = fixture();
  try {
    const paths = Array.from({ length: 65 }, (_, index) => `file-${index}.txt`);
    const payload = {
      session_id: "codex-many", tool_name: "apply_patch", tool_use_id: "call-many",
      tool_input: { command: `*** Begin Patch\n${paths.map((path) => `*** Add File: ${path}`).join("\n")}\n*** End Patch` },
    };
    hook(context, "codex", "pre", payload);
    writeFileSync(join(context.root, "file-0.txt"), "after\n");
    hook(context, "codex", "post", payload);
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "codex-many" });
    const card = readJournal(identity.feedDir).cards.find((entry) => entry.toolUseId === "call-many" && entry.files.length > 0);
    assert.equal(card.status, "partial");
    assert.match(card.partialReason, /path hints truncated/u);
  } finally { context.cleanup(); }
});

test("missing hook fields record a partial terminal card instead of a captured fallback", () => {
  const context = fixture();
  try {
    hook(context, "codex", "post", { tool_name: "write_file", tool_input: {} });
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "unknown-session" });
    const card = readJournal(identity.feedDir).cards.find((entry) => entry.toolUseId === "unknown-tool-use");
    assert.equal(card.status, "partial");
    assert.match(card.partialReason, /missing session; missing tool use id; missing path hints/u);
  } finally { context.cleanup(); }
});

test("a Claude git-timeout mapping records a partial terminal card", { timeout: 5_000 }, () => {
  const context = fixture();
  const originalPath = process.env.PATH;
  try {
    const bin = join(context.root, "slow-bin");
    const count = join(context.root, "git-count");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ ! -f ${JSON.stringify(count)} ]; then touch ${JSON.stringify(count)}; sleep 1; fi\nexec \"$BURNLIST_REAL_GIT\" \"$@\"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const env = { ...process.env, PATH: `${bin}${delimiter}${originalPath}`, BURNLIST_REAL_GIT: realGit };
    const payload = { session_id: "claude-timeout", tool_name: "Write", tool_use_id: "call-timeout", tool_input: { file_path: join(context.root, "target.txt") } };
    hook(context, "claude", "post", payload, env);
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "claude-timeout" });
    const card = readJournal(identity.feedDir).cards.find((entry) => entry.toolUseId === "call-timeout");
    assert.equal(card.status, "partial");
    assert.match(card.partialReason, /missing path hints/u);
  } finally { context.cleanup(); }
});

test("a child capture timeout preserves the degraded pre-hook partial and exits zero", { timeout: 5_000 }, () => {
  const context = fixture();
  const originalPath = process.env.PATH;
  try {
    const paths = Array.from({ length: 65 }, (_, index) => `file-${index}.txt`);
    const payload = { session_id: "codex-timeout", tool_name: "apply_patch", tool_use_id: "call-timeout", tool_input: { command: `*** Begin Patch\n${paths.map((path) => `*** Add File: ${path}`).join("\n")}\n*** End Patch` } };
    hook(context, "codex", "pre", payload);
    const bin = join(context.root, "slow-bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), "#!/bin/sh\nsleep 3\n");
    chmodSync(join(bin, "git"), 0o755);
    const env = { ...process.env, PATH: `${bin}${delimiter}${originalPath}` };
    assert.doesNotThrow(() => hook(context, "codex", "post", payload, env));
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "codex-timeout" });
    const cards = readJournal(identity.feedDir).cards.filter((entry) => entry.toolUseId === "call-timeout");
    assert.equal(cards.every((card) => card.status === "partial"), true);
    assert.equal(cards.some((card) => /path hints truncated/u.test(card.partialReason)), true);
  } finally { process.env.PATH = originalPath; context.cleanup(); }
});

test("a real failure hook event writes a partial terminal card", () => {
  const context = fixture();
  try {
    const payload = { session_id: "claude-session", tool_name: "Edit", tool_use_id: "tool-1", tool_input: { file_path: join(context.root, "target.txt"), old_string: "before", new_string: "after" } };
    execFileSync(process.execPath, [binPath, "streaming-diff", "hook", "--agent", "claude", "--event", "pre"], { cwd: context.root, input: JSON.stringify(payload), stdio: "pipe", timeout: 5_000 });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    execFileSync(process.execPath, [binPath, "streaming-diff", "hook", "--agent", "claude", "--event", "failure"], { cwd: context.root, input: JSON.stringify(payload), stdio: "pipe", timeout: 5_000 });
    const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: "claude-session" });
    const card = readJournal(identity.feedDir).cards.find((entry) => entry.toolUseId === "tool-1" && entry.files.length > 0);
    assert.equal(card.status, "partial");
    assert.match(card.partialReason, /tool failed/u);
  } finally { context.cleanup(); }
});
