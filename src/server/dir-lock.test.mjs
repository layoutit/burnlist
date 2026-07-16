import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CANDIDATE_GC_AGE_MS, LOCK_MAX_AGE_MS, MAX_ATTEMPTS, RETRY_DELAY_MS, withDirectoryLock } from "./dir-lock.mjs";

const token = (letter) => letter.repeat(64);

function paths(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-dir-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return [join(root, ".lock"), join(root, "roots.lock")];
}

function writeV2(lock, { pid = process.pid, host = hostname(), value = token("a"), createdAt = Date.now() } = {}) {
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, `owner-${value}.json`), `${JSON.stringify({ version: 1, pid, hostname: host, token: value, createdAt })}\n`);
}

function writeLegacy(lock, { pid = process.pid, value = "a".repeat(24), createdAt = Date.now() } = {}) {
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid, token: value, createdAt }));
}

function acquire(lock, fn = () => "ok", adapters = {}, hooks = {}) {
  return withDirectoryLock({
    lockPath: lock, fn, adapters, hooks,
    errorFactory: ({ holderPid }) => Object.assign(new Error(`locked ${holderPid ?? "unknown"}`), { code: "ELOCKED" }),
  });
}

function forBoth(t, name, fn) {
  for (const lock of paths(t)) test(`${name}: ${lock.endsWith("roots.lock") ? "registry" : "repo"}`, () => fn(lock));
}

test("valid directory records acquire, release, and use the 64-hex owner name", (t) => {
  forBoth(t, "representation", (lock) => {
    assert.equal(acquire(lock), "ok");
    assert.equal(existsSync(lock), false);
  });
});

test("stale v0.0.2 regular-file locks are reclaimed but fresh live ones are respected", (t) => {
  forBoth(t, "legacy migration", (lock) => {
    const now = 2_000_000;
    const dead = () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); };
    writeLegacy(lock, { pid: 2147483646, createdAt: now });
    assert.equal(acquire(lock, () => "dead reclaimed", { now: () => now, pidProbe: dead, sleep: () => {} }), "dead reclaimed");

    writeLegacy(lock, { createdAt: now - LOCK_MAX_AGE_MS });
    assert.equal(acquire(lock, () => "aged reclaimed", { now: () => now, pidProbe: () => {}, sleep: () => {} }), "aged reclaimed");

    writeLegacy(lock, { createdAt: now - LOCK_MAX_AGE_MS + 1 });
    assert.throws(
      () => acquire(lock, () => assert.fail("fresh live legacy lock must be respected"), { now: () => now, pidProbe: () => {}, sleep: () => {} }),
      { code: "ELOCKED" },
    );
  });
});

test("legacy reclaim only removes the exact stale record it inspected", (t) => {
  forBoth(t, "legacy conditional reclaim", (lock) => {
    const now = 2_000_000;
    const staleToken = "a".repeat(24);
    const freshToken = "b".repeat(24);
    const fresh = JSON.stringify({ pid: process.pid, token: freshToken, createdAt: now });
    writeLegacy(lock, { pid: 2147483646, value: staleToken, createdAt: now - LOCK_MAX_AGE_MS });
    assert.throws(() => acquire(lock, () => assert.fail("a replacement lock must not be stolen"), {
      now: () => now, pidProbe: () => {}, sleep: () => {},
    }, {
      afterStaleJudgment({ legacy }) { if (legacy) writeFileSync(lock, fresh); },
    }), { code: "ELOCKED" });
    assert.equal(readFileSync(lock, "utf8"), fresh);
  });
});

