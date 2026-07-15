import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { STREAMING_DIFF_ABSENT, STREAMING_DIFF_MISSING } from "./streaming-diff-capture.mjs";
import { resolveStreamingDiffIdentity, snapshotDirectory } from "./streaming-diff-feed.mjs";
import { removePreSnapshot, takePreSnapshot, writePreSnapshot } from "./streaming-diff-snapshot-store.mjs";

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-snapshot-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  return { root, identity: resolveStreamingDiffIdentity({ cwd: root, session: "session-a" }), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("pre-snapshots round-trip bounded safe content and remain until durable post publication", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.root, "safe.txt"), "before\n");
    const written = writePreSnapshot({ identity: context.identity, toolUseId: "tool-1", hintedPaths: ["safe.txt", "gone.txt"] });
    assert.equal(existsSync(written.path), true);
    const taken = takePreSnapshot({ identity: context.identity, toolUseId: "tool-1" });
    assert.equal(taken.found, true);
    assert.deepEqual(taken.hintedPaths, ["safe.txt", "gone.txt"]);
    assert.equal(taken.preSnapshot.get("safe.txt"), "before\n");
    assert.equal(taken.preSnapshot.get("gone.txt"), STREAMING_DIFF_ABSENT);
    assert.equal(existsSync(written.path), true);
    removePreSnapshot({ identity: context.identity, toolUseId: "tool-1" });
    assert.equal(existsSync(written.path), false);
    assert.equal(takePreSnapshot({ identity: context.identity, toolUseId: "tool-1" }).found, false);
  } finally { context.cleanup(); }
});

test("snapshot storage never writes denied, ignored, binary, or secret-looking source content", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.root, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(context.root, ".env"), "SHOULD_NOT_PERSIST\n");
    writeFileSync(join(context.root, "private.pem"), "SHOULD_NOT_PERSIST\n");
    writeFileSync(join(context.root, "ignored.txt"), "SHOULD_NOT_PERSIST\n");
    writeFileSync(join(context.root, "safe.txt"), "api_key=SHOULD_NOT_PERSIST\n");
    writeFileSync(join(context.root, "binary.bin"), Buffer.from([1, 0, 2]));
    writeFileSync(join(context.root, "unhinted.txt"), "UNHINTED_CONTENT\n");
    const outside = mkdtempSync(join(tmpdir(), "burnlist-streaming-snapshot-outside-"));
    writeFileSync(join(outside, "outside.txt"), "SHOULD_NOT_PERSIST\n");
    symlinkSync(join(outside, "outside.txt"), join(context.root, "escape.txt"));
    const written = writePreSnapshot({
      identity: context.identity,
      toolUseId: "tool-2",
      hintedPaths: [".env", "private.pem", "ignored.txt", "safe.txt", "binary.bin", "escape.txt", "../outside"],
    });
    const stored = JSON.parse(readFileSync(written.path, "utf8"));
    assert.doesNotMatch(JSON.stringify(stored), /SHOULD_NOT_PERSIST/u);
    assert.doesNotMatch(JSON.stringify(stored), /UNHINTED_CONTENT/u);
    assert.equal(Object.hasOwn(stored.entries, ".env"), false);
    assert.equal(Object.hasOwn(stored.entries, "private.pem"), false);
    assert.equal(Object.hasOwn(stored.entries, "ignored.txt"), false);
    assert.equal(Object.hasOwn(stored.entries, "escape.txt"), false);
    assert.deepEqual(stored.hintedPaths, ["safe.txt", "binary.bin"]);
    const taken = takePreSnapshot({ identity: context.identity, toolUseId: "tool-2" });
    assert.equal(taken.preSnapshot.get("safe.txt"), STREAMING_DIFF_MISSING);
    assert.equal(taken.preSnapshot.get("binary.bin"), STREAMING_DIFF_MISSING);
    assert.equal(taken.preSnapshot.has(".env"), false);
    assert.equal(taken.preSnapshot.has("private.pem"), false);
    assert.equal(taken.preSnapshot.has("ignored.txt"), false);
    assert.equal(taken.preSnapshot.has("escape.txt"), false);
    rmSync(outside, { recursive: true, force: true });
  } finally { context.cleanup(); }
});

test("snapshot records enforce a serialized byte cap before write and before parse", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.root, "one.txt"), "a".repeat(256 * 1024));
    writeFileSync(join(context.root, "two.txt"), "b".repeat(256 * 1024));
    assert.throws(
      () => writePreSnapshot({ identity: context.identity, toolUseId: "too-large", hintedPaths: ["one.txt", "two.txt"] }),
      /snapshot exceeds/u,
    );
    const names = existsSync(snapshotDirectory(context.identity)) ? readdirSync(snapshotDirectory(context.identity)) : [];
    assert.equal(names.some((name) => name.endsWith(".json")), false);
    const written = writePreSnapshot({ identity: context.identity, toolUseId: "small", hintedPaths: [] });
    writeFileSync(written.path, "x".repeat(600 * 1024));
    assert.equal(statSync(written.path).size > 512 * 1024, true);
    assert.throws(() => takePreSnapshot({ identity: context.identity, toolUseId: "small" }), /snapshot exceeds/u);
  } finally { context.cleanup(); }
});
