import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertStreamingDiffData,
  compactStreamingDiffLines,
  createStreamingDiffChange,
  createStreamingDiffPayload,
  diffStreamingText,
} from "./streaming-diff-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const hookPath = resolve(scriptDirectory, "streaming-diff-hook.mjs");
const threadA = "12345678-1234-4123-8123-123456789abc";
const threadB = "87654321-4321-4321-8321-cba987654321";

test("line diff preserves review ordering and line numbers", () => {
  const lines = diffStreamingText("alpha\nbeta\ngamma\n", "alpha\nBETA\ngamma\ndelta\n");
  assert.deepEqual(lines, [
    { kind: "context", oldNumber: 1, newNumber: 1, text: "alpha" },
    { kind: "deletion", oldNumber: 2, newNumber: null, text: "beta" },
    { kind: "addition", oldNumber: null, newNumber: 2, text: "BETA" },
    { kind: "context", oldNumber: 3, newNumber: 3, text: "gamma" },
    { kind: "addition", oldNumber: null, newNumber: 4, text: "delta" },
  ]);
});

test("timestamped changes require one thread identity", () => {
  const change = createStreamingDiffChange({
    before: "one\ntwo\n",
    after: "one\nTWO\nthree\n",
    revision: 3,
    sourcePath: "demo.txt",
    threadId: threadA,
    turnId: "turn-3",
    toolName: "functions.exec",
    timestamp: "2026-07-14T12:00:00.000Z",
  });
  assert.deepEqual(change.summary, { additions: 2, deletions: 1, changedLines: 3 });
  const payload = createStreamingDiffPayload({ threadId: threadA, turnId: "turn-3", revision: 3, changes: [change] });
  assert.equal(assertStreamingDiffData(payload).changes[0].actor.threadId, threadA);
  assert.throws(() => assertStreamingDiffData({ ...payload, thread: { ...payload.thread, id: threadB } }), /another thread/u);
});

test("review projection keeps only changed hunks and nearby context", () => {
  const before = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join("\n");
  const afterLines = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`);
  afterLines[6] = "line seven changed";
  afterLines[12] = "line thirteen changed";
  const compact = compactStreamingDiffLines(diffStreamingText(before, afterLines.join("\n")), 2);
  assert.equal(compact.filter((line) => line.kind === "omission").length, 1);
  assert.deepEqual(compact.filter((line) => line.kind === "deletion").map((line) => line.text), ["line 7", "line 13"]);
  assert.deepEqual(compact.filter((line) => line.kind === "addition").map((line) => line.text), ["line seven changed", "line thirteen changed"]);
  assert.ok(compact.length < 18, "unchanged middle lines should not be rendered");
});

test("review projection trims blank context at hunk edges without hiding a changed blank line", () => {
  const compact = compactStreamingDiffLines([
    { kind: "context", oldNumber: 1, newNumber: 1, text: "" },
    { kind: "deletion", oldNumber: 2, newNumber: null, text: "old" },
    { kind: "addition", oldNumber: null, newNumber: 2, text: "" },
    { kind: "context", oldNumber: 3, newNumber: 3, text: "   " },
  ], 2);
  assert.deepEqual(compact, [
    { kind: "deletion", oldNumber: 2, newNumber: null, text: "old" },
    { kind: "addition", oldNumber: null, newNumber: 2, text: "" },
  ]);
});

test("hook capture keeps two same-repo threads in separate feeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-streaming-diff-hook-"));
  try {
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "alpha.txt"), "alpha\n");
    await writeFile(join(root, "beta.txt"), "beta\n");
    runHook(root, "start", threadA, null, null);
    runHook(root, "prompt", threadA, null, null, "Fix the dashboard controls");
    runHook(root, "pre", threadA, "turn-a", "functions.exec");
    await writeFile(join(root, "alpha.txt"), "ALPHA\n");
    runHook(root, "post", threadA, "turn-a", "functions.exec");
    runHook(root, "start", threadB, null, null);
    runHook(root, "pre", threadB, "turn-b", "apply_patch");
    await writeFile(join(root, "beta.txt"), "BETA\n");
    runHook(root, "post", threadB, "turn-b", "apply_patch");

    const feedA = await readFeed(root, threadA);
    const feedB = await readFeed(root, threadB);
    assert.deepEqual(feedA.changes.map((change) => change.sourcePath), ["alpha.txt"]);
    assert.deepEqual(feedB.changes.map((change) => change.sourcePath), ["beta.txt"]);
    assert.equal(feedA.changes[0].actor.threadId, threadA);
    assert.equal(feedB.changes[0].actor.threadId, threadB);
    assert.equal(feedA.thread.label, "Fix the dashboard controls");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runHook(root, action, threadId, turnId, toolName, prompt = null) {
  const result = spawnSync(process.execPath, [hookPath, action], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ session_id: threadId, turn_id: turnId, tool_name: toolName, prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function readFeed(root, threadId) {
  const path = join(root, ".local", "burnlist", "streaming-diff", "threads", threadId, "current.json");
  return assertStreamingDiffData(JSON.parse(await readFile(path, "utf8")));
}
