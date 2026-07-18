import assert from "node:assert/strict";
import test from "node:test";
import { applyStreamingDiffUpdate, parseStreamingDiffCard } from "../../lib/streaming-diff.mjs";
import { createPollTransport, createSseTransport } from "./transports.js";

const waitForAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

function visualParityReceive(response, json) {
  if (!response.ok) throw new Error(json.error ?? "Could not load Visual Parity.");
  if (json.validated !== true) throw new Error("Visual Parity data was not validated by the Oven.");
  return json.payload;
}

function startPoll({ fetchImpl, receive = visualParityReceive, events = [], setIntervalImpl, clearIntervalImpl } = {}) {
  let intervalCallback;
  const transport = createPollTransport({
    makeUrl: () => "/api/oven-data/visual-parity",
    intervalMs: 2_000,
    receive,
    fallbackError: "Could not load Visual Parity.",
    fetchImpl,
    setIntervalImpl: setIntervalImpl ?? ((callback) => {
      intervalCallback = callback;
      return "timer";
    }),
    clearIntervalImpl: clearIntervalImpl ?? (() => {}),
  });
  const stop = transport.start({
    onData: (data) => events.push(["data", data]),
    onError: (error) => events.push(["error", error]),
    onSettled: () => events.push(["settled"]),
  });
  return { stop, get intervalCallback() { return intervalCallback; } };
}

test("poll uses the configured URL, cache mode, and interval", async () => {
  const fetchCalls = [];
  let intervalArgs;
  const { stop } = startPoll({
    fetchImpl: async (...args) => {
      fetchCalls.push(args);
      return { ok: true, json: () => ({ validated: true, payload: {} }) };
    },
    setIntervalImpl: (...args) => {
      intervalArgs = args;
      return "timer";
    },
  });

  await waitForAsyncWork();
  assert.equal(typeof intervalArgs[0], "function");
  assert.equal(intervalArgs[1], 2_000);
  assert.deepEqual(fetchCalls, [["/api/oven-data/visual-parity", { cache: "no-store" }]]);
  stop();
});

test("poll success delivers data before settled", async () => {
  const events = [];
  const { stop } = startPoll({
    events,
    fetchImpl: async () => ({ ok: true, json: () => ({ validated: true, payload: { x: 1 } }) }),
  });

  await waitForAsyncWork();
  stop();
  assert.deepEqual(events, [["data", { x: 1 }], ["settled"]]);
});

