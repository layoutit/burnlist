import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { containedJoin, repoStateDir, withRepoStateLock } from "./repo-state.mjs";

function tempDir(t) {
  const path = mkdtempSync(join(os.tmpdir(), "burnlist-repo-state-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test("repoStateDir returns the repo-local state directory", (t) => {
  const repo = tempDir(t);
  assert.equal(repoStateDir(repo), join(repo, ".local", "burnlist"));
});

test("containedJoin accepts normal children and rejects traversal", (t) => {
  const repo = tempDir(t);
  assert.equal(containedJoin(repo, "runs", "run-1"), join(repoStateDir(repo), "runs", "run-1"));
  assert.throws(() => containedJoin(repo, "..", "outside"), /escapes/u);
  assert.throws(() => containedJoin(repo, "..", "..", "etc"), /escapes/u);
});

test("containedJoin rejects a .local symlink outside the repo", (t) => {
  const root = tempDir(t);
  const repo = join(root, "repo");
  const outside = join(root, "outside");
  mkdirSync(repo);
  mkdirSync(outside);
  symlinkSync(outside, join(repo, ".local"), "dir");
  assert.throws(() => containedJoin(repo, "ovens", "unsafe"), /escapes/u);
});

test("withRepoStateLock refuses a fresh lock held by a live process", (t) => {
  const repo = tempDir(t);
  const lock = join(repoStateDir(repo), ".lock");
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "held", createdAt: Date.now() }));
  assert.throws(() => withRepoStateLock(repo, () => assert.fail("lock must not be acquired")), /locked by pid/u);
});

test("withRepoStateLock steals a fresh lock whose holder is dead", (t) => {
  const repo = tempDir(t);
  const lock = join(repoStateDir(repo), ".lock");
  mkdirSync(dirname(lock), { recursive: true });
  const dead = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(dead.status, 0);
  writeFileSync(lock, JSON.stringify({ pid: dead.pid, token: "dead", createdAt: Date.now() }));
  assert.equal(withRepoStateLock(repo, () => "returned"), "returned");
  assert.equal(existsSync(lock), false);
});

test("withRepoStateLock steals an aged lock whose holder is dead", (t) => {
  const repo = tempDir(t);
  const lock = join(repoStateDir(repo), ".lock");
  mkdirSync(dirname(lock), { recursive: true });
  const dead = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(dead.status, 0);
  writeFileSync(lock, JSON.stringify({ pid: dead.pid, token: "aged", createdAt: Date.now() - 120_000 }));
  const old = new Date(Date.now() - 61_000);
  utimesSync(lock, old, old);
  assert.equal(withRepoStateLock(repo, () => 42), 42);
  assert.equal(existsSync(lock), false);
});

test("withRepoStateLock does not steal an aged lock held by a live process", (t) => {
  const repo = tempDir(t);
  const lock = join(repoStateDir(repo), ".lock");
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "aged", createdAt: Date.now() - 120_000 }));
  const old = new Date(Date.now() - 61_000);
  utimesSync(lock, old, old);
  assert.throws(() => withRepoStateLock(repo, () => assert.fail("lock must not be acquired")), /locked by pid/u);
  assert.equal(existsSync(lock), true);
});

function completedChild(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child exited ${code}: ${stderr}`));
    });
  });
}

test("withRepoStateLock serializes writers across processes", async (t) => {
  const repo = tempDir(t);
  const shared = join(repo, "shared.txt");
  const moduleUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "repo-state.mjs")).href;
  const script = `
    import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
    import { withRepoStateLock } from ${JSON.stringify(moduleUrl)};
    const [repo, shared, writer] = process.argv.slice(1);
    withRepoStateLock(repo, () => {
      const previous = existsSync(shared) ? readFileSync(shared, "utf8").trim().split(/\\n/u).filter(Boolean).length : 0;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      appendFileSync(shared, writer + ":" + (previous + 1) + ":" + "x".repeat(4096) + "\\n");
    });
  `;
  const children = Array.from({ length: 6 }, (_, index) => spawn(
    process.execPath,
    ["--input-type=module", "-e", script, repo, shared, String(index)],
    { stdio: ["ignore", "ignore", "pipe"] },
  ));
  await Promise.all(children.map(completedChild));
  const lines = readFileSync(shared, "utf8").trim().split("\n");
  assert.equal(lines.length, 6);
  assert.deepEqual(lines.map((line) => Number(line.split(":", 3)[1])).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  for (const line of lines) assert.match(line, /^\d:[1-6]:x{4096}$/u);
  assert.equal(existsSync(join(repoStateDir(repo), ".lock")), false);
});
