import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureStreamingDiff } from "./streaming-diff-feed-capture.mjs";
import { resolveStreamingDiffIdentity } from "./streaming-diff-feed.mjs";
import { registerActiveWindows, STREAMING_DIFF_ACTIVE_WINDOW_MAX_ENTRIES } from "./streaming-diff-snapshot-store.mjs";
import { readJournal } from "./streaming-diff-journal.mjs";

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-capture-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "target.txt"), "before\n");
  git(root, "add", "target.txt");
  git(root, "commit", "--quiet", "-m", "initial");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("pre/post capture appends a Wave 1-readable self-contained journal card", () => {
  const context = fixture();
  try {
    const pre = captureStreamingDiff({ cwd: context.root, session: "session-a", toolUseId: "tool-a", phase: "pre", hintedPaths: ["target.txt"] });
    assert.deepEqual(readJournal(pre.identity.feedDir).cards.map((card) => ({ toolUseId: card.toolUseId, status: card.status, files: card.files })), [{ toolUseId: "tool-a", status: "partial", files: [] }]);
    captureStreamingDiff({ cwd: context.root, session: "session-a", toolUseId: "tool-a", phase: "pre", hintedPaths: ["target.txt"] });
    assert.equal(readJournal(pre.identity.feedDir).cards.length, 1);
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const result = captureStreamingDiff({ cwd: context.root, session: "session-a", toolUseId: "tool-a", phase: "post", hintedPaths: ["target.txt"] });
    const journal = readJournal(result.identity.feedDir);
    assert.equal(result.card.status, "captured");
    assert.equal(journal.manifest.identity.session, "session-a");
    assert.equal(journal.cards.length, 2);
    assert.equal(journal.cards[1].toolUseId, "tool-a");
    assert.match(journal.cards[1].files[0].diff, /-before\n\+after/u);
  } finally { context.cleanup(); }
});