test("poll skips an interval refresh while the first request is in flight", async () => {
  let resolveFetch;
  let fetchCalls = 0;
  const { stop, intervalCallback } = startPoll({
    fetchImpl: () => {
      fetchCalls += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });

  await Promise.resolve();
  assert.equal(fetchCalls, 1);
  await intervalCallback();
  assert.equal(fetchCalls, 1);
  resolveFetch({ ok: true, json: () => ({ validated: true, payload: {} }) });
  await waitForAsyncWork();
  stop();
});

test("poll replay shares the in-flight guard", async () => {
  let resolveFetch;
  let fetchCalls = 0;
  const inFlightRef = { current: false };
  const fetchImpl = () => {
    fetchCalls += 1;
    return new Promise((resolve) => { resolveFetch = resolve; });
  };
  const config = {
    makeUrl: () => "/api/oven-data/visual-parity",
    intervalMs: 2_000,
    receive: visualParityReceive,
    fallbackError: "Could not load Visual Parity.",
    inFlightRef,
    fetchImpl,
    setIntervalImpl: () => "timer",
    clearIntervalImpl: () => {},
  };
  const events = [];
  const events2 = [];
  const stop = createPollTransport(config).start({
    onData: (data) => events.push(["data", data]),
    onError: (error) => events.push(["error", error]),
    onSettled: () => events.push(["settled"]),
  });
  const stop2 = createPollTransport(config).start({
    onData: (data) => events2.push(["data", data]),
    onError: (error) => events2.push(["error", error]),
    onSettled: () => events2.push(["settled"]),
  });

  assert.equal(fetchCalls, 1);
  resolveFetch({ ok: true, json: () => ({ validated: true, payload: { replay: "done" } }) });
  await waitForAsyncWork();
  assert.deepEqual(events, [["data", { replay: "done" }], ["settled"]]);
  assert.deepEqual(events2, []);
  stop2();
  stop();
});

test("poll validated gate reports its exact error", async () => {
  const events = [];
  const { stop } = startPoll({
    events,
    fetchImpl: async () => ({ ok: true, json: () => ({ validated: false, payload: {} }) }),
  });

  await waitForAsyncWork();
  stop();
  assert.deepEqual(events, [["error", "Visual Parity data was not validated by the Oven."], ["settled"]]);
});

test("poll not-ok response reports the server error", async () => {
  const events = [];
  const { stop } = startPoll({
    events,
    fetchImpl: async () => ({ ok: false, json: () => ({ error: "boom" }) }),
  });

  await waitForAsyncWork();
  stop();
  assert.deepEqual(events, [["error", "boom"], ["settled"]]);
});

test("poll not-ok response uses the fallback when no error is supplied", async () => {
  const events = [];
  const { stop } = startPoll({
    events,
    fetchImpl: async () => ({ ok: false, json: () => ({}) }),
  });

  await waitForAsyncWork();
  stop();
  assert.deepEqual(events, [["error", "Could not load Visual Parity."], ["settled"]]);
});

test("poll stop suppresses late state writes and clears the timer", async () => {
  let resolveFetch;
  let clearedTimer;
  const events = [];
  const { stop } = startPoll({
    events,
    fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
    clearIntervalImpl: (timer) => { clearedTimer = timer; },
  });

  stop();
  resolveFetch({ ok: true, json: () => ({ validated: true, payload: { late: true } }) });
  await waitForAsyncWork();
  assert.equal(clearedTimer, "timer");
  assert.deepEqual(events, []);
});

test("stream card message validation rejects invalid data and applies valid data", () => {
  const applyMessage = (cards, raw) => {
    const card = parseStreamingDiffCard(JSON.parse(raw));
    if (!card) throw new Error("invalid card");
    return applyStreamingDiffUpdate(cards, { type: "card", card });
  };
  const card = {
    revId: "revision-1",
    toolUseId: "tool-1",
    ts: "2026-07-15T09:00:00.000Z",
    status: "captured",
    files: [{ path: "src/example.mjs", kind: "modified", diff: "+after" }],
  };

  assert.throws(() => applyMessage([], "{}"), /invalid card/u);
  assert.deepEqual(applyMessage([], JSON.stringify(card)), [card]);
});

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    this.removed = [type, listener];
    this.listeners.delete(type);
  }

  close() {
    this.closed = true;
  }

  dispatch(type) {
    this.listeners.get(type)?.();
  }

  dispatchMessage(data) {
    this.onmessage?.({ data });
  }
}

test("sse forwards events and cleanup removes reset listener and closes stream", () => {
  const calls = [];
  const stop = createSseTransport({
    makeUrl: () => "/stream",
    EventSourceImpl: FakeEventSource,
  }).start({
    onReset: () => calls.push("reset"),
    onOpen: () => calls.push("open"),
    onMessage: (raw) => calls.push(["message", raw]),
    onError: () => calls.push("error"),
  });
  const stream = FakeEventSource.instances.at(-1);

  stream.onopen();
  stream.dispatch("reset");
  stream.dispatchMessage('{"id":"card-1"}');
  stream.onerror();
  stop();

  assert.equal(stream.url, "/stream");
  assert.deepEqual(calls, ["open", "reset", ["message", '{"id":"card-1"}'], "error"]);
  assert.equal(stream.removed[0], "reset");
  assert.equal(typeof stream.removed[1], "function");
  assert.equal(stream.closed, true);
});
