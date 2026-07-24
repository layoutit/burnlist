import assert from "node:assert/strict";
import test from "node:test";
import { createOvenSnapshotClient } from "../lib/oven-event-client.mjs";
import { dashboardLoopProjectionSnapshotConfig, dashboardProgressSnapshotConfig, dashboardProjectsSnapshotConfig } from "./dashboard-data.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function response(body, status = 200, etag = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "etag" ? etag : null },
    async json() { return body; },
  };
}

function isEventBaseline(url) {
  return new URL(url, "http://burnlist.test").searchParams.get("tail") === "1";
}

function fakeTimers() {
  const intervals = [], timeouts = [];
  return {
    intervals,
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
    flush() {
      const handle = timeouts.find((candidate) => !candidate.cleared);
      assert.ok(handle, "expected a coalesced refresh");
      handle.cleared = true;
      handle.callback();
    },
  };
}

class FakeEventSource {
  constructor(url) { this.url = url; this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  close() {}
  open() { this.onopen?.(); }
  publish(event) { this.listeners.get("oven-event")?.({ data: JSON.stringify(event) }); }
  reset(event) { this.listeners.get("oven-reset")?.({ data: JSON.stringify(event) }); }
}

function descriptor(config) {
  return { ...config, url: config.makeUrl() };
}

test("landing projections share matching invalidations and the manual-write fallback", async () => {
  const timers = fakeTimers();
  const sources = [];
  const calls = [];
  let now = 0;
  const client = createOvenSnapshotClient({
    timers,
    now: () => now,
    focusTarget: null,
    eventSourceFactory(url) {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    async fetchImpl(url) {
      if (isEventBaseline(url)) return response({ cursor: "oev1-dashboard" });
      calls.push(url);
      return url === "/api/projects"
        ? response({ projects: [{ version: calls.length }] })
        : response({ version: calls.length });
    },
  });
  client.start();

  const selected = { repoKey: "aaaaaaaaaaaa", id: "260722-001" };
  let projects, progress;
  client.subscribe(descriptor(dashboardProjectsSnapshotConfig(true)), (state) => { projects = state; });
  client.subscribe(descriptor(dashboardProgressSnapshotConfig(true, selected)), (state) => { progress = state; });
  await settle();
  sources.at(-1).open();
  const eventQuery = new URL(sources[0].url, "http://burnlist.test").searchParams;
  assert.equal(eventQuery.get("stream"), "1");
  assert.equal(eventQuery.get("tail"), "1");
  assert.deepEqual(eventQuery.getAll("ovenId"), [], "wildcard invalidation does not collapse to checklist");
  assert.deepEqual(calls, ["/api/projects", "/api/progress?repoKey=aaaaaaaaaaaa&id=260722-001"]);
  timers.flush();
  await settle();
  assert.equal(calls.filter((url) => url === "/api/projects").length, 2,
    "opening a non-replay wildcard tail closes the baseline race");
  assert.equal(calls.filter((url) => url.startsWith("/api/progress")).length, 2);

  sources[0].publish({
    repoKey: selected.repoKey, ovenId: "visual-parity", subjectId: "all",
    kind: "data-published", phase: "complete",
  });
  timers.flush();
  await settle();
  assert.equal(calls.filter((url) => url === "/api/projects").length, 3);
  assert.equal(calls.filter((url) => url.startsWith("/api/progress")).length, 2);

  sources[0].reset({
    repoKey: selected.repoKey, ovenId: "model-lab", reason: "retention-gap",
  });
  timers.flush();
  await settle();
  assert.equal(calls.filter((url) => url === "/api/projects").length, 4,
    "a non-checklist reset immediately invalidates the wildcard projection");
  assert.equal(calls.filter((url) => url.startsWith("/api/progress")).length, 2);

  sources[0].publish({
    repoKey: selected.repoKey, ovenId: "checklist", subjectId: selected.id,
    kind: "item-burned", phase: "completed",
  });
  timers.flush();
  await settle();
  assert.equal(calls.filter((url) => url === "/api/projects").length, 5);
  assert.equal(calls.filter((url) => url.startsWith("/api/progress")).length, 3);

  now = 30_000;
  timers.intervals[0].callback();
  timers.flush();
  await settle();
  assert.equal(calls.length, 10);
  assert.equal(projects.error, "");
  assert.equal(progress.error, "");
  assert.equal(sources.length, 1);
  client.stop();
});

test("loop projection uses its dedicated snapshot URL and coalesces conditional event/reset refreshes", async () => {
  const timers = fakeTimers(), sources = [], calls = [], states = [];
  const selected = { repoKey: "aaaaaaaaaaaa", id: "260722-001", item: "M7" };
  const config = dashboardLoopProjectionSnapshotConfig(true, selected);
  assert.equal(config.makeUrl(), "/api/loop-projection?repoKey=aaaaaaaaaaaa&id=260722-001&item=M7");
  assert.equal(config.subjectId, "item:260722-001#M7");
  assert.deepEqual(config.events, [{ ovenId: "checklist", kind: "loop-projection-changed", phase: "complete" }]);
  const client = createOvenSnapshotClient({
    timers, focusTarget: null,
    eventSourceFactory(url) { const source = new FakeEventSource(url); sources.push(source); return source; },
    async fetchImpl(url, options = {}) {
      if (isEventBaseline(url)) return response({ cursor: "oev1-loop" });
      calls.push({ url, headers: options.headers ?? null });
      return calls.length === 1 ? response({ loopRun: { revision: "sha256:first" } }, 200, '"loop-v1"') : response(null, 304, '"loop-v1"');
    },
  });
  client.start();
  client.subscribe(descriptor(config), (state) => states.push(state));
  await settle();
  assert.deepEqual(calls, [{ url: config.makeUrl(), headers: null }]);

  const changed = { repoKey: selected.repoKey, ovenId: "checklist", subjectId: "item:260722-001#M7", kind: "loop-projection-changed", phase: "complete" };
  sources[0].publish(changed);
  sources[0].publish(changed);
  timers.flush();
  await settle();
  assert.equal(calls.length, 2, "two invalidations share one refetch");
  assert.deepEqual(calls[1].headers, { "If-None-Match": '"loop-v1"' });
  assert.equal(states.at(-1).outcome, "unchanged", "304 retains the canonical loop snapshot");

  sources[0].reset({ repoKey: selected.repoKey, ovenId: "checklist", reason: "retention-gap" });
  timers.flush();
  await settle();
  assert.equal(calls.length, 3, "a matching retention gap resets the loop snapshot");
  assert.deepEqual(calls[2].headers, { "If-None-Match": '"loop-v1"' });
  client.stop();
});

test("a corrupt dedicated Loop projection retains the last good snapshot", async () => {
  const timers = fakeTimers(), sources = [], states = [];
  const selected = { repoKey: "aaaaaaaaaaaa", id: "260722-001" };
  const config = dashboardLoopProjectionSnapshotConfig(true, selected);
  let requests = 0;
  const client = createOvenSnapshotClient({
    timers, focusTarget: null,
    eventSourceFactory(url) { const source = new FakeEventSource(url); sources.push(source); return source; },
    async fetchImpl(url) {
      if (isEventBaseline(url)) return response({ cursor: "oev1-corrupt" });
      requests += 1;
      return requests === 1
        ? response({ loopRun: { revision: "sha256:verified" } }, 200, '"loop-v1"')
        : response({ error: "Loop projection is unavailable; retaining the last verified projection." }, 409);
    },
  });
  client.start();
  client.subscribe(descriptor(config), (state) => states.push(state));
  await settle();
  sources[0].publish({ repoKey: selected.repoKey, ovenId: "checklist", subjectId: "item:260722-001#M7", kind: "loop-projection-changed", phase: "complete" });
  timers.flush();
  await settle();
  const state = states.at(-1);
  assert.equal(state.outcome, "rejected");
  assert.deepEqual(state.data, { revision: "sha256:verified" });
  assert.equal(state.error, "Loop projection is unavailable; retaining the last verified projection.");
  assert.equal(state.stale, true);
  client.stop();
});
