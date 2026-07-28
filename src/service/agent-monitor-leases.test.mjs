import assert from "node:assert/strict";
import test from "node:test";
import { createAgentMonitorLeaseManager } from "./agent-monitor-leases.mjs";

function harness() {
  let at = Date.parse("2026-07-27T10:00:00Z");
  const timers = [];
  const runs = [];
  const manager = createAgentMonitorLeaseManager({
    now: () => at,
    leaseMs: 30_000,
    refreshMs: 2_000,
    prepare: (repoRoot) => ({ logicalRepoRoot: repoRoot }),
    run: ({ repoRoot }) => runs.push(repoRoot),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => timers.splice(timers.indexOf(timer), 1),
  });
  return {
    manager,
    runs,
    timers,
    advance(milliseconds) { at += milliseconds; },
    tick() { timers.shift()?.callback(); },
  };
}

test("a renewable Agent Monitor lease starts immediately and expires when the view leaves", () => {
  const value = harness();
  const first = value.manager.activate("/repo");
  assert.equal(first.active, true);
  assert.equal(value.timers[0].delay, 0);
  value.tick();
  assert.deepEqual(value.runs, ["/repo"]);
  assert.equal(value.timers[0].delay, 2_000);

  value.advance(20_000);
  value.manager.activate("/repo");
  value.tick();
  assert.deepEqual(value.runs, ["/repo", "/repo"]);

  value.advance(31_000);
  value.tick();
  assert.deepEqual(value.manager.status().activeRoots, []);
  assert.equal(value.timers.length, 0);
});

test("stopping the service cancels pending Agent Monitor work", () => {
  const value = harness();
  value.manager.activate("/repo");
  value.manager.stop();
  assert.equal(value.timers.length, 0);
  assert.throws(() => value.manager.activate("/repo"), /stopped/u);
});

test("an asynchronous refresh never blocks activation and is cancelled on stop", async () => {
  let resolveRun;
  let aborted = false;
  const timers = [];
  const manager = createAgentMonitorLeaseManager({
    prepare: (repoRoot) => ({ logicalRepoRoot: repoRoot }),
    run: ({ signal }) => new Promise((resolve) => {
      resolveRun = resolve;
      signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
    }),
    setTimer: (callback) => {
      const timer = { callback, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });
  assert.equal(manager.activate("/repo").active, true);
  timers.shift().callback();
  assert.equal(manager.status().running, true);
  manager.stop();
  await Promise.resolve();
  assert.equal(aborted, true);
  resolveRun?.();
});
