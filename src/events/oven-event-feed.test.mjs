import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  decodeOvenEventReplayCursor,
  encodeOvenEventReplayCursor,
  ovenEventFeedSelection,
  readOvenEventDeliveries,
  serveOvenEventFeed,
} from "./oven-event-feed.mjs";
import { createOvenEventObserver } from "./oven-event-observer.mjs";
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

test("native EventSource reconnect advances with Last-Event-ID over the original query cursor", () => {
  const repo = { root: "/unused", repoKey: "aaaaaaaaaaaa", name: "repo" };
  const baseline = encodeOvenEventReplayCursor({ "aaaaaaaaaaaa/future-oven": 1 });
  const reconnect = encodeOvenEventReplayCursor({ "aaaaaaaaaaaa/future-oven": 2 });
  const selection = ovenEventFeedSelection(
    new URL(`http://localhost/api/events?stream=1&after=${encodeURIComponent(baseline)}`),
    [repo],
    { "last-event-id": reconnect },
  );
  assert.deepEqual(selection.watermarks, { "aaaaaaaaaaaa/future-oven": 2 });
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

test("JSON feed drops stale cursor streams when serving a new stream", (t) => {
  const cursor = encodeOvenEventReplayCursor(Object.fromEntries(Array.from(
    { length: 64 },
    (_, index) => [`aaaaaaaaaaaa/oven-${index}`, 1],
  )));
  const repoA = fixture(t, "aaaaaaaaaaaa");
  const repoB = fixture(t, "bbbbbbbbbbbb");
  publishOvenEvent(repoB.root, input("b-1"));
  let result;
  serveOvenEventFeed({
    req: request(),
    res: {},
    url: new URL(`http://localhost/api/events?after=${encodeURIComponent(cursor)}`),
    repos: [repoA, repoB],
    json(_res, status, body) { result = { status, body }; },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.events.map((event) => event.cursor), ["b-1"]);
  const watermarks = decodeOvenEventReplayCursor(result.body.cursor);
  assert.equal(watermarks["bbbbbbbbbbbb/future-oven"], 1);
  assert.equal(Object.keys(watermarks).some((key) => key.startsWith("aaaaaaaaaaaa/")), false);
});

test("SSE feed drops stale cursor streams when serving a new stream", (t) => {
  const cursor = encodeOvenEventReplayCursor(Object.fromEntries(Array.from(
    { length: 64 },
    (_, index) => [`aaaaaaaaaaaa/oven-${index}`, 1],
  )));
  const repoA = fixture(t, "aaaaaaaaaaaa");
  const repoB = fixture(t, "bbbbbbbbbbbb");
  publishOvenEvent(repoB.root, input("b-1"));
  const req = request({ accept: "text/event-stream" });
  const res = new FakeResponse();
  serveOvenEventFeed({
    req,
    res,
    url: new URL(`http://localhost/api/events?stream=1&after=${encodeURIComponent(cursor)}`),
    repos: [repoA, repoB],
    json() {},
    timers: fakeTimers(),
  });
  assert.equal(res.destroyed, false);
  assert.match(res.writes.join(""), /event: oven-event/u);
  const id = res.writes.join("").match(/^id: (.+)$/mu)?.[1];
  assert.ok(id);
  const watermarks = decodeOvenEventReplayCursor(id);
  assert.equal(watermarks["bbbbbbbbbbbb/future-oven"], 1);
  req.emit("aborted");
});

test("SSE subscriber cap is released on disconnect and write failure", () => {
  const repo = { root: "/unused", repoKey: "aaaaaaaaaaaa", name: "repo" };
  const empty = () => ({ deliveries: [], warnings: [] });
  const timers = fakeTimers();
  let readDeliveries = empty;
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readTail: () => ({ watermarks: {}, warnings: [], streamKeys: [] }),
    readDeliveries: (...args) => readDeliveries(...args),
    maxSubscribers: 1,
    timers,
  });
  const firstReq = request({ accept: "text/event-stream" });
  const firstRes = new FakeResponse();
  serveOvenEventFeed({
    req: firstReq,
    res: firstRes,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    maxSubscribers: 1,
    observer,
  });
  assert.throws(() => serveOvenEventFeed({
    req: request({ accept: "text/event-stream" }),
    res: new FakeResponse(),
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    maxSubscribers: 1,
    observer,
  }), (error) => error.status === 429);
  firstReq.emit("aborted");

  const failed = new FakeResponse([true, new Error("socket closed")]);
  readDeliveries = () => ({ deliveries: [delivery(repo, "first", 1)], warnings: [] });
  assert.doesNotThrow(() => serveOvenEventFeed({
    req: request({ accept: "text/event-stream" }),
    res: failed,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    maxSubscribers: 1,
    observer,
  }));
  assert.equal(failed.destroyed, true);

  const replacement = new FakeResponse();
  readDeliveries = empty;
  assert.doesNotThrow(() => serveOvenEventFeed({
    req: request({ accept: "text/event-stream" }),
    res: replacement,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    maxSubscribers: 1,
    observer,
  }));
  replacement.emit("close");
});

test("SSE closes one slow client while a shared observer continues for healthy clients", () => {
  const repo = { root: "/unused", repoKey: "aaaaaaaaaaaa", name: "repo" };
  const timers = fakeTimers();
  const slow = new FakeResponse([true, true, false]);
  const healthy = new FakeResponse();
  let reads = 0;
  const batches = [
    { deliveries: [], warnings: [], streamKeys: [] },
    {
      deliveries: [delivery(repo, "first", 1)],
      warnings: [{ repoKey: repo.repoKey, code: "ECORRUPT", error: "bad neighboring stream" }],
    },
    { deliveries: [delivery(repo, "second", 2)], warnings: [] },
  ];
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readTail: () => ({ watermarks: {}, warnings: [], streamKeys: [] }),
    readDeliveries() { return batches[Math.min(reads++, batches.length - 1)]; },
    timers,
  });
  const slowReq = request({ accept: "text/event-stream" });
  serveOvenEventFeed({
    req: slowReq,
    res: slow,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    observer,
  });
  const healthyReq = request({ accept: "text/event-stream" });
  serveOvenEventFeed({
    req: healthyReq,
    res: healthy,
    url: new URL("http://localhost/api/events?stream=1"),
    repos: [repo],
    json() {},
    observer,
  });
  assert.equal(reads, 2);
  assert.equal(slow.destroyed, true);
  assert.match(healthy.writes.join(""), /event: observer-error/u);
  assert.match(healthy.writes.join(""), /event: oven-event/u);
  timers.handles[0].callback();
  assert.equal(reads, 3);
  assert.equal(healthy.writes.filter((value) => value.includes("event: oven-event")).length, 2);
  healthyReq.emit("aborted");
  assert.ok(timers.handles.every((handle) => handle.cleared));
});

test("SSE emits an explicit reset before replaying a retained stream window", (t) => {
  const repo = fixture(t);
  publishOvenEvent(repo.root, input("one"), { retentionLimit: 2 });
  publishOvenEvent(repo.root, input("two"), { retentionLimit: 2 });
  publishOvenEvent(repo.root, input("three"), { retentionLimit: 2 });
  const cursor = encodeOvenEventReplayCursor({ [`${repo.repoKey}/future-oven`]: 0 });
  const req = request({ accept: "text/event-stream" });
  const res = new FakeResponse();
  serveOvenEventFeed({
    req,
    res,
    url: new URL(`http://localhost/api/events?stream=1&after=${encodeURIComponent(cursor)}`),
    repos: [repo],
    json() {},
    timers: fakeTimers(),
  });
  const output = res.writes.join("");
  assert.match(output, /event: oven-reset/u);
  assert.match(output, /"reason":"retention-gap"/u);
  assert.equal(res.writes.filter((value) => value.includes("event: oven-event")).length, 2);
  assert.ok(output.indexOf("event: oven-reset") < output.indexOf("event: oven-event"));
  req.emit("aborted");
});
