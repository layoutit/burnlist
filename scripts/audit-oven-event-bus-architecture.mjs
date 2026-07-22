#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["src", "ovens", "dashboard/src"];

function productionFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!["goldens", "stories"].includes(entry.name)) files.push(...productionFiles(path));
    } else if (/\.(?:js|mjs|ts|tsx)$/u.test(entry.name)
      && !/\.(?:test|stories)\./u.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function source(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function outputArgument(argv) {
  if (argv.length === 0) return null;
  if (argv.length !== 2 || argv[0] !== "--output" || !argv[1]) {
    throw new Error("Usage: audit-oven-event-bus-architecture.mjs [--output <path>]");
  }
  return resolve(argv[1]);
}

const files = sourceRoots.flatMap((root) => productionFiles(resolve(repoRoot, root))).sort();
const entries = files.map((path) => ({
  path: relative(repoRoot, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));
const combined = entries.map(({ path, text }) => `${path}\n${text}`).join("\n");
const server = source("src/server/burnlist-dashboard-server.mjs");
const serverOwnership = {
  snapshotStores: count(server, /createOvenJsonSnapshotStore\s*\(/gu),
  eventObservers: count(server, /createOvenEventObserver\s*\(/gu),
  projectionCoordinators: count(server, /createOvenProjectionCoordinator\s*\(/gu),
};
assert.deepEqual(serverOwnership, { snapshotStores: 1, eventObservers: 1, projectionCoordinators: 1 });

const invalidationEventSourceOwners = entries
  .filter(({ text }) => /\bnew EventSource\s*\(/u.test(text))
  .map(({ path }) => path);
assert.deepEqual(invalidationEventSourceOwners, ["dashboard/src/lib/oven-event-client.mjs"]);
const streamingDiffTransport = source("dashboard/src/oven/utils/transports.ts");
assert.match(streamingDiffTransport, /new EventSourceImpl\s*\(/u);

const timerCounts = Object.fromEntries(entries.flatMap(({ path, text }) => {
  const uses = count(text, /\bsetInterval\s*\(/gu);
  return uses ? [[path, uses]] : [];
}).sort(([left], [right]) => left.localeCompare(right)));
assert.deepEqual(timerCounts, {
  "dashboard/src/lib/oven-event-client.mjs": 1,
  "dashboard/src/oven/DifferentialLogTable/DifferentialLogTable.tsx": 1,
  "ovens/differential-testing/engine/worker-runtime.mjs": 1,
  "ovens/streaming-diff/engine/streaming-diff-handler.mjs": 2,
  "src/events/oven-event-observer.mjs": 1,
  "src/server/oven-projection-coordinator.mjs": 1,
});

const handlers = [
  "src/ovens/handlers/generic-json-handler.mjs",
  "ovens/differential-testing/engine/handler.mjs",
  "ovens/model-lab/engine/model-lab-handler.mjs",
  "ovens/performance-tracing/handler.mjs",
  "ovens/visual-parity/handler.mjs",
];
for (const path of handlers) {
  const text = source(path);
  assert.match(text, /readOvenJsonSnapshot/u, path);
  assert.match(text, /serveOvenJson(?:Snapshot|Response)/u, path);
  assert.doesNotMatch(text, /readTextFileWithLimit|ifNoneMatchMatches|streamOvenResponse|responseCache/u, path);
}

const livePages = [
  "dashboard/src/components/ChecklistDashboard/ChecklistOvenView.tsx",
  "dashboard/src/components/CustomOvenView/CustomOvenView.tsx",
  "dashboard/src/components/DifferentialTestingOven/DifferentialTestingOven.tsx",
  "dashboard/src/components/ModelLab/ModelLab.tsx",
  "dashboard/src/components/StreamingDiff/StreamingDiff.tsx",
  "dashboard/src/components/VisualParity/VisualParity.tsx",
];
for (const path of livePages) assert.match(source(path), /<OvenRuntime\b/u, path);

const canonicalWriters = [
  { path: "src/server/oven-data-store.mjs", mutation: "data", marker: /publishOvenDataPublishedEvent/u },
  { path: "src/server/oven-bindings.mjs", mutation: "binding", marker: /publishCanonicalMutation/u },
  { path: "src/cli/oven-cli.mjs", mutation: "definition", marker: /publishDefinitionChange/u },
  { path: "src/cli/oven-use.mjs", mutation: "adoption", marker: /publishAdoptionEvent/u },
  { path: "src/cli/lifecycle-moves.mjs", mutation: "lifecycle-and-burn", marker: /publishCanonicalMutation/u },
];
for (const writer of canonicalWriters) assert.match(source(writer.path), writer.marker, writer.path);

const forbiddenPatterns = [
  ["fixed differential polling", /startDifferentialTestingLiveUpdates|DIFFERENTIAL_TESTING_REFRESH_MS/u],
  ["fixed model-lab polling", /MODEL_LAB_POLL_MS/u],
  ["poll transport", /transport\s*:\s*["']poll["']/u],
  ["warm service", /warmOvenHandler|oven-warm\.mjs/u],
  ["legacy Oven view route", /\/ovens\/[^\n"']*\/view/u],
];
const forbiddenMatches = forbiddenPatterns.flatMap(([name, pattern]) => pattern.test(combined) ? [name] : []);
assert.deepEqual(forbiddenMatches, []);

const result = {
  schema: "burnlist-oven-event-bus-source-audit@1",
  capturedAt: new Date().toISOString(),
  productionFilesScanned: entries.length,
  serverOwnership,
  invalidationEventSourceOwners,
  intentionalSeparateContentTransport: "Streaming Diff ordered content SSE",
  timerCounts,
  sharedCanonicalJsonHandlers: handlers,
  canonicalRuntimePages: livePages,
  canonicalWriters: canonicalWriters.map(({ path, mutation }) => ({ path, mutation })),
  forbiddenMatches,
  assertions: {
    oneProcessSnapshotStore: true,
    oneProcessEventObserver: true,
    oneProjectionCoordinator: true,
    oneBrowserInvalidationEventSourceOwner: true,
    allJsonHandlersUseSharedSnapshotAndAdmission: true,
    allLiveOvenPagesUseCanonicalRuntime: true,
    canonicalMutationClassesPublishAfterCommit: true,
    retiredWarmPollAndLegacyViewPathsAbsent: true,
  },
};
const output = outputArgument(process.argv.slice(2));
if (output) atomicJson(output, result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
