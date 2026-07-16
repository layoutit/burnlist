import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, get } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withServer } from "../../../src/server/dashboard-routes-fixtures.mjs";
import { appendCard, readJournal } from "./streaming-diff-journal.mjs";
import { ensureStreamingDiffFeed } from "./streaming-diff-ensure-feed.mjs";
import { feedIdentity } from "./streaming-diff-feed.mjs";
import { STREAMING_DIFF_LIST_LIMITS, streamingDiffHandler } from "./streaming-diff-handler.mjs";

function card(index) {
  return { revId: `r-${index.toString(16).padStart(24, "a")}`, toolUseId: `tool-${index}`, ts: `2026-07-15T12:00:0${index}.000Z`, status: "captured", files: [{ path: `file-${index}.txt`, kind: "modified", diff: "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-before\n+after" }] };
}

function largeCard(index) {
  return { ...card(index), files: [{ path: `large-${index}.txt`, kind: "modified", diff: "x".repeat(250_000) }] };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-handler-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
  const context = ensureStreamingDiffFeed({ cwd: root, session: "handler-direct" });
  return { root, context, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function handlerContext(context, overrides = {}) {
  const query = `repoKey=${context.identity.logicalRepoKey}&worktreeKey=${context.identity.worktreeKey}&session=handler-direct`;
  return {
    binding: { repoRoot: context.identity.logicalRepoRoot }, bindingPath: context.identity.feedRoot,
    req: { headers: {} }, url: new URL(`http://localhost/?${query}`), maxOvenDataBytes: 1024 * 1024,
    ...overrides,
  };
}

function timerHarness() {
  const active = new Set();
  const cleared = [];
  return {
    timers: {
      setInterval(fn, delay) { const handle = { fn, delay }; active.add(handle); return handle; },
      clearInterval(handle) { cleared.push(handle); active.delete(handle); },
    },
    active,
    cleared,
  };
}

class FakeResponse extends EventEmitter {
  constructor({ slow = false } = {}) {
    super();
    this.slow = slow;
    this.headers = null;
    this.writes = [];
    this.destroyed = false;
    this.ended = false;
  }

  writeHead(status, headers) { this.headers = { status, headers }; }
  write(value) { this.writes.push(value); return !this.slow; }
  end() { this.ended = true; this.emit("finish"); }
  destroy() { this.destroyed = true; this.emit("close"); }
}

async function requestSse(baseUrl, path, headers = {}) {
  let stream;
  await new Promise((resolve, reject) => {
    const request = get(new URL(path, baseUrl), { headers: { accept: "text/event-stream", ...headers } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`SSE response status was ${response.statusCode}, expected 200`));
        return;
      }
      let buffer = "";
      stream = { events: [], closed: false, error: null, response };
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;
        for (;;) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary < 0) break;
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (block.startsWith(":")) stream.events.push({ comment: block });
          else stream.events.push({ id: block.match(/^id: (.+)$/mu)?.[1] ?? null, type: block.match(/^event: (.+)$/mu)?.[1] ?? "message", data: JSON.parse(block.match(/^data: (.+)$/mu)?.[1] ?? "null") });
        }
      });
      response.once("error", (error) => { if (!stream.closed) stream.error = error; });
      response.once("end", () => { if (!stream.closed) stream.error = new Error("SSE stream ended before the expected cards arrived"); });
      resolve();
    });
    request.once("error", reject);
  });
  stream.close = () => { stream.closed = true; stream.response.destroy(); };
  return stream;
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
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

test("dashboard pure read leaves a raced feed untouched and reports reset", () => {
  const { context, cleanup } = fixture();
  try {
    appendCard(context.identity.feedDir, card(1), { identity: feedIdentity(context.identity) });
    const manifest = join(context.identity.feedDir, "manifest.json");
    const revision = join(context.identity.feedDir, `rev-${card(1).revId}.json`);
    unlinkSync(revision);
    const before = { manifest: readFileSync(manifest, "utf8"), mtime: statSync(manifest).mtimeMs };
    const response = streamingDiffHandler.serveData(handlerContext(context));
    assert.equal(response.reset, true);
    assert.deepEqual(response.cards, []);
    const res = new FakeResponse();
    streamingDiffHandler.serveData(handlerContext(context, {
      req: { headers: { accept: "text/event-stream" } }, res,
      timers: { setInterval: () => null, clearInterval: () => {} },
    }));
    assert.match(res.writes.join(""), /event: reset\ndata: \{"type":"reset"\}/u);
    res.emit("close");
    assert.equal(readFileSync(manifest, "utf8"), before.manifest);
    assert.equal(statSync(manifest).mtimeMs, before.mtime);
  } finally { cleanup(); }
});

