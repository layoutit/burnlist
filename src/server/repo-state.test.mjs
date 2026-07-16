import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

function writeV2Lock(lock, { pid, host = os.hostname(), token = "a".repeat(64), createdAt = Date.now() } = {}) {
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, `owner-${token}.json`), `${JSON.stringify({ version: 1, pid, hostname: host, token, createdAt })}\n`);
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
  writeV2Lock(lock, { pid: process.pid });
  assert.throws(() => withRepoStateLock(repo, () => assert.fail("lock must not be acquired")), /locked by pid/u);
});

test("withRepoStateLock steals a fresh lock whose holder is dead", (t) => {
  const repo = tempDir(t);
  const lock = join(repoStateDir(repo), ".lock");
  const dead = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(dead.status, 0);
  writeV2Lock(lock, { pid: dead.pid });
  assert.equal(withRepoStateLock(repo, () => "returned"), "returned");
  assert.equal(existsSync(lock), false);
});

test("withRepoStateLock steals an aged lock whose holder is dead", (t) => {
  const repo = tempDir(t);
  const lock = join(repoStateDir(repo), ".lock");
  const dead = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(dead.status, 0);
  writeV2Lock(lock, { pid: dead.pid, createdAt: Date.now() - 120_000 });
  assert.equal(withRepoStateLock(repo, () => 42), 42);
  assert.equal(existsSync(lock), false);
});

test("withRepoStateLock does not steal an aged lock held by a live process", (t) => {
  const repo = tempDir(t);
  const lock = join(repoStateDir(repo), ".lock");
  writeV2Lock(lock, { pid: process.pid, createdAt: Date.now() - 120_000 });
  assert.throws(() => withRepoStateLock(repo, () => assert.fail("lock must not be acquired")), /locked by pid/u);
  assert.equal(existsSync(lock), true);
});

test("withRepoStateLock ignores old recovery artifacts", (t) => {
  const repo = tempDir(t);
  const state = repoStateDir(repo);
  const lock = join(state, ".lock");
  mkdirSync(state, { recursive: true });
  const dead = spawnSync(process.execPath, ["-e", ""]);
  writeV2Lock(lock, { pid: dead.pid });
  writeFileSync(join(state, ".lock.recovery"), "arbitrary old artifact");
  assert.equal(withRepoStateLock(repo, () => "recovered"), "recovered");
  assert.equal(existsSync(join(state, ".lock.recovery")), true);
});

test("withRepoStateLock never steals a foreign-host lock and eventually breaks local pid reuse", (t) => {
  const repo = tempDir(t);
  const lock = join(repoStateDir(repo), ".lock");
  writeV2Lock(lock, { pid: 1, host: "foreign-host", createdAt: Date.now() - 60 * 60_000 });
  assert.throws(() => withRepoStateLock(repo, () => assert.fail("foreign lock must be respected")), { code: "ELOCKED" });
  rmSync(lock, { recursive: true });
  writeV2Lock(lock, { pid: process.pid, createdAt: Date.now() - 16 * 60_000 });
  assert.equal(withRepoStateLock(repo, () => "reclaimed"), "reclaimed");
});

test("withRepoStateLock release cleanup does not mask a callback result", (t) => {
  const repo = tempDir(t);
  assert.equal(withRepoStateLock(repo, () => "sentinel"), "sentinel");
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
  const metrics = join(repo, "metrics.json");
  const moduleUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "repo-state.mjs")).href;
  const script = `
    import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
    import { withRepoStateLock } from ${JSON.stringify(moduleUrl)};
    const [repo, shared, metrics, writer] = process.argv.slice(1);
    withRepoStateLock(repo, () => {
      const previous = existsSync(shared) ? readFileSync(shared, "utf8").trim().split(/\\n/u).filter(Boolean).length : 0;
      const state = existsSync(metrics) ? JSON.parse(readFileSync(metrics, "utf8")) : { active: 0, max: 0 };
      state.active += 1; state.max = Math.max(state.max, state.active); writeFileSync(metrics, JSON.stringify(state));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
      appendFileSync(shared, writer + ":" + (previous + 1) + ":" + "x".repeat(4096) + "\\n");
      state.active -= 1; writeFileSync(metrics, JSON.stringify(state));
    });
  `;
  const children = Array.from({ length: 8 }, (_, index) => spawn(
    process.execPath,
    ["--input-type=module", "-e", script, repo, shared, metrics, String(index)],
    { stdio: ["ignore", "ignore", "pipe"] },
  ));
  await Promise.all(children.map(completedChild));
  const lines = readFileSync(shared, "utf8").trim().split("\n");
  assert.equal(lines.length, 8);
  assert.deepEqual(lines.map((line) => Number(line.split(":", 3)[1])).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const line of lines) assert.match(line, /^\d:[1-8]:x{4096}$/u);
  assert.deepEqual(JSON.parse(readFileSync(metrics, "utf8")), { active: 0, max: 1 });
  assert.equal(existsSync(join(repoStateDir(repo), ".lock")), false);
});
