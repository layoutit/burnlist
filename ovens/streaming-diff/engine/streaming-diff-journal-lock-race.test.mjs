import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readJournal } from "./streaming-diff-journal.mjs";

const identity = { logicalRepoKey: "logical", worktreeKey: "worktree", session: "session" };

function card(name) {
  return { revId: `r-${name.repeat(24)}`, toolUseId: name, ts: "2026-07-15T09:00:00.000Z", status: "captured", files: [] };
}

function waitFor(path) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const timer = setInterval(() => {
      if (existsSync(path)) { clearInterval(timer); resolve(); }
      else if (Date.now() > deadline) { clearInterval(timer); reject(new Error(`timed out waiting for ${path}`)); }
    }, 5);
  });
}

function child(source, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ["--input-type=module", "--eval", source, ...args], { stdio: "pipe" });
    let stderr = "";
    process.stderr.on("data", (chunk) => { stderr += chunk; });
    process.on("error", reject);
    process.on("exit", (status) => resolve({ status, stderr }));
  });
}

test("a dead-lock takeover cannot steal a live journal writer between inspection and reclaim", async () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-journal-lock-race-"));
  const feed = join(root, "feed");
  const ready = join(root, "ready");
  const go = join(root, "go");
  const held = join(root, "held");
  const release = join(root, "release");
  const result = join(root, "first-result.json");
  const journalUrl = new URL("./streaming-diff-journal.mjs", import.meta.url).href;
  const safeUrl = new URL("../../../src/server/fs-safe.mjs", import.meta.url).href;
  try {
    mkdirSync(feed);
    writeFileSync(join(feed, ".lock"), JSON.stringify({ pid: 2147483646, token: "dead" }));
    const firstSource = `
      import fs, { existsSync, writeFileSync } from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const [feed, ready, go, result, journalUrl, safeUrl] = process.argv.slice(1);
      const original = fs.renameSync;
      fs.renameSync = (from, to, ...rest) => {
        const oldTakeover = from === feed + "/.lock" && to.startsWith(feed + "/.lock.claim.");
        const newPublication = from.includes(".lock.candidate.") && to === feed + "/.lock";
        if (oldTakeover || newPublication) {
          writeFileSync(ready, "");
          while (!existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        return original(from, to, ...rest);
      };
      syncBuiltinESMExports();
      await import(safeUrl);
      const { appendCard } = await import(journalUrl);
      const card = { revId: "r-aaaaaaaaaaaaaaaaaaaaaaaa", toolUseId: "a", ts: "2026-07-15T09:00:00.000Z", status: "captured", files: [] };
      try { appendCard(feed, card, { identity: ${JSON.stringify(identity)} }); writeFileSync(result, JSON.stringify({ ok: true })); }
      catch (error) { writeFileSync(result, JSON.stringify({ ok: false, code: error.code })); }
    `;
    const secondSource = `
      import { existsSync, rmSync, writeFileSync } from "node:fs";
      const [feed, ready, held, release, journalUrl] = process.argv.slice(1);
      while (!existsSync(ready)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      rmSync(feed + "/.lock");
      const { appendCard } = await import(journalUrl);
      const card = { revId: "r-bbbbbbbbbbbbbbbbbbbbbbbb", toolUseId: "b", ts: "2026-07-15T09:00:00.000Z", status: "captured", files: [] };
      appendCard(feed, card, { identity: ${JSON.stringify(identity)}, beforeManifestSwap() {
        writeFileSync(held, "");
        while (!existsSync(release)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      } });
    `;
    const first = child(firstSource, [feed, ready, go, result, journalUrl, safeUrl]);
    const second = child(secondSource, [feed, ready, held, release, journalUrl]);
    await waitFor(ready);
    await waitFor(held);
    writeFileSync(go, "");
    await waitFor(result);
    writeFileSync(release, "");
    const [firstExit, secondExit] = await Promise.all([first, second]);
    assert.equal(firstExit.status, 0, firstExit.stderr);
    assert.equal(secondExit.status, 0, secondExit.stderr);
    assert.deepEqual(JSON.parse(readFileSync(result, "utf8")), { ok: false, code: "ELOCKED" });
    assert.deepEqual(readJournal(feed).cards.map((entry) => entry.toolUseId), ["b"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
