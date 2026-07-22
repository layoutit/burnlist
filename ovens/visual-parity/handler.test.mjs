import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { renameSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visualParityFixture } from "../../dashboard/src/components/VisualParity/VisualParity.fixture.mjs";
import { httpGet, withServer } from "../../src/server/dashboard-routes-fixtures.mjs";
import { readTextFileWithIdentity } from "../../src/server/fs-safe.mjs";
import { repoKey } from "../../src/server/registry.mjs";
import {
  readStableVisualParitySource,
  VISUAL_PARITY_CACHE_MAX_ENTRIES,
  VISUAL_PARITY_RESPONSE_CHUNK_BYTES,
  visualParityHandler,
} from "./handler.mjs";

function threeFramePayload() {
  const payload = structuredClone(visualParityFixture);
  const scenarioId = payload.differentialTesting.scenarioCatalog.selectedScenarioId;
  payload.differentialTesting.scenarioCatalog.scenarios[0].frameCount = 3;
  payload.differentialTesting.refresh.report.frameCount = 3;
  payload.comparisons = [0, 1, 2].map((frame) => {
    const comparison = structuredClone(visualParityFixture.comparisons[0]);
    comparison.id = `${scenarioId}-frame-${frame}`;
    comparison.label = `Fixture frame ${frame}`;
    comparison.frame = frame;
    if (frame === 2) {
      comparison.status = "fail";
      comparison.domains.cars.status = "fail";
      comparison.domains.cars.difference.maximumAbsoluteDelta = 2;
    }
    return comparison;
  });
  return payload;
}

class ResponseRecorder extends EventEmitter {
  constructor({ writeResults = [] } = {}) {
    super();
    this.status = null;
    this.headers = null;
    this.headersSent = false;
    this.destroyed = false;
    this.ended = false;
    this.chunks = [];
    this.writeResults = [...writeResults];
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
  }

  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return this.writeResults.length ? this.writeResults.shift() : true;
  }

  end(chunk) {
    if (chunk !== undefined) this.chunks.push(Buffer.from(chunk));
    this.ended = true;
    this.emit("finish");
  }

  destroy() {
    this.destroyed = true;
    this.emit("close");
  }

  get body() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function handlerContext(path, cache, headers = {}, {
  maxOvenDataBytes = 1024 * 1024,
  ovenDataBindings,
  res = new ResponseRecorder(),
} = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  return {
    bindingPath: path,
    cache,
    maxOvenDataBytes,
    ovenDataBindings,
    req,
    res,
  };
}

function cacheState(cache) {
  const states = [...cache.values()].filter((entry) => entry?.responses instanceof Map
    && entry?.summaries instanceof Map);
  assert.equal(states.length, 1);
  return states[0];
}

function markedSource(marker, padding = 0) {
  const payload = threeFramePayload();
  payload.comparisons[0].label = `${marker}${"x".repeat(padding)}`;
  return JSON.stringify(payload);
}

