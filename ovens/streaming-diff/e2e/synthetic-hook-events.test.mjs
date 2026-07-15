import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, get } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withServer } from "../../../src/server/dashboard-routes-fixtures.mjs";
import { captureStreamingDiff } from "../engine/streaming-diff-feed-capture.mjs";
import { resolveStreamingDiffIdentity } from "../engine/streaming-diff-feed.mjs";
import { streamingDiffHandler } from "../engine/streaming-diff-handler.mjs";

function parseCards(text) {
  return text.split("\n\n").filter(Boolean).map((block) => ({
    id: block.match(/^id: (.+)$/mu)?.[1] ?? null,
    type: block.match(/^event: (.+)$/mu)?.[1] ?? "message",
    card: JSON.parse(block.match(/^data: (.+)$/mu)?.[1] ?? "null"),
  })).filter((entry) => entry.id);
}

class MockResponse extends EventEmitter {
  constructor() { super(); this.headers = null; this.writes = []; }
  writeHead(status, headers) { this.headers = { status, headers }; }
  write(text) { this.writes.push(text); return true; }
  end() { this.emit("finish"); }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-synthetic-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "notes", "burnlists", "inprogress"), { recursive: true });
  writeFileSync(join(root, "note.txt"), "before\n");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function capturePair(root) {
  captureStreamingDiff({ cwd: root, session: "synthetic", toolUseId: "tool-synthetic", phase: "pre", hintedPaths: ["note.txt"] });
  writeFileSync(join(root, "note.txt"), "after\n");
  captureStreamingDiff({ cwd: root, session: "synthetic", toolUseId: "tool-synthetic", phase: "post", hintedPaths: ["note.txt"] });
  return resolveStreamingDiffIdentity({ cwd: root, session: "synthetic" });
}

async function canBindLoopback() {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return true;
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") return false;
    throw error;
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

async function readCards(baseUrl, path, expected) {
  return new Promise((resolve, reject) => {
    const cards = [];
    let buffer = "";
    let settled = false;
    const fail = (error) => { if (!settled) { settled = true; reject(error); } };
    const request = get(new URL(path, baseUrl), { headers: { accept: "text/event-stream" } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        fail(new Error(`SSE response status was ${response.statusCode}, expected 200`));
        return;
      }
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;
        for (;;) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary < 0) return;
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const id = block.match(/^id: (.+)$/mu)?.[1];
          const data = block.match(/^data: (.+)$/mu)?.[1];
          if (id && data) cards.push({ id, card: JSON.parse(data) });
          if (cards.length === expected && !settled) {
            settled = true;
            response.destroy();
            resolve(cards);
            return;
          }
        }
      });
      response.once("error", fail);
      response.once("end", () => fail(new Error("SSE stream ended before the expected cards arrived")));
    });
    request.once("error", fail);
  });
}

test("socketless synthetic hook capture streams the exact card sequence", () => {
  const { root, cleanup } = fixture();
  try {
    const identity = capturePair(root);
    const res = new MockResponse();
    const result = streamingDiffHandler.serveData({
      binding: { repoRoot: identity.logicalRepoRoot }, bindingPath: identity.feedRoot,
      req: { headers: { accept: "text/event-stream" } }, res,
      url: new URL(`http://localhost/?repoKey=${identity.logicalRepoKey}&worktreeKey=${identity.worktreeKey}&session=synthetic`),
      maxOvenDataBytes: 1024 * 1024,
      timers: { setInterval: () => null, clearInterval: () => {} },
    });
    assert.equal(result, undefined);
    assert.equal(res.headers.status, 200);
    const cards = parseCards(res.writes.join(""));
    assert.equal(cards.length, 2);
    assert.deepEqual(cards.map((entry) => entry.id), cards.map((entry) => `v2:${entry.card.revId}`));
    assert.deepEqual(cards.map((entry) => entry.card.status), ["partial", "captured"]);
    assert.equal(cards[1].card.files[0].path, "note.txt");
    assert.match(cards[1].card.files[0].diff, /-before\n\+after/u);
    res.emit("close");
  } finally { cleanup(); }
});

test("synthetic hook capture reaches the real HTTP SSE reader", { timeout: 20_000 }, async (t) => {
  if (!await canBindLoopback()) return t.skip("requires loopback sockets (runs on host/CI)");
  await withServer({
    scanRoots: ["fixture-repo"],
    setup: async ({ fixtureRoot }) => {
      const repo = join(fixtureRoot, "fixture-repo");
      mkdirSync(join(repo, "notes", "burnlists", "inprogress"), { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: repo, stdio: "ignore" });
      writeFileSync(join(repo, "note.txt"), "before\n");
    },
  }, async ({ baseUrl, repoRoot }) => {
    const cli = join(process.cwd(), "bin", "burnlist.mjs");
    const runCapture = (phase) => execFileSync(process.execPath, [cli, "streaming-diff", "capture", "--session", "synthetic", "--tool-use-id", "tool-synthetic", "--phase", phase, "--path", "note.txt"], { cwd: repoRoot, stdio: "pipe" });
    runCapture("pre");
    writeFileSync(join(repoRoot, "note.txt"), "after\n");
    runCapture("post");
    const identity = resolveStreamingDiffIdentity({ cwd: repoRoot, session: "synthetic" });
    const query = `repoKey=${identity.logicalRepoKey}&worktreeKey=${identity.worktreeKey}&session=synthetic`;
    const cards = await readCards(baseUrl, `/api/oven-data/streaming-diff?${query}`, 2);
    assert.deepEqual(cards.map((entry) => entry.id), cards.map((entry) => `v2:${entry.card.revId}`));
    assert.deepEqual(cards.map((entry) => entry.card.status), ["partial", "captured"]);
    assert.equal(cards[1].card.files[0].path, "note.txt");
    assert.match(cards[1].card.files[0].diff, /-before\n\+after/u);
  });
});
