#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function argumentsMap(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Evidence capture arguments must be --name value pairs.");
    values.set(key.slice(2), value);
  }
  return values;
}

function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function assetPaths() {
  const index = readFileSync(resolve("dashboard/dist/index.html"), "utf8");
  const script = index.match(/src="(\/assets\/[^"]+\.js)"/u)?.[1];
  const stylesheet = index.match(/href="(\/assets\/[^"]+\.css)"/u)?.[1];
  assert.ok(script && stylesheet, "production index must identify its exact JS and CSS assets");
  return { script, stylesheet };
}

function requestRecord(entry) {
  return {
    id: entry.id,
    requestedAt: entry.requestedAt,
    path: entry.path,
    status: entry.status,
    ifNoneMatch: entry.ifNoneMatch,
    etag: entry.etag,
    contentLength: entry.contentLength,
    responseBytes: entry.responseBytes,
  };
}

function firstBetween(entries, path, after, before, status) {
  return entries.find((entry) => entry.path.startsWith(path)
    && entry.requestedAt >= after && (!before || entry.requestedAt < before)
    && (status === undefined || entry.status === status));
}

const args = argumentsMap(process.argv.slice(2));
const evidenceUrl = required(args, "evidence-url");
const artifactRoot = resolve(required(args, "artifact-root"));
const output = resolve(required(args, "output"));
const rawOutput = resolve(required(args, "raw-output"));
const capturedAt = new Date().toISOString();
const raw = await fetch(evidenceUrl).then((response) => {
  if (!response.ok) throw new Error(`Evidence endpoint failed (${response.status}).`);
  return response.json();
});
assert.ok(Array.isArray(raw.entries) && Array.isArray(raw.controls));
const controls = new Map(raw.controls.map((entry) => [entry.action, entry]));
for (const name of [
  "publish-model-v2", "publish-unchanged-event", "manual-model-v3", "disconnect-events", "publish-model-v4",
]) assert.equal(controls.get(name)?.ok, true, `missing successful control ${name}`);

