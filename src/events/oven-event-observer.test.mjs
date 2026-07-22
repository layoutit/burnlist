import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readOvenEventDeliveries } from "./oven-event-feed.mjs";
import { createOvenEventObserver } from "./oven-event-observer.mjs";
import { publishOvenEvent } from "./oven-event-store.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-event-observer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repoKey: "aaaaaaaaaaaa", name: "fixture" };
}

function event(cursor, sequenceMinute = 0, ovenId = "future-oven") {
  return {
    ovenId,
    subjectId: "subject-1",
    kind: "iteration",
    phase: "complete",
    cursor,
    occurredAt: `2026-07-21T12:${String(sequenceMinute).padStart(2, "0")}:00.000Z`,
    payload: {},
  };
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

function selection(repo, watermarks = {}, ovenIds = []) {
  return { repos: [repo], ovenIds, watermarks, limit: 256 };
}

test("multiple subscribers share one filesystem scan per observer tick", (t) => {
  const repo = fixture(t);
  publishOvenEvent(repo.root, event("existing"));
  const timers = fakeTimers();
  let reads = 0;
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readDeliveries(...args) { reads += 1; return readOvenEventDeliveries(...args); },
    timers,
  });
  const baseline = observer.baseline(selection(repo)).watermarks;
  const first = [];
  const second = [];
  const one = observer.subscribe(selection(repo, baseline), {
    onDelivery(item) { first.push(item.cursor); },
  });
  const two = observer.subscribe(selection(repo, baseline), {
    onDelivery(item) { second.push(item.cursor); },
  });
  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.equal(timers.handles.length, 1);

  reads = 0;
  publishOvenEvent(repo.root, event("shared-live", 1));
  timers.handles[0].callback();
  assert.equal(reads, 1);
  assert.deepEqual(first, ["shared-live"]);
  assert.deepEqual(second, ["shared-live"]);

  one.unsubscribe();
  assert.equal(timers.handles[0].cleared, false);
  two.unsubscribe();
  assert.equal(timers.handles[0].cleared, true);
  assert.equal(observer.stats().subscribers, 0);
});

test("tail baseline skips backlog without losing a publish before live attachment", (t) => {
  const repo = fixture(t);
  publishOvenEvent(repo.root, event("backlog"));
  const timers = fakeTimers();
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readDeliveries: readOvenEventDeliveries,
    timers,
  });
  const baseline = observer.baseline(selection(repo)).watermarks;
  publishOvenEvent(repo.root, event("between-baseline-and-attach", 1));
  const received = [];
  const subscription = observer.subscribe(selection(repo, baseline), {
    onDelivery(item) { received.push(item.cursor); },
  });

  assert.deepEqual(received, ["between-baseline-and-attach"]);
  timers.handles[0].callback();
  assert.deepEqual(received, ["between-baseline-and-attach"]);
  subscription.unsubscribe();
});

test("replay-to-live attachment delivers each identity once across a scan race", (t) => {
  const repo = fixture(t);
  publishOvenEvent(repo.root, event("replay"));
  const timers = fakeTimers();
  let injected = false;
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readDeliveries(...args) {
      const batch = readOvenEventDeliveries(...args);
      if (!injected) {
        injected = true;
        publishOvenEvent(repo.root, event("raced-live", 1));
      }
      return batch;
    },
    timers,
  });
  const received = [];
  const subscription = observer.subscribe(selection(repo), {
    onDelivery(item) { received.push(item.deliveryId); },
  });
  timers.handles[0].callback();
  timers.handles[0].callback();

  assert.equal(received.length, 2);
  assert.equal(new Set(received).size, 2);
  subscription.unsubscribe();
});

test("one corrupt Oven tail does not hide a valid neighboring stream", (t) => {
  const repo = fixture(t);
  publishOvenEvent(repo.root, event("corrupt", 0, "other-oven"));
  publishOvenEvent(repo.root, event("valid", 1));
  writeFileSync(join(
    repo.root,
    ".local",
    "burnlist",
    "events",
    "other-oven",
    "sequence",
    "000000000001.idx",
  ), "corrupt\n");
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readDeliveries: readOvenEventDeliveries,
    timers: fakeTimers(),
  });
  const received = [];
  const warnings = [];
  const subscription = observer.subscribe(selection(repo), {
    onDelivery(item) { received.push(item.cursor); },
    onWarning(item) { warnings.push(item); },
  });

  assert.deepEqual(received, ["valid"]);
  assert.equal(warnings.some((item) => item.repoKey === repo.repoKey), true);
  subscription.unsubscribe();
});