test("recent feeds reads only bounded manifests and never card payloads", () => {
  const { root, context, cleanup } = fixture();
  try {
    const base = join(context.identity.feedRoot, context.identity.logicalRepoKey, context.identity.worktreeKey);
    for (let index = 0; index < STREAMING_DIFF_LIST_LIMITS.maxFeedDirs + 8; index += 1) mkdirSync(join(base, index.toString(16).padStart(32, "0")), { recursive: true });
    let manifestReads = 0;
    const response = streamingDiffHandler.serveData(handlerContext(context, {
      url: new URL(`http://localhost/?list&repoKey=${context.identity.logicalRepoKey}`),
      readManifest(path) { manifestReads += 1; assert.equal(path.startsWith(root), true); return null; },
    }));
    assert.equal(response.feeds.length, 0);
    assert.equal(response.truncated, true);
    assert.equal(manifestReads > 0 && manifestReads <= STREAMING_DIFF_LIST_LIMITS.maxFeedDirs, true);
  } finally { cleanup(); }
});

test("recent feed listings budget their response envelope and truncate instead of returning 413", () => {
  const { context, cleanup } = fixture();
  try {
    appendCard(context.identity.feedDir, card(1), { identity: feedIdentity(context.identity) });
    const url = new URL(`http://localhost/?list&repoKey=${context.identity.logicalRepoKey}`);
    const full = streamingDiffHandler.serveData(handlerContext(context, { url }));
    const entryBytes = Buffer.byteLength(JSON.stringify(full.feeds[0]), "utf8");
    const fullBytes = Buffer.byteLength(JSON.stringify(full), "utf8");
    const maxOvenDataBytes = Math.floor((entryBytes + fullBytes) / 2);

    assert.ok(entryBytes < maxOvenDataBytes && maxOvenDataBytes < fullBytes);
    const response = streamingDiffHandler.serveData(handlerContext(context, { url, maxOvenDataBytes }));
    assert.equal(response.truncated, true);
    assert.deepEqual(response.feeds, []);
    assert.ok(Buffer.byteLength(JSON.stringify(response), "utf8") <= maxOvenDataBytes);
  } finally { cleanup(); }
});

test("SSE contains post-header errors and clears both timers on every completion path", () => {
  const { context, cleanup } = fixture();
  try {
    appendCard(context.identity.feedDir, card(1), { identity: feedIdentity(context.identity) });
    const before = new FakeResponse();
    assert.throws(() => streamingDiffHandler.serveData(handlerContext(context, { res: before, req: { headers: { accept: "text/event-stream" } }, reconnectFeed: () => { throw new Error("before headers"); } })), /Streaming Diff feed is unavailable/u);
    assert.equal(before.headers, null);

    for (const completion of ["close", "error", "finish"]) {
      const timers = timerHarness();
      const res = new FakeResponse();
      streamingDiffHandler.serveData(handlerContext(context, { res, req: { headers: { accept: "text/event-stream" } }, timers: timers.timers }));
      assert.equal(timers.active.size, 2);
      res.emit(completion);
      assert.equal(timers.active.size, 0, `${completion} clears all intervals`);
      assert.equal(timers.cleared.length, 2, `${completion} clears poll and heartbeat`);
    }

    const timers = timerHarness();
    const res = new FakeResponse();
    let calls = 0;
    streamingDiffHandler.serveData(handlerContext(context, { res, req: { headers: { accept: "text/event-stream" } }, timers: timers.timers, reconnectFeed: () => {
      calls += 1;
      if (calls > 1) throw new Error("after headers");
      return { type: "reset", cards: [card(1)] };
    } }));
    [...timers.active].find((handle) => handle.delay === 300).fn();
    assert.equal(res.headers.status, 200);
    assert.equal(res.ended, true);
  } finally { cleanup(); }
});

test("SSE subscriber caps reject before headers while an allowed stream works", () => {
  const { context, cleanup } = fixture();
  try {
    appendCard(context.identity.feedDir, card(1), { identity: feedIdentity(context.identity) });
    const first = new FakeResponse();
    streamingDiffHandler.serveData(handlerContext(context, { res: first, req: { headers: { accept: "text/event-stream" } }, sseOptions: { maxGlobalSubscribers: 1, maxSubscribersPerFeed: 1 } }));
    const rejected = new FakeResponse();
    assert.throws(() => streamingDiffHandler.serveData(handlerContext(context, { res: rejected, req: { headers: { accept: "text/event-stream" } }, sseOptions: { maxGlobalSubscribers: 1, maxSubscribersPerFeed: 1 } })), (error) => error.status === 503);
    assert.equal(rejected.headers, null);
    assert.match(first.writes.join(""), /id: v2:[a-f0-9]{12}:[a-f0-9]{12}:[a-f0-9]{32}:g-[a-f0-9]+:r-/u);
    first.emit("close");
  } finally { cleanup(); }
});

