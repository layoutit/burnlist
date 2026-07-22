import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../", import.meta.url).pathname;

async function source(path) {
  return readFile(join(repoRoot, path), "utf8");
}

async function productionFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return /\.(?:mjs|ts|tsx)$/u.test(entry.name)
      && !/\.(?:test|stories)\./u.test(entry.name)
      ? [path]
      : [];
  }))).flat();
}

test("one server snapshot store, observer, and projection coordinator own ordinary freshness", async () => {
  const server = await source("src/server/burnlist-dashboard-server.mjs");
  assert.equal((server.match(/createOvenJsonSnapshotStore\s*\(/gu) ?? []).length, 1);
  assert.equal((server.match(/createOvenEventObserver\s*\(/gu) ?? []).length, 1);
  assert.equal((server.match(/createOvenProjectionCoordinator\s*\(/gu) ?? []).length, 1);
  assert.match(server, /from "\.\/oven-projection-coordinator\.mjs"/u);
  assert.doesNotMatch(server, /oven-warm|warmOvenHandler|\/ovens\/.*\/view/u);

  const eventFeed = await source("src/events/oven-event-feed.mjs");
  assert.doesNotMatch(eventFeed, /\bsetInterval\s*\(/u);
  const coordinator = await source("src/server/oven-projection-coordinator.mjs");
  assert.doesNotMatch(coordinator, /handler\??\.warm|warmOvenHandler/u);
});

test("every JSON Oven handler uses the shared canonical snapshot and response service", async () => {
  const handlers = [
    "src/ovens/handlers/generic-json-handler.mjs",
    "ovens/differential-testing/engine/handler.mjs",
    "ovens/model-lab/engine/model-lab-handler.mjs",
    "ovens/performance-tracing/handler.mjs",
    "ovens/visual-parity/handler.mjs",
  ];
  for (const path of handlers) {
    const text = await source(path);
    assert.match(text, /readOvenJsonSnapshot/u, path);
    assert.match(text, /serveOvenJson(?:Snapshot|Response)/u, path);
    assert.doesNotMatch(text, /responseCache|readStableVisualParitySource|warmIntervalMs/u, path);
  }
  const differential = await source("ovens/differential-testing/engine/handler.mjs");
  assert.match(differential, /createDifferentialQueryProjectionCache/u);
  assert.doesNotMatch(differential, /readTextFileWithLimit|ifNoneMatchMatches|streamOvenResponse|scenarioDocuments|scenarioResponses/u);
  assert.doesNotMatch(await source("ovens/visual-parity/handler.mjs"), /readStableJsonSource|ifNoneMatchMatches/u);
});

test("every production interval is intentional and test-documented", async () => {
  const roots = ["src", "ovens", "dashboard/src"];
  const counts = new Map();
  for (const root of roots) {
    for (const path of await productionFiles(join(repoRoot, root))) {
      const text = await readFile(path, "utf8");
      const count = (text.match(/\bsetInterval\s*\(/gu) ?? []).length;
      if (count) counts.set(relative(repoRoot, path), count);
    }
  }
  assert.deepEqual(Object.fromEntries([...counts].sort()), {
    "dashboard/src/lib/oven-event-client.mjs": 1,
    "dashboard/src/oven/DifferentialLogTable/DifferentialLogTable.tsx": 1,
    "ovens/differential-testing/engine/worker-runtime.mjs": 1,
    "ovens/streaming-diff/engine/streaming-diff-handler.mjs": 2,
    "src/events/oven-event-observer.mjs": 1,
    "src/server/oven-projection-coordinator.mjs": 1,
  });
});

test("retired polling and warming cannot return through live production files", async () => {
  const roots = ["src", "ovens", "dashboard/src"];
  const production = (await Promise.all(roots.map((root) => productionFiles(join(repoRoot, root))))).flat();
  const combined = (await Promise.all(production.map(async (path) => `${relative(repoRoot, path)}\n${await readFile(path, "utf8")}`))).join("\n");
  for (const pattern of [
    /startDifferentialTestingLiveUpdates/u,
    /DIFFERENTIAL_TESTING_REFRESH_MS/u,
    /transport:\s*["']poll["']/u,
    /warmOvenHandler/u,
    /oven-warm\.mjs/u,
  ]) assert.doesNotMatch(combined, pattern);
  const registry = await source("src/ovens/oven-registry.mjs");
  assert.match(registry, /warming is retired; canonical snapshots refresh lazily/u);
});
