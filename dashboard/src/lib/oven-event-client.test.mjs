import assert from "node:assert/strict";
import test from "node:test";
import {
  createOvenSnapshotClient,
  ovenBrowserTimers,
  ovenSnapshotKey,
} from "./oven-event-client.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(body, { status = 200, etag = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "etag" ? etag || null : null },
    async json() {
      if (status === 304) throw new Error("304 has no canonical payload");
      return body;
    },
  };
}

function fakeTimers() {
  const intervals = [];
  const timeouts = [];
  return {
    intervals,
    timeouts,
    setInterval(callback, ms) {
      const handle = { callback, ms, cleared: false, unref() {} };
      intervals.push(handle);
      return handle;
    },
    clearInterval(handle) { handle.cleared = true; },
    setTimeout(callback, ms) {
      const handle = { callback, ms, cleared: false, unref() {} };
      timeouts.push(handle);
      return handle;
    },
    clearTimeout(handle) { handle.cleared = true; },
    flushTimeout() {
      const handle = timeouts.find((candidate) => !candidate.cleared);
      assert.ok(handle, "expected a scheduled coalescing callback");
      handle.cleared = true;
      handle.callback();
    },
  };
}

test("browser timer wrappers preserve the native receiver", () => {
  const calls = [];
  const target = {
    setInterval(callback, ms) { assert.equal(this, target); calls.push(["setInterval", callback, ms]); return 1; },
    clearInterval(handle) { assert.equal(this, target); calls.push(["clearInterval", handle]); },
    setTimeout(callback, ms) { assert.equal(this, target); calls.push(["setTimeout", callback, ms]); return 2; },
    clearTimeout(handle) { assert.equal(this, target); calls.push(["clearTimeout", handle]); },
  };
  const timers = ovenBrowserTimers(target);
  const callback = () => {};
  assert.equal(timers.setInterval(callback, 30), 1);
  timers.clearInterval(1);
  assert.equal(timers.setTimeout(callback, 25), 2);
  timers.clearTimeout(2);
  assert.deepEqual(calls, [
    ["setInterval", callback, 30],
    ["clearInterval", 1],
    ["setTimeout", callback, 25],
    ["clearTimeout", 2],
  ]);
});

function fakeFocusTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type);
    },
    dispatch(type) { listeners.get(type)?.(); },
    listeners,
  };
}

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
  }

  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type, callback) {
    if (this.listeners.get(type) === callback) this.listeners.delete(type);
  }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  error() { this.onerror?.(); }
  publish(event) {
    this.listeners.get("oven-event")?.({ data: JSON.stringify(event) });
  }
}

function descriptor(overrides = {}) {
  return {
    repoKey: "aaaaaaaaaaaa",
    ovenId: "visual-parity",
    subjectId: "scenario-a",
    query: "repoKey=aaaaaaaaaaaa&scenario=scenario-a",
    url: "/api/oven-data/visual-parity?repoKey=aaaaaaaaaaaa&scenario=scenario-a",
    fallbackError: "Could not load Visual Parity.",
    receive(res, json) {
      if (!res.ok) throw new Error(json.error ?? "Could not load Visual Parity.");
      if (json.validated !== true) throw new Error("Visual Parity data was not validated.");
      return json.payload;
    },
    ...overrides,
  };
}

function publication(overrides = {}) {
  return {
    repoKey: "aaaaaaaaaaaa",
    ovenId: "visual-parity",
    subjectId: "scenario-a",
    kind: "data-published",
    phase: "complete",
    payload: { canonical: false },
    ...overrides,
  };
}

