import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runInstallTransaction } from "./skills-install-transaction.mjs";

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
        createdIdentity = lstatSync(target);
        onCreated();
        rmSync(target, { recursive: true, force: true });
        link(context.newSource, target);
        const replacement = lstatSync(target);
        assert.notDeepEqual({ ino: replacement.ino, dev: replacement.dev }, { ino: createdIdentity.ino, dev: createdIdentity.dev });
        throw new Error("later failure");
      },
    }), /later failure/u);
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), context.newSource);
  } finally { context.cleanup(); }
});
