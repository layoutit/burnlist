import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureStreamingDiff } from "./streaming-diff-feed-capture.mjs";
import { resolveStreamingDiffIdentity } from "./streaming-diff-feed.mjs";
import { readJournal } from "./streaming-diff-journal.mjs";
import { closeActiveWindows, inspectActiveWindowOverlap, markPreSnapshotRegistered, registerActiveWindows, writePreSnapshot } from "./streaming-diff-snapshot-store.mjs";

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-racefix-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "target.txt"), "before\n");
  git(root, "add", "target.txt");
  git(root, "commit", "--quiet", "-m", "initial");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("future-skewed peer windows survive and make both closes unattributed", () => {
  const context = fixture();
  try {
    const first = resolveStreamingDiffIdentity({ cwd: context.root, session: "future-first" });
    const second = resolveStreamingDiffIdentity({ cwd: context.root, session: "future-second" });
    for (const [identity, toolUseId] of [[first, "first-tool"], [second, "second-tool"]]) {
      writePreSnapshot({ identity, toolUseId, hintedPaths: ["target.txt"] });
      markPreSnapshotRegistered({ identity, toolUseId });
    }
    registerActiveWindows({ identity: first, toolUseId: "first-tool", hintedPaths: ["target.txt"], openedAt: 2_000 });
    registerActiveWindows({ identity: second, toolUseId: "second-tool", hintedPaths: ["target.txt"], openedAt: 1_900 });

    const registry = JSON.parse(readFileSync(join(context.root, ".local", "burnlist", "streaming-diff-active-windows.json"), "utf8"));
    assert.deepEqual(registry.windows.map((window) => window.toolUseId).sort(), ["first-tool", "second-tool"]);
    assert.deepEqual(closeActiveWindows({ identity: first, toolUseId: "first-tool", closedAt: 2_001 }).paths, ["target.txt"]);
    assert.deepEqual(closeActiveWindows({ identity: second, toolUseId: "second-tool", closedAt: 2_002 }).paths, ["target.txt"]);
  } finally { context.cleanup(); }
});

test("an expired own active window makes a post capture partial", () => {
  const context = fixture();
  const openedAt = 10_000;
  let inspections = 0;
  const windows = {
    registerActiveWindows: (args) => registerActiveWindows({ ...args, openedAt }),
    inspectActiveWindowOverlap: (args) => inspectActiveWindowOverlap({ ...args, inspectedAt: openedAt + (inspections++ < 2 ? 1 : 301_000) }),
    closeActiveWindows: (args) => closeActiveWindows({ ...args, closedAt: openedAt + 301_000 }),
  };
  try {
    captureStreamingDiff({ cwd: context.root, session: "long-tool", toolUseId: "long", phase: "pre", hintedPaths: ["target.txt"], activeWindows: windows });
    captureStreamingDiff({ cwd: context.root, session: "peer-tool", toolUseId: "peer", phase: "pre", hintedPaths: ["target.txt"], activeWindows: windows });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    const result = captureStreamingDiff({ cwd: context.root, session: "long-tool", toolUseId: "long", phase: "post", hintedPaths: ["target.txt"], activeWindows: windows });
    assert.equal(result.card.status, "partial");
    assert.match(result.card.partialReason, /active window expired before close/u);
  } finally { context.cleanup(); }
});

test("a retried post publishes only one terminal card for a tool use", () => {
  const context = fixture();
  try {
    const pre = captureStreamingDiff({ cwd: context.root, session: "dedupe", toolUseId: "one-tool", phase: "pre", hintedPaths: ["target.txt"] });
    writeFileSync(join(context.root, "target.txt"), "after\n");
    captureStreamingDiff({ cwd: context.root, session: "dedupe", toolUseId: "one-tool", phase: "post", hintedPaths: ["target.txt"] });
    captureStreamingDiff({ cwd: context.root, session: "dedupe", toolUseId: "one-tool", phase: "post", hintedPaths: ["target.txt"] });
    const cards = readJournal(pre.identity.feedDir).cards.filter((card) => !card.partialReason?.includes("attempt in progress / unterminated"));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].toolUseId, "one-tool");
  } finally { context.cleanup(); }
});