test("filters, corrupt-tail warnings, and slow subscribers stay isolated", () => {
  const repo = { root: "/unused", repoKey: "aaaaaaaaaaaa", name: "fixture" };
  const timers = fakeTimers();
  let scan = 0;
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readTail: () => ({
      watermarks: { "aaaaaaaaaaaa/future-oven": 0, "aaaaaaaaaaaa/other-oven": 0 },
      warnings: [],
      streamKeys: ["aaaaaaaaaaaa/future-oven", "aaaaaaaaaaaa/other-oven"],
    }),
    readDeliveries: () => {
      scan += 1;
      return scan === 1
        ? { deliveries: [], warnings: [], streamKeys: [] }
        : {
          deliveries: [{
            repoKey: repo.repoKey, repo: repo.name, ovenId: "future-oven", sequence: 1,
            deliveryId: "delivery-1", cursor: "live", eventId: "event-1",
          }],
          warnings: [{ repoKey: repo.repoKey, code: "ECORRUPT", error: "other tail is corrupt" }],
          streamKeys: [],
        };
    },
    timers,
  });
  const slow = [];
  const healthy = [];
  observer.subscribe(selection(repo, {}, ["future-oven"]), {
    onDelivery() { slow.push("delivery"); return false; },
  });
  const healthySubscription = observer.subscribe(selection(repo, {}, ["future-oven"]), {
    onDelivery(item) { healthy.push(item.cursor); },
  });

  assert.deepEqual(slow, ["delivery"]);
  assert.deepEqual(healthy, ["live"]);
  assert.equal(observer.stats().subscribers, 1);
  assert.equal(observer.stats().watermarks["aaaaaaaaaaaa/other-oven"], 0);
  healthySubscription.unsubscribe();
  assert.equal(timers.handles[0].cleared, true);
});

test("the internal observer discovers and invalidates streams after the public 64-stream boundary", (t) => {
  const repo = fixture(t);
  const eventsRoot = join(repo.root, ".local", "burnlist", "events");
  for (let index = 0; index < 65; index += 1) {
    mkdirSync(join(eventsRoot, `oven-${index}`, "sequence"), { recursive: true });
  }
  const timers = fakeTimers();
  const observer = createOvenEventObserver({ resolveRepos: () => [repo], timers });
  observer.prepare();
  assert.equal(Object.keys(observer.stats().watermarks).length, 65);
  assert.throws(() => readOvenEventDeliveries([repo]), (error) => error.status === 413);

  const received = [];
  const stop = observer.observe({ onDelivery(item) { received.push(item.cursor); } });
  publishOvenEvent(repo.root, event("after-public-boundary", 1, "oven-64"));
  timers.handles[0].callback();
  assert.deepEqual(received, ["after-public-boundary"]);
  stop();
});

test("stale subscriber catch-up cannot delay the independent live invalidation tail", () => {
  const repo = { root: "/unused", repoKey: "aaaaaaaaaaaa", name: "fixture" };
  const timers = fakeTimers();
  const liveKey = `${repo.repoKey}/live-oven`;
  const staleKey = `${repo.repoKey}/stale-oven`;
  const live = [];
  const replay = [];
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readLiveTail: () => ({
      watermarks: { [liveKey]: 0, [staleKey]: 100 }, warnings: [], streamKeys: [liveKey, staleKey], complete: true,
    }),
    readLiveDeliveries: () => ({
      deliveries: [{
        repoKey: repo.repoKey, ovenId: "live-oven", sequence: 1, cursor: "live-now", occurredAt: "2026-07-21T12:00:00.000Z",
      }],
      warnings: [], resets: [], streamKeys: [liveKey, staleKey], startWatermarks: {}, complete: true,
    }),
    readSubscriberDeliveries: () => ({
      deliveries: [{
        repoKey: repo.repoKey, ovenId: "stale-oven", sequence: 1, cursor: "old-replay", occurredAt: "2026-07-21T11:00:00.000Z",
      }],
      warnings: [], resets: [], streamKeys: [liveKey, staleKey], startWatermarks: {}, complete: true,
    }),
    timers,
  });
  const stop = observer.observe({ onDelivery(item) { live.push(item.cursor); } });
  const subscription = observer.subscribe(selection(repo, { [staleKey]: 0 }, ["stale-oven"]), {
    onDelivery(item) { replay.push(item.cursor); },
  });
  assert.deepEqual(live, ["live-now"]);
  assert.deepEqual(replay, ["old-replay"]);
  subscription.unsubscribe();
  stop();
});

test("regressed and missing streams emit resets and prune observer watermarks", () => {
  const repo = { root: "/unused", repoKey: "aaaaaaaaaaaa", name: "fixture" };
  const key = `${repo.repoKey}/future-oven`;
  let scans = 0;
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    readLiveTail: () => ({ watermarks: { [key]: 5 }, warnings: [], streamKeys: [key], complete: true }),
    readLiveDeliveries: () => {
      scans += 1;
      return scans === 1 ? {
        deliveries: [], warnings: [], streamKeys: [key], startWatermarks: { [key]: 0 }, complete: true,
        resets: [{
          repoKey: repo.repoKey, ovenId: "future-oven", code: "EREPLAYRESET", reason: "stream-regressed",
          requestedSequence: 5, baseSequence: 1, committedSequence: 0,
        }],
      } : { deliveries: [], warnings: [], resets: [], streamKeys: [], startWatermarks: {}, complete: true };
    },
    timers: fakeTimers(),
  });
  const resets = [];
  const stop = observer.observe({ onReset(item) { resets.push(item.reason); } });
  observer.scan();
  assert.equal(observer.stats().watermarks[key], 0);
  observer.scan();
  assert.equal(Object.hasOwn(observer.stats().watermarks, key), false);
  assert.deepEqual(resets, ["stream-regressed", "stream-missing"]);
  stop();
});