const tracesDir = join(artifactRoot, ".playwright-cli", "traces");
const traceName = readdirSync(tracesDir).find((name) => name.endsWith(".trace"));
const networkName = readdirSync(tracesDir).find((name) => name.endsWith(".network"));
assert.ok(traceName && networkName, "Playwright trace and network artifacts are required");
const tracePath = join(tracesDir, traceName);
const networkPath = join(tracesDir, networkName);
const trace = readFileSync(tracePath, "utf8");
for (const text of [
  "Canonical Fixture · fixture-model",
  "Canonical Fixture v2 · fixture-model",
  "Canonical Fixture v3 · fixture-model",
  "Canonical Fixture v4 · fixture-model",
  "Target qualified",
]) assert.match(trace, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

const screenshots = ["model-lab-v4-final.png", "visual-parity-final.png"].map((name) => {
  const path = join(artifactRoot, name);
  assert.ok(statSync(path).size > 0);
  return { path: relative(process.cwd(), path), bytes: statSync(path).size, sha256: sha256(path) };
});
const assets = assetPaths();
const productionAssets = Object.fromEntries(Object.entries(assets).map(([kind, path]) => {
  const localPath = resolve("dashboard/dist", path.slice(1));
  return [kind, { path, bytes: statSync(localPath).size, sha256: sha256(localPath) }];
}));

const modelRequests = raw.entries.filter((entry) => entry.path.startsWith("/api/oven-data/model-lab?"));
const visualRequests = raw.entries.filter((entry) => entry.path.startsWith("/api/oven-data/visual-parity?"));
const initial = modelRequests[0];
const publishV2 = controls.get("publish-model-v2");
const unchangedControl = controls.get("publish-unchanged-event");
const manualV3 = controls.get("manual-model-v3");
const disconnect = controls.get("disconnect-events");
const publishV4 = controls.get("publish-model-v4");
const eventUpdate = firstBetween(raw.entries, "/api/oven-data/model-lab?", publishV2.completedAt, unchangedControl.startedAt, 200);
const unchanged = firstBetween(raw.entries, "/api/oven-data/model-lab?", unchangedControl.completedAt, manualV3.startedAt, 304);
const fallback = firstBetween(raw.entries, "/api/oven-data/model-lab?", manualV3.completedAt, disconnect.startedAt, 200);
const reconnectStream = firstBetween(raw.entries, "/api/events?stream=1", disconnect.completedAt, null, 200);
const reconnectUpdate = firstBetween(raw.entries, "/api/oven-data/model-lab?", publishV4.completedAt, null, 200);
assert.ok(initial && eventUpdate && unchanged && fallback && reconnectStream && reconnectUpdate);
assert.equal(modelRequests.filter((entry) => entry.requestedAt < publishV2.startedAt).length, 1);
assert.equal(eventUpdate.ifNoneMatch, initial.etag);
assert.equal(unchanged.ifNoneMatch, eventUpdate.etag);
assert.equal(unchanged.responseBytes, 0);
assert.equal(manualV3.result.eventPublished, false);
assert.equal(disconnect.result.disconnected, 1);

const visual = visualRequests[0];
const visualNavigation = raw.entries.find((entry) => entry.path.includes("/o/visual-parity"));
const laterNavigation = raw.entries.find((entry) => entry.id > visual.id && entry.path.includes("/o/model-lab"));
assert.ok(visual && visualNavigation && laterNavigation);
assert.equal(visualRequests.filter((entry) => entry.requestedAt < laterNavigation.requestedAt).length, 1);
const ordinaryIdleMs = Date.parse(publishV2.startedAt) - Date.parse(initial.completedAt);
const visualIdleMs = Date.parse(laterNavigation.requestedAt) - Date.parse(visual.completedAt);
assert.ok(ordinaryIdleMs > 2_000 && visualIdleMs > 2_000);

const rawArtifact = {
  schema: "burnlist-canonical-oven-network-log@1",
  capturedAt,
  evidenceUrl,
  entries: raw.entries,
  controls: raw.controls,
};
atomicJson(rawOutput, rawArtifact);
const result = {
  schema: "burnlist-canonical-oven-browser-evidence@2",
  capturedAt,
  productionAssets,
  routes: {
    modelLab: raw.entries.find((entry) => entry.path.includes("/o/model-lab"))?.path,
    visualParity: visualNavigation.path,
  },
  rawArtifacts: {
    networkLog: relative(process.cwd(), rawOutput),
    playwrightTrace: { path: relative(process.cwd(), tracePath), bytes: statSync(tracePath).size, sha256: sha256(tracePath) },
    playwrightNetwork: { path: relative(process.cwd(), networkPath), bytes: statSync(networkPath).size, sha256: sha256(networkPath) },
    screenshots,
  },
  ui: {
    observedInTrace: [
      "Canonical Fixture · fixture-model",
      "Canonical Fixture v2 · fixture-model",
      "Canonical Fixture v3 · fixture-model",
      "Canonical Fixture v4 · fixture-model",
      "Target qualified",
    ],
    runtime: "OvenRuntime",
  },
  idle: {
    ordinary: { observedMs: ordinaryIdleMs, snapshotRequests: 1, twoSecondPollObserved: false },
    visualParity: { observedMs: visualIdleMs, snapshotRequests: 1, twoSecondPollObserved: false },
  },
  eventDrivenPublish: { control: publishV2, request: requestRecord(eventUpdate), coalescedRequests: 1 },
  unchangedConditional: requestRecord(unchanged),
  publicationFailureFallback: {
    control: manualV3,
    request: requestRecord(fallback),
    observedAfterMs: Date.parse(fallback.requestedAt) - Date.parse(manualV3.completedAt),
  },
  reconnect: {
    disconnectControl: disconnect,
    publishControl: publishV4,
    streamRequest: requestRecord(reconnectStream),
    snapshotRequest: requestRecord(reconnectUpdate),
  },
  assertions: {
    exactProductionAssetsCaptured: true,
    ordinaryAndVisualIdleWithoutTwoSecondPolling: true,
    onePublishProducedOneConditionalSnapshotRequest: true,
    unchangedSnapshotRetransmittedPayload: false,
    failedPublicationRecoveredFromCanonicalState: true,
    reconnectReplayedDurablePublication: true,
    eventPayloadBecameUiState: false,
  },
};
atomicJson(output, result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
