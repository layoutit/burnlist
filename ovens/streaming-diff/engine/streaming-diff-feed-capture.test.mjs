import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureStreamingDiff } from "./streaming-diff-feed-capture.mjs";
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
    assert.equal(journal.manifest.identity.session, "session-a");
    assert.equal(journal.cards.length, 2);
    assert.equal(journal.cards[1].toolUseId, "tool-a");
    assert.match(journal.cards[1].files[0].diff, /-before\n\+after/u);
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
      hintedPaths: ["target.txt"], terminalReason: "path hints truncated",
    });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const result = captureStreamingDiff({
      cwd: context.root, session: "session-degraded", toolUseId: "tool-degraded", phase: "post", hintedPaths: ["target.txt"],
    });
    assert.equal(result.card.status, "partial");
    assert.match(result.card.partialReason, /path hints truncated/u);
  } finally { context.cleanup(); }
});