test("foreign cursors reset and malformed feed errors are sanitized", () => {
  const { context, cleanup } = fixture();
  try {
    appendCard(context.identity.feedDir, card(1), { identity: feedIdentity(context.identity) });
    const res = new FakeResponse();
    streamingDiffHandler.serveData(handlerContext(context, {
      res, req: { headers: { accept: "text/event-stream", "last-event-id": "v2:foreign-feed:r-aaaaaaaaaaaaaaaaaaaaaaaa" } },
      timers: { setInterval: () => null, clearInterval: () => {} },
    }));
    assert.match(res.writes.join(""), /event: reset/u);
    res.emit("close");
    const raw = "/private/feed/secret-content";
    assert.throws(
      () => streamingDiffHandler.serveData(handlerContext(context, { readJournal: () => { throw new Error(raw); } })),
      (error) => error.message === "Streaming Diff feed is unavailable" && !error.message.includes(raw),
    );
  } finally { cleanup(); }
});

test("SSE rechecks feed containment and identity before every poll", () => {
  const { context, cleanup } = fixture();
  try {
    appendCard(context.identity.feedDir, card(1), { identity: feedIdentity(context.identity) });
    const timers = timerHarness();
    let reads = 0;
    const res = new FakeResponse();
    streamingDiffHandler.serveData(handlerContext(context, {
      res, timers: timers.timers, req: { headers: { accept: "text/event-stream" } },
      readJournal(path) {
        const journal = readJournal(path);
        reads += 1;
        return reads < 3 ? journal : { ...journal, manifest: { ...journal.manifest, identity: { ...journal.manifest.identity, session: "other" } } };
      },
    }));
    [...timers.active].find((handle) => handle.delay === 300).fn();
    assert.equal(res.ended, true);
  } finally { cleanup(); }
});

test("server lists only its repo binding and streams retained replay/reset cards", { timeout: 20_000 }, async (t) => {
  if (!await canBindLoopback()) return t.skip("requires loopback sockets (runs on host/CI)");
  const state = {};
  await withServer({
    scanRoots: ["fixture-repo"],
    setup: async ({ fixtureRoot }) => {
      const repo = join(fixtureRoot, "fixture-repo");
      mkdirSync(join(repo, "notes", "burnlists", "inprogress"), { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: repo, stdio: "ignore" });
      writeFileSync(join(repo, "one.txt"), "before\n");
      state.first = ensureStreamingDiffFeed({ cwd: repo, session: "session-one" }).identity;
      appendCard(state.first.feedDir, card(1), { identity: feedIdentity(state.first) });
      appendCard(state.first.feedDir, card(2), { identity: feedIdentity(state.first) });
      state.second = ensureStreamingDiffFeed({ cwd: repo, session: "session-two" }).identity;
      appendCard(state.second.feedDir, card(3), { identity: feedIdentity(state.second) });
    },
  }, async ({ baseUrl }) => {
    const query = `repoKey=${state.first.logicalRepoKey}&worktreeKey=${state.first.worktreeKey}&session=session-one`;
    assert.equal((await fetch(`${baseUrl}api/oven-data/streaming-diff?list`)).status, 400);
    const recent = await (await fetch(`${baseUrl}api/oven-data/streaming-diff?list&repoKey=${state.first.logicalRepoKey}`)).json();
    assert.equal(recent.feeds.length, 2);
    assert.deepEqual(new Set(recent.feeds.map((entry) => entry.identity.session)), new Set(["session-one", "session-two"]));

    const stream = await requestSse(baseUrl, `/api/oven-data/streaming-diff?${query}`);
    await waitFor(() => { if (stream.error) throw stream.error; return stream.events.filter((entry) => entry.id).length === 2; }, "initial cards");
    const initialIds = stream.events.filter((entry) => entry.id).map((entry) => entry.id);
    assert.equal(initialIds[0].endsWith(`:${card(1).revId}`), true);
    assert.equal(initialIds[1].endsWith(`:${card(2).revId}`), true);
    stream.close();

    const replay = await requestSse(baseUrl, `/api/oven-data/streaming-diff?${query}`, { "last-event-id": initialIds[0] });
    await waitFor(() => { if (replay.error) throw replay.error; return replay.events.some((entry) => entry.id?.endsWith(`:${card(2).revId}`)); }, "replay suffix");
    replay.close();

    appendCard(state.first.feedDir, card(4), { identity: feedIdentity(state.first), limits: { maxRevs: 1, maxBytes: 1024 } });
    const reset = await requestSse(baseUrl, `/api/oven-data/streaming-diff?${query}`, { "last-event-id": initialIds[0] });
    await waitFor(() => { if (reset.error) throw reset.error; return reset.events.some((entry) => entry.id?.endsWith(`:${card(4).revId}`)); }, "pruned reset");
    assert.equal(reset.events.some((entry) => entry.type === "reset"), true);
    reset.close();

    const slow = new FakeResponse({ slow: true });
    streamingDiffHandler.serveData(handlerContext({ identity: state.first }, { url: new URL(`http://localhost/?${query}`), binding: { repoRoot: state.first.logicalRepoRoot }, bindingPath: state.first.feedRoot, res: slow, req: { headers: { accept: "text/event-stream" } } }));
    assert.equal(slow.destroyed, true);
  });
});