test("one shell EventSource starts from a backlog-free tail and coalesces matching bursts", async () => {
  const baseline = deferred();
  const timers = fakeTimers();
  const focusTarget = fakeFocusTarget();
  const sources = [];
  const snapshotCalls = [];
  const states = [];
  let snapshotRequest = 0;
  const client = createOvenSnapshotClient({
    timers,
    focusTarget,
    eventSourceFactory(url) {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    fetchImpl: async (url, init) => {
      if (url === "/api/events?tail=1") return baseline.promise;
      snapshotCalls.push({ url, init });
      snapshotRequest += 1;
      return snapshotRequest === 1
        ? response({ validated: true, payload: { version: 1 } }, { etag: 'W/"v1"' })
        : response(null, { status: 304, etag: 'W/"v1"' });
    },
  });

  client.start();
  client.start();
  await Promise.resolve();
  assert.equal(sources.length, 0, "the stream cannot attach before its tail baseline");
  baseline.resolve(response({
    cursor: "oev1-backlog-free",
    events: [publication({ payload: { version: 999 } })],
  }));
  await settle();
  assert.equal(sources.length, 1);
  assert.match(sources[0].url, /stream=1&after=oev1-backlog-free/u);
  sources[0].open();

  const subscription = client.subscribe(descriptor(), (state) => states.push(state));
  await settle();
  assert.equal(snapshotCalls.length, 1, "baseline response events never invalidate view state");
  assert.deepEqual(subscription.getState().data, { version: 1 });

  sources[0].publish(publication({ payload: { version: 2_000 } }));
  sources[0].publish(publication({ cursor: "generation-2" }));
  sources[0].publish(publication({ cursor: "generation-3" }));
  assert.equal(snapshotCalls.length, 1);
  assert.equal(timers.timeouts.filter((handle) => !handle.cleared).length, 1);
  timers.flushTimeout();
  await settle();

  assert.equal(snapshotCalls.length, 2);
  assert.deepEqual(snapshotCalls[1].init.headers, { "If-None-Match": 'W/"v1"' });
  assert.deepEqual(subscription.getState().data, { version: 1 }, "event payload never becomes canonical state");
  assert.equal(subscription.getState().outcome, "unchanged");
  assert.equal(states.some((state) => state.data?.version === 2_000), false);
  assert.equal(client.stats().eventSources, 1);
  client.stop();
  assert.equal(sources[0].closed, true);
  assert.equal(focusTarget.listeners.size, 0);
});

test("in-flight invalidations queue one monotonic conditional retry", async () => {
  const timers = fakeTimers();
  const sources = [];
  const first = deferred();
  const second = deferred();
  const snapshotCalls = [];
  const client = createOvenSnapshotClient({
    timers,
    focusTarget: null,
    eventSourceFactory(url) {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    fetchImpl: async (url, init) => {
      if (url === "/api/events?tail=1") return response({ cursor: "oev1-current" });
      snapshotCalls.push(init);
      return snapshotCalls.length === 1 ? first.promise : second.promise;
    },
  });
  client.start();
  await settle();
  sources[0].open();
  const subscription = client.subscribe(descriptor(), () => {});
  await Promise.resolve();
  assert.equal(snapshotCalls.length, 1);

  sources[0].publish(publication());
  sources[0].publish(publication({ cursor: "same-burst" }));
  timers.flushTimeout();
  assert.equal(snapshotCalls.length, 1);
  first.resolve(response({ validated: true, payload: { version: 1 } }, { etag: 'W/"v1"' }));
  await settle();
  assert.equal(snapshotCalls.length, 2, "one queued request follows the active request");
  assert.deepEqual(snapshotCalls[1].headers, { "If-None-Match": 'W/"v1"' });
  second.resolve(response({ validated: true, payload: { version: 2 } }, { etag: 'W/"v2"' }));
  await settle();
  assert.deepEqual(subscription.getState().data, { version: 2 });
  assert.equal(subscription.getState().generation, 2);
  client.stop();
});

test("reconnect, focus, and the one slow timer reconcile while failures retain last good data", async () => {
  const timers = fakeTimers();
  const focusTarget = fakeFocusTarget();
  const sources = [];
  const snapshotResponses = [
    response({ validated: true, payload: { version: 1 } }, { etag: 'W/"v1"' }),
    new Error("temporary disconnect"),
    response({ validated: true, payload: { version: 2 } }, { etag: 'W/"v2"' }),
    response(null, { status: 304, etag: 'W/"v2"' }),
    response(null, { status: 304, etag: 'W/"v2"' }),
  ];
  const calls = [];
  let currentTime = 0;
  const client = createOvenSnapshotClient({
    timers,
    focusTarget,
    now: () => currentTime,
    eventSourceFactory(url) {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    fetchImpl: async (url, init) => {
      if (url === "/api/events?tail=1") return response({ cursor: "oev1-current" });
      calls.push(init);
      const next = snapshotResponses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  client.start();
  await settle();
  sources[0].open();
  const subscription = client.subscribe(descriptor(), () => {});
  await settle();
  assert.deepEqual(subscription.getState().data, { version: 1 });

  sources[0].publish(publication());
  timers.flushTimeout();
  await settle();
  assert.equal(subscription.getState().error, "temporary disconnect");
  assert.deepEqual(subscription.getState().data, { version: 1 });

  currentTime = 30_000;
  timers.intervals[0].callback();
  timers.flushTimeout();
  await settle();
  assert.deepEqual(subscription.getState().data, { version: 2 });
  sources[0].open();
  assert.equal(timers.timeouts.filter((handle) => !handle.cleared).length, 0,
    "stream replay owns reconnect; a recent canonical request is not duplicated");
  focusTarget.dispatch("focus");
  timers.flushTimeout();
  await settle();
  currentTime = 60_000;
  timers.intervals[0].callback();
  timers.flushTimeout();
  await settle();
  assert.equal(calls.length, 5);
  assert.equal(sources.length, 1, "native reconnect reuses the shell EventSource");
  assert.equal(subscription.getState().error, "");
  client.stop();
});

test("a late response from a stopped lifecycle cannot replace a newer generation", async () => {
  const timers = fakeTimers();
  const sources = [];
  const first = deferred();
  const second = deferred();
  let snapshotRequest = 0;
  const client = createOvenSnapshotClient({
    timers,
    focusTarget: null,
    eventSourceFactory(url) {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    fetchImpl: async (url) => {
      if (url === "/api/events?tail=1") return response({ cursor: `oev1-${sources.length}` });
      snapshotRequest += 1;
      return snapshotRequest === 1 ? first.promise : second.promise;
    },
  });
  client.start();
  await settle();
  sources[0].open();
  const subscription = client.subscribe(descriptor(), () => {});
  await Promise.resolve();
  client.stop();

  client.start();
  await settle();
  sources[1].open();
  timers.flushTimeout();
  await Promise.resolve();
  second.resolve(response({ validated: true, payload: { version: 2 } }, { etag: 'W/"v2"' }));
  await settle();
  first.resolve(response({ validated: true, payload: { version: 1 } }, { etag: 'W/"v1"' }));
  await settle();

  assert.deepEqual(subscription.getState().data, { version: 2 });
  assert.equal(subscription.getState().generation, 2);
  client.stop();
});

test("snapshot keys include repository, subject, and normalized query", () => {
  const first = ovenSnapshotKey({ repoKey: "a", ovenId: "sample", subjectId: "one", query: "b=2&a=1" });
  const reordered = ovenSnapshotKey({ repoKey: "a", ovenId: "sample", subjectId: "one", query: "a=1&b=2" });
  const otherSubject = ovenSnapshotKey({ repoKey: "a", ovenId: "sample", subjectId: "two", query: "a=1&b=2" });
  assert.equal(first, reordered);
  assert.notEqual(first, otherSubject);
});
