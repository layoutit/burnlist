import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { appendCard } from "./streaming-diff-journal.mjs";
import { captureCard, captureLimits, redact, STREAMING_DIFF_ABSENT, STREAMING_DIFF_CAPTURE_LIMITS, STREAMING_DIFF_MISSING } from "./streaming-diff-capture.mjs";
import { captureGitCard, createGitCaptureIo, gitCaptureLimits, STREAMING_DIFF_GIT_LIMITS } from "./streaming-diff-capture-git.mjs";

const identity = { logicalRepoKey: "logical", worktreeKey: "worktree", session: "session" };
const fixed = { toolUseId: "tool-fixture", revId: "r-0123456789abcdef01234567", now: () => "2026-07-15T09:00:00.000Z" };

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-capture-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test"]);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function capture(options = {}) {
  return captureCard({
    hintedPaths: ["foo.ts"],
    preSnapshot: new Map([["foo.ts", "export const foo = 1;\n"]]),
    readPost: () => "export const foo = 2;\n",
    ...fixed,
    ...options,
  });
}

test("the actual git capture path diffs a pre-existing dirty hinted-file snapshot", () => {
  const context = repository();
  try {
    writeFileSync(join(context.root, "foo.ts"), "export const foo = 1;\n");
    git(context.root, ["add", "foo.ts"]);
    git(context.root, ["commit", "--quiet", "-m", "baseline"]);
    writeFileSync(join(context.root, "foo.ts"), "export const foo = 1; // predate\n");
    const preSnapshot = new Map([["foo.ts", readFileSync(join(context.root, "foo.ts"))]]);
    writeFileSync(join(context.root, "foo.ts"), "export const foo = 2; // predate\n");
    const card = captureGitCard({ worktreeRoot: context.root, hintedPaths: ["foo.ts"], preSnapshot, ...fixed });
    assert.deepEqual(card, {
      revId: fixed.revId,
      toolUseId: fixed.toolUseId,
      ts: fixed.now(),
      status: "captured",
      files: [{ path: "foo.ts", kind: "modified", diff: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-export const foo = 1; // predate\n+export const foo = 2; // predate" }],
    });
    assert.equal(card.files[0].diff.includes("-export const foo = 1;\n"), false);
  } finally {
    context.cleanup();
  }
});

test("only explicit absence may produce an addition; an omitted pre-snapshot is unavailable", () => {
  const missing = capture({ hintedPaths: ["created.txt"], preSnapshot: new Map(), readPost: () => "existing untracked\n", listUntracked: () => ["created.txt"] });
  assert.equal(missing.status, "partial");
  assert.deepEqual(missing.files, [{ path: "created.txt", kind: "unavailable", meta: { reason: "snapshot unavailable" } }]);
  const created = capture({ hintedPaths: ["created.txt"], preSnapshot: new Map([["created.txt", STREAMING_DIFF_ABSENT]]), readPost: () => "created now\n", listUntracked: () => ["created.txt"] });
  const deleted = capture({ hintedPaths: ["gone.txt"], preSnapshot: new Map([["gone.txt", "gone\n"]]), readPost: () => STREAMING_DIFF_ABSENT });
  assert.equal(created.files[0].kind, "added");
  assert.equal(deleted.files[0].kind, "deleted");
  assert.equal(STREAMING_DIFF_MISSING === STREAMING_DIFF_ABSENT, false);
});

test("one small edit has an exact bounded minimal unified hunk", () => {
  const before = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`);
  const after = [...before];
  after[20] = "changed line 21";
  const card = capture({ preSnapshot: new Map([["foo.ts", `${before.join("\n")}\n`]]), readPost: () => `${after.join("\n")}\n` });
  assert.equal(card.files[0].diff, "--- a/foo.ts\n+++ b/foo.ts\n@@ -18,7 +18,7 @@\n line 18\n line 19\n line 20\n-line 21\n+changed line 21\n line 22\n line 23\n line 24");
});

test("deny/redaction happens before every journal write and cannot disclose protected bytes", () => {
  const feed = mkdtempSync(join(tmpdir(), "burnlist-streaming-feed-"));
  const worktree = mkdtempSync(join(tmpdir(), "burnlist-streaming-worktree-"));
  const outside = mkdtempSync(join(tmpdir(), "burnlist-streaming-outside-"));
  try {
    const keyMarker = ["-----BEGIN", " PRIVATE", " KEY-----"].join("");
    const raw = { ".env": "env-value", "document.txt": `${keyMarker}\nmaterial`, "values.txt": "password = hunter2\napi_key: short-value\nAuthorization: Bearer bearer-value\ntoken=token-value\n" };
    const reads = [];
    const card = capture({
      hintedPaths: Object.keys(raw),
      preSnapshot: new Map([[".env", raw[".env"]], ["document.txt", "old\n"], ["values.txt", "old\n"]]),
      readPost(path) { reads.push(path); return raw[path]; },
    });
    appendCard(feed, card, { identity });
    for (const forbidden of [raw[".env"], "hunter2", "short-value", "bearer-value", "token-value", "material"]) {
      assert.equal(JSON.stringify(card).includes(forbidden), false);
    }
    assert.equal(reads.includes(".env"), false);
    assert.equal(card.files.find((file) => file.path === "document.txt").kind, "redacted");

    writeFileSync(join(worktree, "swap.txt"), "inside\n");
    writeFileSync(join(outside, "secret.txt"), "outside bytes");
    const io = createGitCaptureIo(worktree);
    const swapped = captureCard({
      hintedPaths: ["swap.txt"],
      preSnapshot: new Map([["swap.txt", "inside\n"]]),
      inspect(path) {
        const inspected = io.inspect(path);
        rmSync(join(worktree, "swap.txt"));
        symlinkSync(join(outside, "secret.txt"), join(worktree, "swap.txt"));
        return inspected;
      },
      readPost: io.readPost,
      ...fixed,
      revId: "r-0123456789abcdef01234568",
    });
    appendCard(feed, swapped, { identity });
    assert.equal(JSON.stringify(swapped).includes("outside bytes"), false);

    const context = repository();
    try {
      writeFileSync(join(context.root, ".gitignore"), "ignored.txt\n");
      writeFileSync(join(context.root, "ignored.txt"), "do not publish\n");
      git(context.root, ["add", ".gitignore"]);
      git(context.root, ["add", "-f", "ignored.txt"]);
      git(context.root, ["commit", "--quiet", "-m", "tracked ignored fixture"]);
      writeFileSync(join(context.root, "ignored.txt"), "tracked change\n");
      const ignored = captureGitCard({
        worktreeRoot: context.root,
        hintedPaths: ["ignored.txt"],
        preSnapshot: new Map([["ignored.txt", "do not publish\n"]]),
        ...fixed,
        revId: "r-0123456789abcdef01234569",
      });
      assert.equal(ignored.files[0].path, "ignored.txt");
      assert.equal(ignored.files[0].kind, "modified");
      appendCard(feed, ignored, { identity });

      writeFileSync(join(context.root, "untracked-ignored.txt"), "ignored\n");
      writeFileSync(join(context.root, ".gitignore"), "ignored.txt\nuntracked-ignored.txt\n");
      const untrackedIgnored = captureGitCard({
        worktreeRoot: context.root,
        hintedPaths: ["untracked-ignored.txt"],
        preSnapshot: new Map([["untracked-ignored.txt", STREAMING_DIFF_ABSENT]]),
        ...fixed,
        revId: "r-0123456789abcdef01234570",
      });
      assert.deepEqual(untrackedIgnored.files, [{ path: "untracked-ignored.txt", kind: "denied" }]);
    } finally {
      context.cleanup();
    }

    const persisted = readdirSync(feed)
      .filter((name) => name.startsWith("rev-") && name.endsWith(".json"))
      .map((name) => readFileSync(join(feed, name), "utf8"));
    assert.equal(persisted.length, 3);
    for (const forbidden of [raw[".env"], "material", "hunter2", "short-value", "bearer-value", "token-value", "outside bytes"]) {
      assert.equal(persisted.some((contents) => contents.includes(forbidden)), false, forbidden);
    }
  } finally {
    rmSync(feed, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("containment and deny gates run before bounded untracked discovery", () => {
  const card = capture({
    hintedPaths: ["secrets/config.txt", "inside.txt", "../outside.txt"],
    preSnapshot: new Map([["inside.txt", STREAMING_DIFF_ABSENT]]),
    readPost: () => "inside\n",
    inspect: (path) => path === "inside.txt" ? { type: "file", contained: true } : { type: "symlink", contained: false },
    listUntracked(paths) { assert.deepEqual(paths, ["inside.txt"]); return ["inside.txt", "outside.txt"]; },
  });
  assert.equal(card.files.find((file) => file.path === "secrets/config.txt").kind, "denied");
  assert.equal(card.files.find((file) => file.path === "inside.txt").kind, "added");
  assert.equal(card.status, "partial");
});

test("withheld file entries always make the capture partial", () => {
  const denied = capture({ hintedPaths: [".env"], preSnapshot: new Map([[".env", "before"]]), readPost: () => "after" });
  const redacted = capture({ readPost: () => "Authorization: Bearer secret" });

  for (const card of [denied, redacted]) {
    assert.equal(card.status, "partial");
    assert.match(card.partialReason, /content withheld\/incomplete/u);
  }
  assert.equal(denied.files[0].kind, "denied");
  assert.equal(redacted.files[0].kind, "redacted");
});

test("denied .git hints are partial while binary changes are captured metadata", () => {
  let read = false;
  let inspected = false;
  const denied = capture({
    hintedPaths: [".git/config"], preSnapshot: new Map([[".git/config", "before"]]),
    readPost() { read = true; return "after"; },
    inspect() { inspected = true; return { type: "file", contained: true }; },
  });
  const invalid = Buffer.from([0xc3, 0x28]);
  const binary = capture({ preSnapshot: new Map([["foo.ts", invalid]]), readPost: () => Buffer.from([0xc3, 0x29]) });

  assert.equal(read, false);
  assert.equal(inspected, false);
  assert.deepEqual(denied.files, [{ path: ".git/config", kind: "denied" }]);
  assert.equal(denied.status, "partial");
  assert.deepEqual(binary.files, [{ path: "foo.ts", kind: "binary", meta: { bytes: 2 } }]);
  assert.equal(binary.status, "captured");
  assert.equal(binary.files[0].diff, undefined);
});

test("capture policy overrides can narrow but never enlarge hard ceilings", () => {
  const capture = captureLimits({ maxPaths: 9_999, maxFileBytes: 9_999_999, maxHunkBytes: 0 });
  const git = gitCaptureLimits({ timeout: 0, maxBuffer: 99_999_999 });
  assert.equal(capture.maxPaths, STREAMING_DIFF_CAPTURE_LIMITS.maxPaths);
  assert.equal(capture.maxFileBytes, STREAMING_DIFF_CAPTURE_LIMITS.maxFileBytes);
  assert.equal(capture.maxHunkBytes, 1);
  assert.equal(git.timeout, 1);
  assert.equal(git.maxBuffer, STREAMING_DIFF_GIT_LIMITS.maxBuffer);
});

test("authorization credentials always produce a redacted card entry", () => {
  for (const [header, expected] of [
    ["Authorization: Bearer bearer-secret-value", "Authorization: Bearer [REDACTED]"],
    ["Authorization: Token abc", "Authorization: Token [REDACTED]"],
    ["Proxy-Authorization: Bearer x", "Proxy-Authorization: Bearer [REDACTED]"],
    ["Authorization: Bearer \"abc\\\"def\"", "Authorization: Bearer [REDACTED]"],
    ["api_key = 's3cr3t-fragment'; keep", "api_key = [REDACTED]"],
  ]) {
    const transformed = redact(header);
    assert.equal(transformed.text, expected, header);
    assert.equal(transformed.redacted, true, header);
    for (const secret of ["def", "s3cr3t-fragment", "bearer-secret-value"]) {
      if (header.includes(secret)) assert.equal(transformed.text.includes(secret), false, `${secret} survived in ${header}`);
    }
    const card = capture({ readPost: () => `${header}\n` });
    assert.deepEqual(card.files, [{ path: "foo.ts", kind: "redacted", meta: { redacted: true, reason: "secret-looking value" } }]);
  }
});