function identity(path) {
  const stat = statSync(path);
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function dashboardContext(cache, ovenDataBindings, maxOvenDataBytes = 1024 * 1024) {
  return { cache, ovenDataBindings, maxOvenDataBytes, discoveredRepos: () => [] };
}

test("Visual Parity caches one validated source and invalidates it when the file changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-handler-"));
  const path = join(root, "visual-parity.json");
  const cache = new Map();
  try {
    await writeFile(path, JSON.stringify(threeFramePayload()));
    const initial = handlerContext(path, cache);
    assert.equal(visualParityHandler.serveData(initial), undefined);
    assert.equal(initial.res.status, 200);
    assert.equal(JSON.parse(initial.res.body).validated, true);
    const initialEtag = initial.res.headers.etag;
    const state = cacheState(cache);
    const cached = state.responses.get(path);

    const unchanged = handlerContext(path, cache, { "if-none-match": initialEtag });
    visualParityHandler.serveData(unchanged);
    assert.equal(unchanged.res.status, 304);
    assert.equal(unchanged.res.body, "");
    assert.equal(state.responses.get(path), cached);

    const wildcard = handlerContext(path, cache, { "if-none-match": "*" });
    visualParityHandler.serveData(wildcard);
    assert.equal(wildcard.res.status, 304);

    const strongEtag = initialEtag.slice(2);
    const validatorList = handlerContext(path, cache, {
      "if-none-match": `W/"unrelated,opaque", ${strongEtag}, "later"`,
    });
    visualParityHandler.serveData(validatorList);
    assert.equal(validatorList.res.status, 304);

    const changedPayload = threeFramePayload();
    changedPayload.comparisons[0].label = "Updated fixture frame zero";
    await writeFile(path, JSON.stringify(changedPayload));
    const changed = handlerContext(path, cache, { "if-none-match": initialEtag });
    visualParityHandler.serveData(changed);
    assert.equal(changed.res.status, 200);
    assert.notEqual(changed.res.headers.etag, initialEtag);
    assert.equal(JSON.parse(changed.res.body).payload.comparisons[0].label, "Updated fixture frame zero");
    assert.notEqual(state.responses.get(path), cached);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity binds an atomic replacement to the descriptor that supplied its bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-identity-"));
  const path = join(root, "visual-parity.json");
  const replacement = join(root, "replacement.json");
  const before = markedSource("old-value");
  const after = markedSource("new-value");
  try {
    await writeFile(path, before);
    await writeFile(replacement, after);
    let reads = 0;
    const stable = readStableVisualParitySource(path, 1024 * 1024, {
      readSource(...args) {
        if (reads === 0) renameSync(replacement, path);
        reads += 1;
        return readTextFileWithIdentity(...args);
      },
    });
    assert.equal(reads, 1);
    assert.equal(stable.source, after);
    assert.equal(JSON.parse(stable.source).comparisons[0].label, "new-value");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity rejects ABA bytes whose descriptor identity differs from the final path", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-aba-"));
  const path = join(root, "visual-parity.json");
  const swapped = join(root, "swapped.json");
  const sourceA = markedSource("path-a");
  const sourceB = markedSource("descriptor-b");
  try {
    await writeFile(path, sourceA);
    await writeFile(swapped, sourceB);
    let reads = 0;
    const stable = readStableVisualParitySource(path, 1024 * 1024, {
      readSource() {
        reads += 1;
        return reads === 1
          ? { text: sourceB, identity: identity(swapped) }
          : { text: sourceA, identity: identity(path) };
      },
    });
    assert.equal(reads, 2);
    assert.equal(stable.source, sourceA);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity keeps every summary hot while bounding bodies and pruning absent bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-cache-"));
  try {
    const countPaths = Array.from({ length: VISUAL_PARITY_CACHE_MAX_ENTRIES + 1 }, (_, index) =>
      join(root, `count-${index}.json`));
    await Promise.all(countPaths.map((path, index) => writeFile(path, markedSource(`count-${index}`))));
    const countBindings = new Map([["visual-parity", countPaths.map((path) =>
      ({ path, repoKey: null, repoRoot: root }))]]);
    const countCache = new Map();
    assert.equal(visualParityHandler.dashboardEntries(dashboardContext(countCache, countBindings)).length,
      countPaths.length);
    const countState = cacheState(countCache);
    const hotSummaries = new Map(countState.summaries);
    assert.equal(countState.summaries.size, countPaths.length);
    assert.equal(countState.responses.size, 0);
    visualParityHandler.dashboardEntries(dashboardContext(countCache, countBindings));
    for (const [path, summary] of hotSummaries) assert.equal(countState.summaries.get(path), summary);

    for (const path of countPaths) {
      visualParityHandler.serveData(handlerContext(path, countCache, {}, {
        maxOvenDataBytes: 1024 * 1024,
        ovenDataBindings: countBindings,
      }));
    }
    assert.equal(countState.responses.size, VISUAL_PARITY_CACHE_MAX_ENTRIES);
    assert.equal(countState.responses.has(countPaths[0]), false);
    assert.equal(countState.responses.has(countPaths.at(-1)), true);
    const responseOrder = [...countState.responses.keys()];
    const servedSummaries = new Map(countState.summaries);
    visualParityHandler.dashboardEntries(dashboardContext(countCache, countBindings));
    assert.deepEqual([...countState.responses.keys()], responseOrder);
    for (const [path, summary] of servedSummaries) assert.equal(countState.summaries.get(path), summary);

    countBindings.set("visual-parity", [{ path: countPaths.at(-1), repoKey: null, repoRoot: root }]);
    visualParityHandler.serveData(handlerContext(countPaths.at(-1), countCache, {}, {
      maxOvenDataBytes: 1024 * 1024,
      ovenDataBindings: countBindings,
    }));
    assert.deepEqual([...countState.responses.keys()], [countPaths.at(-1)]);
    assert.deepEqual([...countState.summaries.keys()], [countPaths.at(-1)]);

    const bytePaths = Array.from({ length: 3 }, (_, index) => join(root, `byte-${index}.json`));
    const byteSources = bytePaths.map((_, index) => markedSource(`byte-${index}`, 40_000));
    await Promise.all(bytePaths.map((path, index) => writeFile(path, byteSources[index])));
    assert.equal(new Set(byteSources.map((source) => Buffer.byteLength(source))).size, 1);
    const maxOvenDataBytes = Buffer.byteLength(byteSources[0]);
    const byteBindings = new Map([["visual-parity", bytePaths.map((path) =>
      ({ path, repoKey: null, repoRoot: root }))]]);
    const byteCache = new Map();
    for (const path of bytePaths) {
      visualParityHandler.serveData(handlerContext(path, byteCache, {}, {
        maxOvenDataBytes,
        ovenDataBindings: byteBindings,
      }));
    }
    const byteState = cacheState(byteCache);
    assert.equal(byteState.responses.size, 2);
    assert.equal(byteState.summaries.size, 3);
    assert.equal(byteState.responses.has(bytePaths[0]), false);
    assert.ok(byteState.responseBytes <= maxOvenDataBytes * 2);
    const byteResponseOrder = [...byteState.responses.keys()];
    visualParityHandler.dashboardEntries(dashboardContext(byteCache, byteBindings, maxOvenDataBytes));
    assert.deepEqual([...byteState.responses.keys()], byteResponseOrder);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity clears response and summary caches when the final binding is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-empty-bindings-"));
  const path = join(root, "visual-parity.json");
  const cache = new Map();
  try {
    await writeFile(path, markedSource("removed"));
    const bindings = new Map([["visual-parity", [{ path, repoKey: null, repoRoot: root }]]]);
    visualParityHandler.serveData(handlerContext(path, cache, {}, { ovenDataBindings: bindings }));
    const state = cacheState(cache);
    assert.equal(state.responses.size, 1);
    assert.equal(state.summaries.size, 1);
    assert.ok(state.responseBytes > 0);

    assert.deepEqual(visualParityHandler.dashboardEntries(dashboardContext(cache, new Map())), []);
    assert.equal(state.responses.size, 0);
    assert.equal(state.summaries.size, 0);
    assert.equal(state.responseBytes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity waits for drain and writes response chunks no larger than 64 KiB", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-drain-"));
  const path = join(root, "visual-parity.json");
  try {
    await writeFile(path, markedSource("large", 150_000));
    const res = new ResponseRecorder({ writeResults: [true, false] });
    const ctx = handlerContext(path, new Map(), {}, { res });
    visualParityHandler.serveData(ctx);
    assert.equal(res.status, 200);
    assert.equal(res.ended, false);
    assert.equal(res.listenerCount("drain"), 1);

    res.emit("drain");
    assert.equal(res.ended, true);
    assert.equal(res.listenerCount("drain"), 0);
    assert.ok(res.chunks.every((chunk) => chunk.length <= VISUAL_PARITY_RESPONSE_CHUNK_BYTES));
    assert.equal(Buffer.byteLength(res.body), res.headers["content-length"]);
    assert.equal(JSON.parse(res.body).payload.comparisons[0].label.length, 150_005);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity stops a backpressured response after close or error", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-close-"));
  const path = join(root, "visual-parity.json");
  try {
    await writeFile(path, markedSource("connection"));
    for (const event of ["close", "error"]) {
      const res = new ResponseRecorder({ writeResults: [false] });
      visualParityHandler.serveData(handlerContext(path, new Map(), {}, { res }));
      assert.equal(res.listenerCount("drain"), 1);
      res.emit(event, new Error(`test ${event}`));
      assert.equal(res.listenerCount("drain"), 0);
      res.emit("drain");
      assert.equal(res.ended, false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity route returns 304 and keeps a rounded dashboard summary", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [{ repoPath: "app" }],
    ovenData: [{
      id: "visual-parity",
      payload: threeFramePayload(),
      repoPath: "app",
      persisted: true,
      override: false,
    }],
  }, async ({ baseUrl, repoRoot }) => {
    const key = repoKey(repoRoot);
    const endpoint = new URL(`/api/oven-data/visual-parity?repoKey=${key}`, baseUrl);
    const initial = await fetch(endpoint);
    assert.equal(initial.status, 200);
    const etag = initial.headers.get("etag");
    assert.match(etag, /^W\/"vp-[a-f0-9]{64}"$/u);
    assert.equal((await initial.json()).validated, true);

    const unchanged = await fetch(endpoint, { headers: { "If-None-Match": etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), "");

    const rows = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists;
    const row = rows.find((entry) => entry.ovenId === "visual-parity" && entry.repoKey === key);
    assert.ok(row);
    assert.equal(row.statusLabel, "Open");
    assert.equal(row.percent, 67);
    assert.equal(row.progressLabel, "2/3 target frames");
  });
});
