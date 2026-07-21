import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  encodeOvenEventReplayCursor,
  readOvenEventDeliveries,
  serveOvenEventFeed,
} from "./oven-event-feed.mjs";
import { publishOvenEvent } from "./oven-event-store.mjs";

function fixture(t, repoKey = "aaaaaaaaaaaa") {
  const root = mkdtempSync(join(tmpdir(), "burnlist-event-feed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repoKey, name: `repo-${repoKey}` };
}

function input(cursor, overrides = {}) {
  return {
    ovenId: "future-oven",
    subjectId: "subject-1",
    kind: "iteration",
    phase: "complete",
    cursor,
    occurredAt: "2026-07-21T12:00:00.000Z",
    payload: { cursor },
    ...overrides,
  };
}

function request(headers = {}) {
  return Object.assign(new EventEmitter(), { headers });
}

class FakeResponse extends EventEmitter {
  constructor(results = []) {
    super();
    this.results = [...results];
    this.writes = [];
    this.destroyed = false;
    this.headersSent = false;
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
  }

  write(value) {
    this.writes.push(value);
    const result = this.results.length ? this.results.shift() : true;
    if (result instanceof Error) throw result;
    return result;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
}

function fakeTimers() {
  const handles = [];
  return {
    handles,
    setInterval(callback) {
      const handle = { callback, cleared: false, unref() {} };
      handles.push(handle);
      return handle;
    },
    clearInterval(handle) { handle.cleared = true; },
  };
}

function delivery(repo, cursor, sequence) {
  const eventId = `oe1-${String(sequence).padStart(64, "0")}`;
  return {
    deliveryId: `${repo.repoKey}:future-oven:${sequence}:${eventId}`,
    repoKey: repo.repoKey,
    repo: repo.name,
    schema: "burnlist-oven-event@1",
    authority: "observational",
    eventId,
    sequence,
    ovenId: "future-oven",
    subjectId: "subject-1",
    kind: "iteration",
    phase: "complete",
    cursor,
    occurredAt: "2026-07-21T12:00:00.000Z",
    payload: {},
  };
}

test("unfiltered feed discovery treats ovenIds=[] as every Oven stream", (t) => {
  const repo = fixture(t);
  publishOvenEvent(repo.root, input("future"));
  publishOvenEvent(repo.root, input("other", {
    ovenId: "other-oven",
    occurredAt: "2026-07-21T12:01:00.000Z",
  }));
  const batch = readOvenEventDeliveries([repo], { ovenIds: [], limit: 10 });
  assert.deepEqual(batch.deliveries.map((event) => event.cursor), ["future", "other"]);
  assert.deepEqual(batch.deliveries.map((event) => event.ovenId), ["future-oven", "other-oven"]);
});

test("JSON feed paginates with vector cursors while preserving each stream sequence", (t) => {
  const repoA = fixture(t, "aaaaaaaaaaaa");
  const repoB = fixture(t, "bbbbbbbbbbbb");
  publishOvenEvent(repoA.root, input("a-1"));
  publishOvenEvent(repoA.root, input("a-2", { occurredAt: "2026-07-21T11:00:00.000Z" }));
  publishOvenEvent(repoB.root, input("b-1", { occurredAt: "2026-07-21T11:30:00.000Z" }));
  let first;
  serveOvenEventFeed({
    req: request(),
    res: {},
    url: new URL("http://localhost/api/events?limit=2"),
    repos: [repoA, repoB],
    json(_res, status, body) { first = { status, body }; },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 2);
  assert.equal(first.body.truncated, true);
  assert.deepEqual(first.body.events.map((event) => event.cursor), ["b-1", "a-1"]);

  let replay;
  serveOvenEventFeed({
    req: request(),
    res: {},
    url: new URL(`http://localhost/api/events?after=${encodeURIComponent(first.body.cursor)}`),
    repos: [repoA, repoB],
    json(_res, status, body) { replay = { status, body }; },
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.events.map((event) => event.cursor), ["a-2"]);
});

test("feed bounds vector cursors and discovered stream count", (t) => {
  const watermarks = Object.fromEntries(Array.from(
    { length: 65 },
    (_, index) => [`aaaaaaaaaaaa/oven-${index}`, index],
  ));
  assert.throws(() => encodeOvenEventReplayCursor(watermarks), /too many stream watermarks/u);

  const repo = fixture(t);
  for (let index = 0; index < 65; index += 1) {
    mkdirSync(join(repo.root, ".local", "burnlist", "events", `oven-${index}`, "sequence"), { recursive: true });
  }
  assert.throws(
    () => readOvenEventDeliveries([repo]),
    (error) => error.status === 413 && /limited to 64 streams/u.test(error.message),
  );
});

test("SSE subscriber cap is released on disconnect and write failure", () => {
  const repo = { root: "/unused", repoKey: "aaaaaaaaaaaa", name: "repo" };
  const empty = () => ({ deliveries: [], warnings: [] });
  const firstReq = request({ accept: "text/event-stream" });
  const firstRes = new FakeResponse();
  serveOvenEventFeed({
    req: firstReq,
    res: firstRes,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    maxSubscribers: 1,
    timers: fakeTimers(),
    readDeliveries: empty,
  });
  assert.throws(() => serveOvenEventFeed({
    req: request({ accept: "text/event-stream" }),
    res: new FakeResponse(),
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    maxSubscribers: 1,
    timers: fakeTimers(),
    readDeliveries: empty,
  }), (error) => error.status === 429);
  firstReq.emit("aborted");

  const failed = new FakeResponse([true, new Error("socket closed")]);
  assert.doesNotThrow(() => serveOvenEventFeed({
    req: request({ accept: "text/event-stream" }),
    res: failed,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    maxSubscribers: 1,
    timers: fakeTimers(),
    readDeliveries: () => ({ deliveries: [delivery(repo, "first", 1)], warnings: [] }),
  }));
  assert.equal(failed.destroyed, true);

  const replacement = new FakeResponse();
  assert.doesNotThrow(() => serveOvenEventFeed({
    req: request({ accept: "text/event-stream" }),
    res: replacement,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    maxSubscribers: 1,
    timers: fakeTimers(),
    readDeliveries: empty,
  }));
  replacement.emit("close");
});

test("SSE pauses scans under backpressure and reports isolated observer errors", () => {
  const repo = { root: "/unused", repoKey: "aaaaaaaaaaaa", name: "repo" };
  const timers = fakeTimers();
  const res = new FakeResponse([true, true, false, true]);
  let reads = 0;
  const batches = [
    {
      deliveries: [delivery(repo, "first", 1)],
      warnings: [{ repoKey: repo.repoKey, code: "ECORRUPT", error: "bad neighboring stream" }],
    },
    { deliveries: [delivery(repo, "second", 2)], warnings: [] },
  ];
  const req = request({ accept: "text/event-stream" });
  serveOvenEventFeed({
    req,
    res,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    timers,
    readDeliveries() { return batches[Math.min(reads++, batches.length - 1)]; },
  });
  assert.equal(reads, 1);
  assert.match(res.writes.join(""), /event: observer-error/u);
  assert.match(res.writes.join(""), /event: oven-event/u);
  timers.handles[0].callback();
  timers.handles[0].callback();
  assert.equal(reads, 1);
  res.emit("drain");
  timers.handles[0].callback();
  assert.equal(reads, 2);
  assert.equal(res.writes.filter((value) => value.includes("event: oven-event")).length, 2);
  req.emit("aborted");
  assert.ok(timers.handles.every((handle) => handle.cleared));
});
