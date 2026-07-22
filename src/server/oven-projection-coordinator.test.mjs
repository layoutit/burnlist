import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOvenJsonSnapshotStore } from "./oven-json-snapshot.mjs";
import { createOvenProjectionCoordinator } from "./oven-projection-coordinator.mjs";

function fakeObserver() {
  let callbacks = null;
  let stopped = false;
  return {
    observe(next) {
      callbacks = next;
      return () => { stopped = true; };
    },
    callbacks: () => callbacks,
    stopped: () => stopped,
  };
}

function fakeTimers() {
  const intervals = new Map();
  let nextId = 1;
  return {
    setInterval(callback, intervalMs) {
      const handle = { id: nextId, unref() {} };
      nextId += 1;
      intervals.set(handle, { callback, intervalMs });
      return handle;
    },
    clearInterval(handle) { intervals.delete(handle); },
    intervals,
  };
}

test("published-event bursts only invalidate matching canonical projections", () => {
  const observer = fakeObserver();
  const timers = fakeTimers();
  const binding = { path: "/repo/visual.json", repoKey: "abc123abc123", repoRoot: "/repo" };
  const bindings = new Map([["visual-parity", [binding]]]);
  const invalidations = [];
  const cache = new Map([["stale", true]]);
  let dashboardCalls = 0;
  const handler = {
    id: "visual-parity",
    dashboardEntries() { dashboardCalls += 1; return []; },
  };
  const coordinator = createOvenProjectionCoordinator({
    observer,
    snapshotStore: {
      invalidate(path, scope) { invalidations.push({ path, scope }); },
      reconcile() {},
    },
    handlers: [handler],
    resolveBindings: () => bindings,
    createContext: () => ({ cache, ovenDataBindings: bindings }),
    timers,
  });

  assert.equal(cache.size, 1, "startup does not eagerly read canonical data");
  assert.equal(timers.intervals.size, 1, "all handlers share one slow reconciliation timer");
  const delivery = {
    ovenId: "visual-parity",
    repoKey: binding.repoKey,
    kind: "data-published",
    phase: "complete",
  };
  observer.callbacks().onDelivery(delivery);
  observer.callbacks().onDelivery({ ...delivery, cursor: "next" });
  observer.callbacks().onDelivery({ ...delivery, kind: "iteration" });
  assert.deepEqual(invalidations, [], "the observer scan is the coalescing boundary");

  observer.callbacks().onScanComplete();
  assert.deepEqual(invalidations, [{ path: binding.path, scope: "visual-parity" }]);
  assert.equal(cache.size, 0);
  assert.equal(dashboardCalls, 0, "events never manufacture project rows or eagerly reopen data");

  observer.callbacks().onDelivery({ ...delivery, repoKey: "def456def456" });
  observer.callbacks().onScanComplete();
  assert.equal(invalidations.length, 1, "unbound repository events are ignored");
  coordinator.stop();
  assert.equal(observer.stopped(), true);
  assert.equal(timers.intervals.size, 0);
});

test("one slow reconciliation invalidates a canonical file changed without an event", (t) => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-projection-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "visual.json");
  writeFileSync(path, JSON.stringify({ version: 1 }));
  const snapshots = createOvenJsonSnapshotStore();
  snapshots.read({
    path,
    scope: "visual-parity",
    label: "visual fixture",
    maxSourceBytes: 1_024,
    validate() {},
  });
  assert.equal(snapshots.stats().entries, 1);
  const observer = fakeObserver();
  const timers = fakeTimers();
  const bindings = new Map([["visual-parity", [{ path, repoKey: "abc123abc123", repoRoot: root }]]]);
  const coordinator = createOvenProjectionCoordinator({
    observer,
    snapshotStore: snapshots,
    handlers: [],
    resolveBindings: () => bindings,
    createContext: () => ({}),
    timers,
  });

  writeFileSync(path, JSON.stringify({ version: 22, changed: true }));
  assert.equal(snapshots.stats().entries, 1, "no publication event was delivered");
  const [{ callback, intervalMs }] = [...timers.intervals.values()];
  assert.equal(intervalMs, 30_000);
  callback();
  assert.equal(snapshots.stats().entries, 0);
  coordinator.stop();
});

test("an observer reset immediately reconciles canonical projections", (t) => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-projection-reset-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "visual.json");
  writeFileSync(path, JSON.stringify({ version: 1 }));
  const snapshots = createOvenJsonSnapshotStore();
  snapshots.read({ path, scope: "visual-parity", label: "visual fixture", maxSourceBytes: 1_024, validate() {} });
  const observer = fakeObserver();
  const coordinator = createOvenProjectionCoordinator({
    observer,
    snapshotStore: snapshots,
    handlers: [],
    resolveBindings: () => new Map([["visual-parity", [{ path, repoKey: "abc123abc123", repoRoot: root }]]]),
    createContext: () => ({}),
    timers: fakeTimers(),
  });
  writeFileSync(path, JSON.stringify({ version: 2, changed: true }));
  observer.callbacks().onReset({ ovenId: "visual-parity", reason: "retention-gap" });
  assert.equal(snapshots.stats().entries, 0);
  coordinator.stop();
});
