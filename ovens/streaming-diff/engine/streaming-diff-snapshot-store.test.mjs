import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureCard, STREAMING_DIFF_ABSENT, STREAMING_DIFF_MISSING } from "./streaming-diff-capture.mjs";
import { resolveStreamingDiffIdentity, snapshotDirectory } from "./streaming-diff-feed.mjs";
import {
  closeActiveWindows,
  inspectActiveWindowOverlap,
  markPreSnapshotAttributionUnavailable,
  markPreSnapshotOverlapped,
  markPreSnapshotRegistered,
  registerActiveWindows,
  removePreSnapshot,
  STREAMING_DIFF_ACTIVE_WINDOW_MAX_BYTES,
  STREAMING_DIFF_ACTIVE_WINDOW_MAX_ENTRIES,
  takePreSnapshot,
  writePreSnapshot,
} from "./streaming-diff-snapshot-store.mjs";

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
    markPreSnapshotRegistered({ identity: context.identity, toolUseId: "tool-1" });
    markPreSnapshotOverlapped({ identity: context.identity, toolUseId: "tool-1" });
    markPreSnapshotAttributionUnavailable({ identity: context.identity, toolUseId: "tool-1", reason: "test unavailable" });
    removePreSnapshot({ identity: context.identity, toolUseId: "tool-1" });
    assert.equal(existsSync(written.path), false);
    for (const marker of ["registered", "overlapped", "unavailable"]) assert.equal(existsSync(written.path.replace(/\.json$/u, `.${marker}`)), false);
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
    assert.deepEqual(stored.hintedPaths, [".env", "private.pem", "ignored.txt", "safe.txt", "binary.bin", "escape.txt"]);
    const taken = takePreSnapshot({ identity: context.identity, toolUseId: "tool-2" });
    assert.equal(taken.preSnapshot.get("safe.txt"), STREAMING_DIFF_MISSING);
    assert.deepEqual(taken.preSnapshot.get("binary.bin"), { binary: true, bytes: 3 });
    for (const path of [".env", "private.pem", "ignored.txt", "escape.txt"]) {
      assert.equal(taken.preSnapshot.get(path), STREAMING_DIFF_MISSING);
    }
    rmSync(outside, { recursive: true, force: true });
  } finally { context.cleanup(); }
});

test("an invalid UTF-8 pre-snapshot stays captured binary metadata after a valid-text post", () => {
  const context = fixture();
  try {
    const path = join(context.root, "invalid.txt");
    writeFileSync(path, Buffer.from([0xc3, 0x28]));
    const written = writePreSnapshot({ identity: context.identity, toolUseId: "invalid-utf8", hintedPaths: ["invalid.txt"] });
    const stored = JSON.parse(readFileSync(written.path, "utf8"));
    assert.deepEqual(stored.entries["invalid.txt"], { kind: "binary", bytes: 2 });
    writeFileSync(path, "valid text\n");
    const { preSnapshot } = takePreSnapshot({ identity: context.identity, toolUseId: "invalid-utf8" });
    const card = captureCard({
      hintedPaths: ["invalid.txt"],
      preSnapshot,
      readPost: () => readFileSync(path),
      listUntracked: () => ["invalid.txt"],
      toolUseId: "invalid-utf8",
      revId: "r-0123456789abcdef01234567",
      now: () => "2026-07-15T09:00:00.000Z",
    });
    assert.deepEqual(card.files, [{ path: "invalid.txt", kind: "binary", meta: { bytes: 11 } }]);
    assert.equal(card.status, "captured");
    assert.equal(card.files[0].diff, undefined);
  } finally { context.cleanup(); }
});

test("snapshot records enforce a serialized byte cap before write and fail closed when unreadable", () => {
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
    const unreadable = takePreSnapshot({ identity: context.identity, toolUseId: "small" });
    assert.equal(unreadable.found, false);
    assert.equal(unreadable.attributionUnavailable, true);
  } finally { context.cleanup(); }
});

