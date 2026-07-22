import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visualParityFixture } from "../../dashboard/src/components/VisualParity/VisualParity.fixture.mjs";
import { withServer } from "../../src/server/dashboard-routes-fixtures.mjs";
import { repoKey } from "../../src/server/registry.mjs";
import {
  VISUAL_PARITY_ACTIVE_RESPONSE_MAX_ENTRIES,
  visualParityHandler,
} from "./handler.mjs";

function payload(marker, padding = 0) {
  const result = structuredClone(visualParityFixture);
  result.comparisons[0].label = `${marker}${"x".repeat(padding)}`;
  return JSON.stringify(result);
}

class ResponseRecorder extends EventEmitter {
  constructor({ writeResult = true } = {}) {
    super();
    this.writeResult = writeResult;
    this.status = null;
    this.headers = null;
    this.headersSent = false;
    this.destroyed = false;
    this.ended = false;
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
  }

  write() {
    return this.writeResult;
  }

  end() {
    this.ended = true;
    this.emit("finish");
  }

  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
}

function timerHarness() {
  const active = new Map();
  const deadlines = new Map();
  let nextId = 0;
  let now = 0;
  return {
    active,
    timers: {
      setTimeout(callback, delay = 0) {
        const id = nextId;
        nextId += 1;
        active.set(id, callback);
        deadlines.set(id, now + delay);
        return id;
      },
      clearTimeout(id) {
        active.delete(id);
        deadlines.delete(id);
      },
    },
    advanceBy(delay) {
      const target = now + delay;
      while (true) {
        let dueId = null;
        let dueAt = Number.POSITIVE_INFINITY;
        for (const [id, deadline] of deadlines) {
          if (deadline <= target && deadline < dueAt) {
            dueId = id;
            dueAt = deadline;
          }
        }
        if (dueId === null) break;
        now = dueAt;
        const callback = active.get(dueId);
        active.delete(dueId);
        deadlines.delete(dueId);
        callback();
      }
      now = target;
    },
    fireAll() {
      for (const [id, callback] of [...active]) {
        if (!active.delete(id)) continue;
        deadlines.delete(id);
        callback();
      }
    },
  };
}

function bindings(path, root) {
  return new Map([["visual-parity", [{ path, repoKey: null, repoRoot: root }]]]);
}

function context(path, cache, ovenDataBindings, {
  maxOvenDataBytes = 1024 * 1024,
  res = new ResponseRecorder(),
  responseTimeoutMs,
  responseTimers,
} = {}) {
  const req = new EventEmitter();
  req.headers = {};
  return {
    bindingPath: path,
    cache,
    ovenDataBindings,
    maxOvenDataBytes,
    req,
    res,
    responseTimeoutMs,
    responseTimers,
  };
}

function cacheState(cache) {
  const state = [...cache.values()].find((entry) => entry?.responses instanceof Map);
  assert.ok(state);
  return state;
}

function assertEmpty(state) {
  assert.equal(state.responses.size, 0);
  assert.equal(state.summaries.size, 0);
  assert.equal(state.responseBytes, 0);
}

test("Visual Parity evicts both caches when a bound data file disappears", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-missing-"));
  const path = join(root, "visual-parity.json");
  const cache = new Map();
  const activeBindings = bindings(path, root);
  try {
    await writeFile(path, payload("data-route"));
    visualParityHandler.serveData(context(path, cache, activeBindings));
    const state = cacheState(cache);
    assert.equal(state.responses.size, 1);
    assert.equal(state.summaries.size, 1);

    await rm(path);
    assert.throws(() => visualParityHandler.serveData(context(path, cache, activeBindings)), /data is missing/u);
    assertEmpty(state);

    await writeFile(path, payload("dashboard-route"));
    visualParityHandler.serveData(context(path, cache, activeBindings));
    await rm(path);
    const entries = visualParityHandler.dashboardEntries({
      cache, ovenDataBindings: activeBindings, maxOvenDataBytes: 1024 * 1024, discoveredRepos: () => [],
    });
    assert.equal(entries[0].statusLabel, "Blocked");
    assertEmpty(state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity route reconciles its cache before a final-binding 404", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [{ repoPath: "app" }],
    ovenData: [{ id: "visual-parity", payload: visualParityFixture, repoPath: "app", persisted: true, override: false }],
  }, async ({ baseUrl, repoRoot }) => {
    const endpoint = new URL(`/api/oven-data/visual-parity?repoKey=${repoKey(repoRoot)}`, baseUrl);
    assert.equal((await fetch(endpoint)).status, 200);
    await rm(join(repoRoot, ".local", "burnlist", "bindings.json"));
    assert.equal((await fetch(endpoint)).status, 404);
  });
});

