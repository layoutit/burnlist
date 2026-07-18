import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { filesystemIdentity, sameFilesystemIdentity } from "./atomic-quarantine.mjs";
import { runInstallTransaction } from "./skills-install-transaction.mjs";

// Force the wall clock to advance at least one tick. A freshly created
// object's modification time (mtime) is set fresh at creation, but its
// resolution is bounded by the clock; without this, two creations issued
// back to back could land in the same tick and make two genuinely different
// filesystem objects compare equal by mtime alone (on top of Linux already
// reusing inode numbers immediately after unlink). Real installs are never
// this fast twice in a row, so this only exists to make the test itself
// deterministic across platforms.
function waitForNextTick() {
  const start = Date.now();
  while (Date.now() === start) { /* busy-wait for the clock to tick */ }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-skills-transaction-"));
  const targetRoot = join(root, "skills");
  mkdirSync(targetRoot);
  const oldSource = join(root, "old");
  const newSource = join(root, "new");
  mkdirSync(oldSource);
  mkdirSync(newSource);
  return { root, targetRoot, oldSource, newSource, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function link(source, target) { symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir"); }

test("transaction keeps symlink backups until exclude commit and restores their type", () => {
  const context = fixture();
  try {
    const target = join(context.targetRoot, "burnlist");
    link(context.oldSource, target);
    const registration = { target, targetRoot: context.targetRoot, state: "link", action: "link" };
    assert.throws(() => runInstallTransaction({
      planned: [registration],
      revalidate: () => ({ state: "link", action: "link" }),
      create: () => link(context.newSource, target),
      exclude: { changed: true, write: () => {}, afterWrite: () => { throw new Error("exclude post-write failure"); } },
    }), /exclude post-write failure/u);
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), context.oldSource);
    assert.deepEqual(readdirSync(context.targetRoot).filter((name) => name.startsWith(".burnlist-skill-transaction-")), []);
  } finally { context.cleanup(); }
});

test("transaction preserves a foreign target that appears immediately before mutation", () => {
  const context = fixture();
  try {
    const first = join(context.targetRoot, "first");
    const raced = join(context.targetRoot, "raced");
    link(context.oldSource, first);
    const planned = [
      { target: first, targetRoot: context.targetRoot, state: "link", action: "link" },
      { target: raced, targetRoot: context.targetRoot, state: "missing", action: "link" },
    ];
    assert.throws(() => runInstallTransaction({
      planned,
      beforeMutation: (registration) => { if (registration.target === raced) writeFileSync(raced, "foreign\n"); },
      revalidate: (registration) => {
        if (registration.target === raced && lstatSync(raced)) throw new Error("foreign target appeared");
        return { state: "link", action: "link" };
      },
      create: (registration) => link(context.newSource, registration.target),
    }), /foreign target appeared/u);
    assert.equal(readlinkSync(first), context.oldSource);
    assert.equal(lstatSync(raced).isFile(), true);
  } finally { context.cleanup(); }
});

test("second revalidation keeps an already-correct target without recreating it", () => {
  const context = fixture();
  try {
    const target = join(context.targetRoot, "burnlist");
    link(context.oldSource, target);
    let checks = 0;
    let created = false;
    runInstallTransaction({
      planned: [{ target, targetRoot: context.targetRoot, state: "link", action: "link" }],
      revalidate: () => {
        checks += 1;
        if (checks === 2) {
          rmSync(target, { recursive: true, force: true });
          link(context.newSource, target);
          return { state: "link", action: "keep" };
        }
        return { state: "link", action: "link" };
      },
      create: () => { created = true; },
    });
    assert.equal(created, false);
    assert.equal(readlinkSync(target), context.newSource);
  } finally { context.cleanup(); }
});

test("transaction records a new target before a post-publish fsync failure", () => {
  const context = fixture();
  try {
    const target = join(context.targetRoot, "burnlist");
    const registration = { target, targetRoot: context.targetRoot, state: "missing", action: "link" };
    assert.throws(() => runInstallTransaction({
      planned: [registration],
      revalidate: () => ({ state: "missing", action: "link" }),
      create: (_, onCreated) => {
        link(context.newSource, target);
        onCreated();
        throw new Error("parent fsync failure");
      },
    }), /parent fsync failure/u);
    assert.throws(() => lstatSync(target), { code: "ENOENT" });
  } finally { context.cleanup(); }
});

test("created-target rollback leaves a foreign entry that replaced it", () => {
  const context = fixture();
  try {
    const target = join(context.targetRoot, "burnlist");
    const registration = { target, targetRoot: context.targetRoot, state: "missing", action: "link" };
    let createdIdentity;
    assert.throws(() => runInstallTransaction({
      planned: [registration],
      revalidate: () => ({ state: "missing", action: "link" }),
      create: (_, onCreated) => {
        link(context.newSource, target);
        createdIdentity = filesystemIdentity(target);
        onCreated();
        rmSync(target, { recursive: true, force: true });
        // Inode numbers can be reused the instant a path is unlinked (this is
        // routine on Linux/ext4), so raw {dev, ino} equality cannot be relied
        // on to prove the replacement below is a distinct object — only the
        // production identity check (dev + ino + mtimeMs) can. Force a clock
        // tick so the replacement's mtimeMs is guaranteed to differ, then
        // assert via the actual guard function used in production, not a
        // platform-dependent assumption about inode allocation.
        waitForNextTick();
        link(context.newSource, target);
        const replacement = filesystemIdentity(target);
        assert.equal(sameFilesystemIdentity(replacement, createdIdentity), false);
        throw new Error("later failure");
      },
    }), /later failure/u);
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), context.newSource);
  } finally { context.cleanup(); }
});

test("rollback leaves a foreign target that races into a restore vacancy", () => {
  const context = fixture();
  try {
    const target = join(context.targetRoot, "burnlist");
    link(context.oldSource, target);
    const registration = { target, targetRoot: context.targetRoot, state: "link", action: "link" };
    assert.throws(() => runInstallTransaction({
      planned: [registration],
      revalidate: () => ({ state: "link", action: "link" }),
      create: (_, onCreated) => {
        link(context.newSource, target);
        onCreated();
        throw new Error("later failure");
      },
      beforeRestore: () => writeFileSync(target, "foreign\n"),
    }), new RegExp(`rollback incomplete: ${target} occupied by a foreign object`, "u"));
    assert.equal(lstatSync(target).isFile(), true);
    assert.equal(readFileSync(target, "utf8"), "foreign\n");
    const transaction = readdirSync(context.targetRoot).find((name) => name.startsWith(".burnlist-skill-transaction-"));
    assert.ok(transaction);
    assert.equal(readlinkSync(join(context.targetRoot, transaction, "previous")), context.oldSource);
  } finally { context.cleanup(); }
});