test("foreign, malformed, and unsafe lock shapes remain untouched", (t) => {
  for (const lock of paths(t)) {
    const fixtures = [
      () => writeV2(lock, { host: "foreign-host", createdAt: 0 }),
      () => { mkdirSync(lock); writeFileSync(join(lock, "unexpected"), "x"); },
      () => { mkdirSync(lock); mkdirSync(join(lock, "owner-subdir")); },
      () => { mkdirSync(lock); symlinkSync(join(dirname(lock), "target"), join(lock, `owner-${token("b")}.json`)); },
      () => { writeFileSync(lock, "not a legacy record"); },
    ];
    for (const fixture of fixtures) {
      fixture();
      const before = lstatSync(lock).isSymbolicLink() ? "symlink" : readShape(lock);
      assert.throws(() => acquire(lock, () => assert.fail("must not enter"), { sleep: () => {} }), { code: "ELOCKED" });
      assert.equal(lstatSync(lock).isSymbolicLink() ? "symlink" : readShape(lock), before);
      rmSync(lock, { recursive: true, force: true });
    }
  }
});

test("stale age boundary and foreign-host protection are exact", (t) => {
  forBoth(t, "age", (lock) => {
    const now = 2_000_000;
    writeV2(lock, { createdAt: now - LOCK_MAX_AGE_MS });
    assert.equal(acquire(lock, () => "stolen", { now: () => now, sleep: () => {} }), "stolen");
    writeV2(lock, { createdAt: now - LOCK_MAX_AGE_MS + 1 });
    assert.throws(() => acquire(lock, () => "no", { now: () => now, sleep: () => {} }), { code: "ELOCKED" });
  });
});

test("bounded contention performs 100 publications and 99 sleeps", (t) => {
  forBoth(t, "bounds", (lock) => {
    writeV2(lock);
    let renames = 0;
    let sleeps = 0;
    assert.throws(() => acquire(lock, () => "no", {
      sleep: (ms) => { assert.equal(ms, RETRY_DELAY_MS); sleeps += 1; },
      fs: { renameSync(...args) { renames += 1; return renameSync(...args); } },
    }), { code: "ELOCKED" });
    assert.equal(renames, MAX_ATTEMPTS);
    assert.equal(sleeps, MAX_ATTEMPTS - 1);
  });
});

test("candidate ENOENT rebuild and strict candidate GC are safe", (t) => {
  forBoth(t, "candidate recovery", (lock) => {
    let first = true;
    let sleeps = 0;
    const realRename = renameSync;
    assert.equal(acquire(lock, () => "ok", {
      token: (() => { let n = 0; return () => token((n++ % 2) ? "b" : "a"); })(), sleep: () => { sleeps += 1; },
      fs: { renameSync(source, destination) { if (first) { first = false; rmSync(source, { recursive: true }); } return realRename(source, destination); } },
    }), "ok");
    assert.equal(sleeps, 1);
    const candidate = `${lock}.candidate.${token("c")}`;
    mkdirSync(candidate); writeFileSync(join(candidate, "partial"), "x");
    utimesSync(candidate, new Date(0), new Date(0));
    const evil = `${lock}.candidate.evil`;
    mkdirSync(evil); utimesSync(evil, new Date(0), new Date(0));
    const newline = `${lock}.candidate.${token("d")}\n`;
    mkdirSync(newline); utimesSync(newline, new Date(0), new Date(0));
    acquire(lock, () => "gc", { now: () => CANDIDATE_GC_AGE_MS + 1 });
    assert.equal(existsSync(candidate), false);
    assert.equal(existsSync(evil), true);
    assert.equal(existsSync(newline), true);
  });
});

test("release errors are logged without masking callback work", (t) => {
  forBoth(t, "release policy", (lock) => {
    const logged = [];
    const result = acquire(lock, () => "sentinel", { logger: (error) => logged.push(error), fs: { unlinkSync() { throw Object.assign(new Error("io"), { code: "EIO" }); } } });
    assert.equal(result, "sentinel");
    assert.equal(logged.length, 1);
    rmSync(lock, { recursive: true });
    assert.throws(() => acquire(lock, () => { throw new Error("callback"); }, { logger: () => {}, fs: { unlinkSync() { throw Object.assign(new Error("io"), { code: "EIO" }); } } }), /callback/u);
  });
});

function readShape(path) {
  if (lstatSync(path).isFile()) return readFileSync(path, "utf8");
  return JSON.stringify(readdirSync(path).sort());
}