test("Visual Parity binding reconciliation clears an already-populated cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-binding-reconcile-"));
  const path = join(root, "visual-parity.json");
  const cache = new Map();
  try {
    await writeFile(path, payload("removed"));
    visualParityHandler.serveData(context(path, cache, bindings(path, root)));
    const state = cacheState(cache);
    visualParityHandler.reconcileDataBindings({ cache, ovenDataBindings: new Map(), maxOvenDataBytes: 1024 * 1024 });
    assertEmpty(state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity aborts stalled responses at the active stream count and timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-active-count-"));
  const cache = new Map();
  const paths = Array.from({ length: VISUAL_PARITY_ACTIVE_RESPONSE_MAX_ENTRIES + 1 }, (_, index) =>
    join(root, `${index}.json`));
  const activeBindings = new Map([["visual-parity", paths.map((path) => ({ path, repoKey: null, repoRoot: root }))]]);
  try {
    await Promise.all(paths.map((path, index) => writeFile(path, payload(`stalled-${index}`))));
    const stalled = [];
    for (const path of paths.slice(0, -1)) {
      const timers = timerHarness();
      const res = new ResponseRecorder({ writeResult: false });
      visualParityHandler.serveData(context(path, cache, activeBindings, { res, responseTimers: timers.timers }));
      assert.equal(res.status, 200);
      stalled.push({ res, timers });
    }
    const state = cacheState(cache);
    assert.equal(state.activeResponses, VISUAL_PARITY_ACTIVE_RESPONSE_MAX_ENTRIES);
    assert.ok(state.activeResponseBytes > 0);

    const rejected = new ResponseRecorder({ writeResult: false });
    visualParityHandler.serveData(context(paths.at(-1), cache, activeBindings, { res: rejected }));
    assert.equal(rejected.status, 503);
    assert.equal(rejected.ended, true);

    for (const { res, timers } of stalled) {
      timers.fireAll();
      assert.equal(res.destroyed, true);
      assert.equal(res.listenerCount("drain"), 0);
      assert.equal(timers.active.size, 0);
    }
    assert.equal(state.activeResponses, 0);
    assert.equal(state.activeResponseBytes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity renews the stalled-response timeout after each drain", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-progress-timeout-"));
  const path = join(root, "visual-parity.json");
  const cache = new Map();
  const timers = timerHarness();
  const res = new ResponseRecorder({ writeResult: false });
  const timeoutMs = 30;
  try {
    await writeFile(path, payload("progress", 150_000));
    visualParityHandler.serveData(context(path, cache, bindings(path, root), {
      res,
      responseTimeoutMs: timeoutMs,
      responseTimers: timers.timers,
    }));

    let drains = 0;
    while (!res.ended && drains < 20) {
      timers.advanceBy(timeoutMs - 1);
      assert.equal(res.destroyed, false);
      assert.equal(timers.active.size, 1);
      res.emit("drain");
      drains += 1;
    }

    assert.ok(drains > 1);
    assert.equal(res.ended, true);
    assert.equal(res.destroyed, false);
    assert.equal(timers.active.size, 0);
    assert.equal(cacheState(cache).activeResponses, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity active response bytes reject another stalled large body", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-active-bytes-"));
  const cache = new Map();
  const firstPath = join(root, "first.json");
  const secondPath = join(root, "second.json");
  const source = payload("large", 700_000);
  const maxOvenDataBytes = Buffer.byteLength(source);
  const activeBindings = new Map([["visual-parity", [firstPath, secondPath]
    .map((path) => ({ path, repoKey: null, repoRoot: root }))]]);
  try {
    await Promise.all([writeFile(firstPath, source), writeFile(secondPath, source)]);
    const timers = timerHarness();
    const first = new ResponseRecorder({ writeResult: false });
    visualParityHandler.serveData(context(firstPath, cache, activeBindings, {
      maxOvenDataBytes, res: first, responseTimers: timers.timers,
    }));
    const second = new ResponseRecorder({ writeResult: false });
    visualParityHandler.serveData(context(secondPath, cache, activeBindings, { maxOvenDataBytes, res: second }));
    assert.equal(first.status, 200);
    assert.equal(second.status, 503);
    timers.fireAll();
    assert.equal(cacheState(cache).activeResponseBytes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
