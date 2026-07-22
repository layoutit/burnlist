import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

const dashboardRoot = new URL("..", import.meta.url).pathname;

async function source(path) {
  return readFile(join(dashboardRoot, path), "utf8");
}

async function productionFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return /\.(?:mjs|ts|tsx)$/u.test(entry.name) && !/\.test\./u.test(entry.name) ? [path] : [];
  }))).flat();
}

test("every live Oven page renders through the canonical runtime", async () => {
  const pages = [
    "components/ChecklistDashboard/ChecklistOvenView.tsx",
    "components/CustomOvenView/CustomOvenView.tsx",
    "components/DifferentialTestingOven/DifferentialTestingOven.tsx",
    "components/ModelLab/ModelLab.tsx",
    "components/StreamingDiff/StreamingDiff.tsx",
    "components/VisualParity/VisualParity.tsx",
  ];
  for (const path of pages) assert.match(await source(path), /<OvenRuntime\b/u, path);

  for (const path of pages.filter((path) => !path.includes("StreamingDiff"))) {
    assert.doesNotMatch(await source(path), /\b(?:EventSource|setInterval|fetch)\s*\(/u, path);
  }
  assert.doesNotMatch(await source("main.tsx"), /legacyRoute|\/ovens\/.*\/view/u);
  assert.match(await source("oven/runtime/oven-live-data.ts"), /if \(!id\) return undefined/u);
  assert.doesNotMatch(await source("oven/runtime/oven-live-data.ts"), /!Number\.isFinite\(seconds\)|seconds <= 0/u);
  assert.doesNotMatch(
    await source("oven/differential-testing-render/differential-testing-renderer.js"),
    /startDifferentialTestingLiveUpdates|setInterval|fetch\s*\(/u,
  );
});

test("dashboard intervals are restricted to reconciliation and display clocks", async () => {
  const files = await productionFiles(dashboardRoot);
  const uses = [];
  for (const path of files) {
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(/\bsetInterval\s*\(/gu)) uses.push(relative(dashboardRoot, path));
  }
  assert.deepEqual(uses.sort(), [
    "lib/oven-event-client.mjs",
    "oven/DifferentialLogTable/DifferentialLogTable.tsx",
  ]);
  assert.match(await source("lib/oven-event-client.mjs"), /OVEN_BROWSER_RECONCILE_MS = 30_000/u);
  assert.match(await source("oven/DifferentialLogTable/DifferentialLogTable.tsx"), /setInterval\(\(\) => setClock\(Date\.now\(\)\), 60_000\)/u);
});