test("active-window registry preserves normal overlaps and flags overflow without evicting live windows", () => {
  const context = fixture();
  try {
    const openedAt = Date.now();
    const first = resolveStreamingDiffIdentity({ cwd: context.root, session: "overlap-first" });
    const second = resolveStreamingDiffIdentity({ cwd: context.root, session: "overlap-second" });
    registerActiveWindows({ identity: first, toolUseId: "overlap-a", hintedPaths: ["shared.txt"], openedAt });
    registerActiveWindows({ identity: second, toolUseId: "overlap-b", hintedPaths: ["shared.txt"], openedAt: openedAt + 1 });
    assert.deepEqual(closeActiveWindows({ identity: first, toolUseId: "overlap-a", closedAt: openedAt + 2 }).paths, ["shared.txt"]);
    assert.deepEqual(closeActiveWindows({ identity: second, toolUseId: "overlap-b", closedAt: openedAt + 3 }).paths, ["shared.txt"]);

    for (let index = 0; index < STREAMING_DIFF_ACTIVE_WINDOW_MAX_ENTRIES; index += 1) {
      const identity = resolveStreamingDiffIdentity({ cwd: context.root, session: `session-${index}` });
      registerActiveWindows({ identity, toolUseId: `tool-${index}`, hintedPaths: [`unique-${index}.txt`], openedAt: openedAt + index });
    }
    const overflow = resolveStreamingDiffIdentity({ cwd: context.root, session: "overflow" });
    registerActiveWindows({ identity: overflow, toolUseId: "overflow-tool", hintedPaths: ["overflow.txt"], openedAt: openedAt + 1_000 });
    const path = join(context.root, ".local", "burnlist", "streaming-diff-active-windows.json");
    const serialized = readFileSync(path, "utf8");
    assert.ok(JSON.parse(serialized).windows.length <= STREAMING_DIFF_ACTIVE_WINDOW_MAX_ENTRIES);
    assert.ok(Buffer.byteLength(serialized, "utf8") <= STREAMING_DIFF_ACTIVE_WINDOW_MAX_BYTES);
    assert.equal(closeActiveWindows({ identity: overflow, toolUseId: "overflow-tool", closedAt: openedAt + 1_001 }).attributionUnavailable, true);
  } finally { context.cleanup(); }
});

test("closing an overlap durably marks the peer snapshot after its window expires", () => {
  const context = fixture();
  try {
    const openedAt = Date.now();
    const first = resolveStreamingDiffIdentity({ cwd: context.root, session: "first" });
    const second = resolveStreamingDiffIdentity({ cwd: context.root, session: "second" });
    writePreSnapshot({ identity: first, toolUseId: "a", hintedPaths: ["shared.txt"] });
    writePreSnapshot({ identity: second, toolUseId: "b", hintedPaths: ["shared.txt"] });
    registerActiveWindows({ identity: first, toolUseId: "a", hintedPaths: ["shared.txt"], openedAt });
    registerActiveWindows({ identity: second, toolUseId: "b", hintedPaths: ["shared.txt"], openedAt: openedAt + 1 });
    closeActiveWindows({ identity: first, toolUseId: "a", closedAt: openedAt + 2 });
    assert.equal(takePreSnapshot({ identity: second, toolUseId: "b" }).overlapped, true);
    assert.deepEqual(inspectActiveWindowOverlap({ identity: second, toolUseId: "b", inspectedAt: openedAt + 5 * 60_000 + 2 }).paths, []);
    assert.equal(takePreSnapshot({ identity: second, toolUseId: "b" }).overlapped, true);
  } finally { context.cleanup(); }
});

test("a corrupt active-window registry fails closed as attribution unavailable", () => {
  const context = fixture();
  try {
    const path = join(context.root, ".local", "burnlist", "streaming-diff-active-windows.json");
    mkdirSync(join(context.root, ".local", "burnlist"), { recursive: true });
    writeFileSync(path, "{ broken");
    const overlap = inspectActiveWindowOverlap({ identity: context.identity, toolUseId: "corrupt" });
    assert.equal(overlap.attributionUnavailable, true);
  } finally { context.cleanup(); }
});