test("overlapping sessions on one worktree are unattributed, while isolated worktrees are captured", () => {
  const context = fixture();
  const otherWorktree = mkdtempSync(join(tmpdir(), "burnlist-streaming-worktree-"));
  rmSync(otherWorktree, { recursive: true, force: true });
  try {
    captureStreamingDiff({ cwd: context.root, session: "session-one", toolUseId: "tool-one", phase: "pre", hintedPaths: ["target.txt"] });
    captureStreamingDiff({ cwd: context.root, session: "session-two", toolUseId: "tool-two", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const first = captureStreamingDiff({ cwd: context.root, session: "session-one", toolUseId: "tool-one", phase: "post", hintedPaths: ["target.txt"] });
    const second = captureStreamingDiff({ cwd: context.root, session: "session-two", toolUseId: "tool-two", phase: "post", hintedPaths: ["target.txt"] });
    for (const result of [first, second]) {
      assert.equal(result.card.status, "partial");
      assert.match(result.card.partialReason, /overlapping concurrent edit \(unattributed\)/u);
      assert.deepEqual(result.card.files, [{ path: "target.txt", kind: "unavailable", meta: { reason: "overlapping concurrent edit (unattributed)" } }]);
    }

    git(context.root, "worktree", "add", "--detach", otherWorktree, "HEAD");
    captureStreamingDiff({ cwd: context.root, session: "session-root", toolUseId: "tool-root", phase: "pre", hintedPaths: ["target.txt"] });
    captureStreamingDiff({ cwd: otherWorktree, session: "session-other", toolUseId: "tool-other", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "root-after\n");
    writeFileSync(join(otherWorktree, "target.txt"), "other-after\n");
    const rootResult = captureStreamingDiff({ cwd: context.root, session: "session-root", toolUseId: "tool-root", phase: "post", hintedPaths: ["target.txt"] });
    const otherResult = captureStreamingDiff({ cwd: otherWorktree, session: "session-other", toolUseId: "tool-other", phase: "post", hintedPaths: ["target.txt"] });
    assert.equal(rootResult.card.status, "captured");
    assert.equal(otherResult.card.status, "captured");
  } finally {
    try { git(context.root, "worktree", "remove", "--force", otherWorktree); } catch {}
    rmSync(otherWorktree, { recursive: true, force: true });
    context.cleanup();
  }
});

test("a failed overlapping post stays unattributed when its publication is retried", () => {
  const context = fixture();
  try {
    captureStreamingDiff({ cwd: context.root, session: "retry-one", toolUseId: "retry-tool-one", phase: "pre", hintedPaths: ["target.txt"] });
    captureStreamingDiff({ cwd: context.root, session: "retry-two", toolUseId: "retry-tool-two", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const failed = captureStreamingDiff({
      cwd: context.root, session: "retry-one", toolUseId: "retry-tool-one", phase: "post", hintedPaths: ["target.txt"],
      append: () => { throw new Error("simulated append failure"); },
    });
    const retried = captureStreamingDiff({ cwd: context.root, session: "retry-one", toolUseId: "retry-tool-one", phase: "post", hintedPaths: ["target.txt"] });

    assert.match(failed.error.message, /simulated append failure/u);
    for (const card of [failed.card, retried.card]) {
      assert.equal(card.status, "partial");
      assert.match(card.partialReason, /overlapping concurrent edit \(unattributed\)/u);
      assert.deepEqual(card.files, [{ path: "target.txt", kind: "unavailable", meta: { reason: "overlapping concurrent edit (unattributed)" } }]);
    }
  } finally { context.cleanup(); }
});

test("a failed overlapping post remains unattributed after its live windows expire", () => {
  const context = fixture();
  try {
    const pre = captureStreamingDiff({ cwd: context.root, session: "expired-one", toolUseId: "expired-tool-one", phase: "pre", hintedPaths: ["target.txt"] });
    captureStreamingDiff({ cwd: context.root, session: "expired-two", toolUseId: "expired-tool-two", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const failed = captureStreamingDiff({
      cwd: context.root, session: "expired-one", toolUseId: "expired-tool-one", phase: "post", hintedPaths: ["target.txt"],
      append: () => { throw new Error("simulated append failure"); },
    });
    assert.match(failed.error.message, /simulated append failure/u);
    assert.equal(JSON.parse(readFileSync(pre.snapshot.path, "utf8")).overlapped, true);
    rmSync(join(context.root, ".local", "burnlist", "streaming-diff-active-windows.json"));

    const retried = captureStreamingDiff({ cwd: context.root, session: "expired-one", toolUseId: "expired-tool-one", phase: "post", hintedPaths: ["target.txt"] });

    assert.equal(retried.card.status, "partial");
    assert.match(retried.card.partialReason, /overlapping concurrent edit \(unattributed\)/u);
    assert.deepEqual(retried.card.files, [{ path: "target.txt", kind: "unavailable", meta: { reason: "overlapping concurrent edit (unattributed)" } }]);
  } finally { context.cleanup(); }
});

test("the later peer remains unattributed after its active window expires", () => {
  const context = fixture();
  try {
    captureStreamingDiff({ cwd: context.root, session: "first-peer", toolUseId: "first-tool", phase: "pre", hintedPaths: ["target.txt"] });
    captureStreamingDiff({ cwd: context.root, session: "second-peer", toolUseId: "second-tool", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    captureStreamingDiff({ cwd: context.root, session: "first-peer", toolUseId: "first-tool", phase: "post", hintedPaths: ["target.txt"] });
    rmSync(join(context.root, ".local", "burnlist", "streaming-diff-active-windows.json"));
    const second = captureStreamingDiff({ cwd: context.root, session: "second-peer", toolUseId: "second-tool", phase: "post", hintedPaths: ["target.txt"] });
    assert.equal(second.card.status, "partial");
    assert.match(second.card.partialReason, /overlapping concurrent edit \(unattributed\)/u);
  } finally { context.cleanup(); }
});

test("overlapping calls in one session are unattributed by tool-use id", () => {
  const context = fixture();
  try {
    captureStreamingDiff({ cwd: context.root, session: "shared-session", toolUseId: "first-call", phase: "pre", hintedPaths: ["target.txt"] });
    captureStreamingDiff({ cwd: context.root, session: "shared-session", toolUseId: "second-call", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const first = captureStreamingDiff({ cwd: context.root, session: "shared-session", toolUseId: "first-call", phase: "post", hintedPaths: ["target.txt"] });
    const second = captureStreamingDiff({ cwd: context.root, session: "shared-session", toolUseId: "second-call", phase: "post", hintedPaths: ["target.txt"] });

    for (const result of [first, second]) {
      assert.equal(result.card.status, "partial");
      assert.match(result.card.partialReason, /overlapping concurrent edit \(unattributed\)/u);
      assert.deepEqual(result.card.files, [{ path: "target.txt", kind: "unavailable", meta: { reason: "overlapping concurrent edit (unattributed)" } }]);
    }
  } finally { context.cleanup(); }
});

test("an active-window registry overflow makes the current capture unattributed", () => {
  const context = fixture();
  try {
    const openedAt = Date.now();
    for (let index = 0; index < STREAMING_DIFF_ACTIVE_WINDOW_MAX_ENTRIES; index += 1) {
      registerActiveWindows({
        identity: resolveStreamingDiffIdentity({ cwd: context.root, session: `live-${index}` }),
        toolUseId: `live-tool-${index}`,
        hintedPaths: [`live-${index}.txt`],
        openedAt,
      });
    }
    const target = join(context.root, "target.txt");
    writeFileSync(target, "before\n");
    captureStreamingDiff({ cwd: context.root, session: "overflow", toolUseId: "overflow-tool", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(target, "after\n");
    const result = captureStreamingDiff({ cwd: context.root, session: "overflow", toolUseId: "overflow-tool", phase: "post", hintedPaths: ["target.txt"] });

    assert.equal(result.card.status, "partial");
    assert.match(result.card.partialReason, /attribution unavailable: too many concurrent windows/u);
    assert.deepEqual(result.card.files, [{ path: "target.txt", kind: "unavailable", meta: { reason: "attribution unavailable: too many concurrent windows" } }]);
  } finally { context.cleanup(); }
});

test("an active-window lock timeout degrades a pre/post capture without throwing", () => {
  const context = fixture();
  try {
    const locked = () => {
      const error = new Error("busy");
      error.code = "ELOCKED";
      throw error;
    };
    const pre = captureStreamingDiff({
      cwd: context.root, session: "locked", toolUseId: "locked-tool", phase: "pre", hintedPaths: ["target.txt"],
      activeWindows: { registerActiveWindows: locked },
    });
    assert.equal(pre.activeWindow.attributionUnavailable, true);
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const post = captureStreamingDiff({ cwd: context.root, session: "locked", toolUseId: "locked-tool", phase: "post", hintedPaths: ["target.txt"] });
    assert.equal(post.card.status, "partial");
    assert.match(post.card.partialReason, /active-window lock timed out/u);
  } finally { context.cleanup(); }
});

test("a corrupt active-window registry makes the terminal capture partial", () => {
  const context = fixture();
  try {
    captureStreamingDiff({ cwd: context.root, session: "corrupt", toolUseId: "corrupt-tool", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, ".local", "burnlist", "streaming-diff-active-windows.json"), "{ broken");
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const result = captureStreamingDiff({ cwd: context.root, session: "corrupt", toolUseId: "corrupt-tool", phase: "post", hintedPaths: ["target.txt"] });
    assert.equal(result.card.status, "partial");
    assert.match(result.card.partialReason, /active-window registry unreadable/u);
  } finally { context.cleanup(); }
});

test("a failed post publication preserves its pre-snapshot for a retry", () => {
  const context = fixture();
  try {
    const pre = captureStreamingDiff({ cwd: context.root, session: "session-c", toolUseId: "tool-c", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const result = captureStreamingDiff({
      cwd: context.root,
      session: "session-c",
      toolUseId: "tool-c",
      phase: "post",
      hintedPaths: ["target.txt"],
      append: () => { throw new Error("simulated append failure"); },
    });
    assert.match(result.error.message, /simulated append failure/u);
    assert.equal(existsSync(pre.snapshot.path), true);
  } finally { context.cleanup(); }
});

test("concurrent posts retry the journal lock and publish both terminal cards", async () => {
  const context = fixture();
  const session = "session-race";
  const ready = join(context.root, "ready");
  const go = join(context.root, "go");
  const captureUrl = new URL("./streaming-diff-feed-capture.mjs", import.meta.url).href;
  const post = (toolUseId) => new Promise((resolvePost, reject) => {
    const source = `import { existsSync, writeFileSync } from "node:fs"; import { captureStreamingDiff } from ${JSON.stringify(captureUrl)}; const [ready, go, session, toolUseId] = process.argv.slice(1); writeFileSync(ready + "-" + process.pid, ""); while (!existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); const result = captureStreamingDiff({ session, toolUseId, phase: "post", hintedPaths: ["target.txt"] }); if (result.error) throw result.error;`;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source, ready, go, session, toolUseId], { cwd: context.root, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (status) => status === 0 ? resolvePost() : reject(new Error(`post exited ${status}`)));
  });
  try {
    const first = captureStreamingDiff({ cwd: context.root, session, toolUseId: "tool-one", phase: "pre", hintedPaths: ["target.txt"] });
    captureStreamingDiff({ cwd: context.root, session, toolUseId: "tool-two", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    writeFileSync(join(first.identity.feedDir, ".lock"), JSON.stringify({ pid: process.pid, token: "test-lock" }));
    const one = post("tool-one");
    const two = post("tool-two");
    for (let attempt = 0; attempt < 100 && readdirSync(context.root).filter((name) => name.startsWith("ready-")).length < 2; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    assert.equal(readdirSync(context.root).filter((name) => name.startsWith("ready-")).length, 2);
    writeFileSync(go, "go");
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    rmSync(join(first.identity.feedDir, ".lock"), { force: true });
    await Promise.all([one, two]);
    const terminal = readJournal(first.identity.feedDir).cards.filter((card) => card.status !== "partial" || card.files.length > 0);
    assert.deepEqual(terminal.map((card) => card.toolUseId).sort(), ["tool-one", "tool-two"]);
  } finally { context.cleanup(); }
});

test("missing pre-state is an honest partial card rather than a fabricated baseline", () => {
  const context = fixture();
  try {
    const result = captureStreamingDiff({ cwd: context.root, session: "session-b", toolUseId: "tool-b", phase: "post", hintedPaths: ["target.txt"] });
    assert.equal(result.card.status, "partial");
    assert.match(result.card.partialReason, /snapshot unavailable/u);
    assert.equal(result.card.files[0].kind, "unavailable");
  } finally { context.cleanup(); }
});

test("a degraded pre-hook reason survives to force its terminal card partial", () => {
  const context = fixture();
  try {
    captureStreamingDiff({
      cwd: context.root, session: "session-degraded", toolUseId: "tool-degraded", phase: "pre",
      hintedPaths: ["target.txt"], terminalReason: "path-hints-truncated",
    });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const result = captureStreamingDiff({
      cwd: context.root, session: "session-degraded", toolUseId: "tool-degraded", phase: "post", hintedPaths: ["target.txt"],
    });
    assert.equal(result.card.status, "partial");
    assert.match(result.card.partialReason, /path hints truncated/u);
  } finally { context.cleanup(); }
});

test("a denied-only snapshot stays visible and adapter text never reaches feed bytes", () => {
  const context = fixture();
  try {
    const secret = "token=not-for-the-feed";
    captureStreamingDiff({ cwd: context.root, session: "session-denied", toolUseId: "tool-denied", phase: "pre", hintedPaths: [".env"], terminalReason: secret });
    writeFileSync(join(context.root, ".env"), "after\n");
    const result = captureStreamingDiff({ cwd: context.root, session: "session-denied", toolUseId: "tool-denied", phase: "post", hintedPaths: [".env"], terminalReason: secret });
    const bytes = readFileSync(join(result.identity.feedDir, `rev-${result.card.revId}.json`), "utf8");
    assert.equal(result.card.status, "partial");
    assert.deepEqual(result.card.files, [{ path: ".env", kind: "denied" }]);
    assert.equal(bytes.includes(secret), false);
    assert.equal(result.card.partialReason.includes(secret), false);
  } finally { context.cleanup(); }
});
