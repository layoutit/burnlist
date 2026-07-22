import assert from "node:assert/strict";
import test from "node:test";
import { createOvenSnapshotClient } from "./oven-event-client.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function response(body, { status = 200, etag = "", bytes } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === "etag") return etag || null;
        if (name.toLowerCase() === "content-length") return bytes === undefined ? null : String(bytes);
        return null;
      },
    },
    async json() { return body; },
  };
}

function timers() {
  return {
    setInterval() { return { unref() {} }; },
    clearInterval() {},
    setTimeout(callback) { return { callback, unref() {} }; },
    clearTimeout() {},
  };
}

function isEventBaseline(url) {
  return new URL(url, "http://burnlist.test").searchParams.get("tail") === "1";
}

function descriptor(index = 0) {
  return {
    repoKey: "repo-a",
    ovenId: "visual-parity",
    subjectId: `scenario-${index}`,
    query: `scenario=scenario-${index}`,
    url: `/api/oven-data/visual-parity?scenario=scenario-${index}`,
    fallbackError: "Could not load Visual Parity.",
    receive(res, json) {
      if (!res.ok) throw new Error(json?.error ?? "Could not load Visual Parity.");
      return json.payload;
    },
  };
}

function clientWith(fetchSnapshot, options = {}) {
  return createOvenSnapshotClient({
    timers: timers(),
    focusTarget: null,
    eventSourceFactory: () => ({ addEventListener() {}, close() {} }),
    fetchImpl(url, init) {
      if (isEventBaseline(url)) return Promise.resolve(response({ cursor: "oev1-current" }));
      return fetchSnapshot(url, init);
    },
    ...options,
  });
}

test("query churn retains only the newest bounded inactive snapshots", async () => {
  const client = clientWith(async (url) => response({ payload: { url } }, { bytes: 4 }), {
    maxInactiveEntries: 2,
    maxInactiveBytes: 1_000,
  });
  for (let index = 0; index < 8; index += 1) {
    const subscription = client.subscribe(descriptor(index), () => {});
    await settle();
    subscription.unsubscribe();
  }
  assert.deepEqual(client.stats(), {
    started: true,
    eventSources: 0,
    queries: 2,
    inactiveQueries: 2,
    inactiveBytes: 8,
    maxInactiveEntries: 2,
    maxInactiveBytes: 1_000,
    activeQueries: 0,
    inFlight: 0,
    pending: 0,
    observerError: "",
  });
  client.stop();
});

test("inactive snapshots also obey the byte budget", async () => {
  const client = clientWith(async (url) => response({ payload: { url } }), {
    maxInactiveEntries: 10,
    maxInactiveBytes: 5,
    estimateBytes: () => 4,
  });
  for (let index = 0; index < 3; index += 1) {
    const subscription = client.subscribe(descriptor(index), () => {});
    await settle();
    subscription.unsubscribe();
  }
  assert.equal(client.stats().queries, 1);
  assert.equal(client.stats().inactiveQueries, 1);
  assert.equal(client.stats().inactiveBytes, 4);
  client.stop();
});

test("active snapshots are never evicted by inactive cache limits", async () => {
  const client = clientWith(async (url) => response({ payload: { url } }), {
    maxInactiveEntries: 0,
    maxInactiveBytes: 0,
  });
  const first = client.subscribe(descriptor(1), () => {});
  const second = client.subscribe(descriptor(2), () => {});
  await settle();
  assert.equal(client.stats().activeQueries, 2);
  second.unsubscribe();
  assert.equal(client.stats().queries, 1);
  assert.equal(client.stats().activeQueries, 1);
  assert.match(first.getState().data.url, /scenario-1/u);
  first.unsubscribe();
  assert.equal(client.stats().queries, 0);
  client.stop();
});

test("unsubscribing the final listener aborts and removes an inactive request", async () => {
  let signal;
  const client = clientWith((_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  }, { maxInactiveEntries: 0, maxInactiveBytes: 0 });
  const subscription = client.subscribe(descriptor(), () => {});
  await settle();
  assert.equal(client.stats().inFlight, 1);
  subscription.unsubscribe();
  assert.equal(signal.aborted, true);
  assert.equal(client.stats().queries, 0);
  assert.equal(client.stats().inFlight, 0);
  client.stop();
});

test("transient failure marks retained data stale while canonical missing clears it", async () => {
  const snapshots = [
    response({ payload: { version: 1 } }, { etag: 'W/"v1"' }),
    new Error("offline"),
    response({ error: "Oven is unbound." }, { status: 404 }),
  ];
  const client = clientWith(async () => {
    const next = snapshots.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const subscription = client.subscribe(descriptor(), () => {});
  await settle();
  subscription.refresh();
  await settle();
  assert.deepEqual(subscription.getState(), {
    key: subscription.key,
    data: { version: 1 },
    error: "offline",
    loading: false,
    stale: true,
    generation: 2,
    outcome: "rejected",
  });
  subscription.refresh();
  await settle();
  assert.deepEqual(subscription.getState(), {
    key: subscription.key,
    data: null,
    error: "Oven is unbound.",
    loading: false,
    stale: false,
    generation: 3,
    outcome: "missing",
  });
  subscription.unsubscribe();
  client.stop();
});

test("a remount reuses retained data and conditionally reconciles it", async () => {
  const calls = [];
  const client = clientWith(async (_url, init) => {
    calls.push(init);
    return calls.length === 1
      ? response({ payload: { version: 1 } }, { etag: 'W/"v1"' })
      : response(null, { status: 304, etag: 'W/"v1"' });
  });
  const first = client.subscribe(descriptor(), () => {});
  await settle();
  first.unsubscribe();
  const seen = [];
  const second = client.subscribe(descriptor(), (state) => seen.push(state));
  await settle();
  assert.equal(seen[0].data.version, 1);
  assert.deepEqual(calls[1].headers, { "If-None-Match": 'W/"v1"' });
  assert.equal(second.getState().outcome, "unchanged");
  assert.equal(second.getState().stale, false);
  assert.deepEqual(second.getState().data, { version: 1 });
  second.unsubscribe();
  client.stop();
});
