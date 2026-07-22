#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readAllOvenEventDeliveries } from "../src/events/oven-event-deliveries.mjs";
import { serveOvenEventFeed } from "../src/events/oven-event-feed.mjs";
import { createOvenEventObserver } from "../src/events/oven-event-observer.mjs";
import { publishOvenEvent } from "../src/events/oven-event-store.mjs";
import { readTextFileWithIdentity } from "../src/server/fs-safe.mjs";
import { createOvenJsonSnapshotStore } from "../src/server/oven-json-snapshot.mjs";
import { repoKey } from "../src/server/registry.mjs";
import { measureOvenResponseAdmission } from "./measure-oven-response-admission.mjs";

const IDLE_WINDOW_MS = 4_200;
const LEGACY_POLL_MS = 2_000;
const CANONICAL_FALLBACK_MS = 30_000;
const OBSERVER_SCAN_MS = 500;
const OBSERVER_WINDOW_MS = 1_250;
const CONSUMERS = 3;
const SOURCE_BYTES = 64 * 1024;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

function exactSource(version) {
  const empty = JSON.stringify({ version, detail: "" });
  const source = JSON.stringify({ version, detail: "x".repeat(SOURCE_BYTES - Buffer.byteLength(empty)) });
  assert.equal(Buffer.byteLength(source), SOURCE_BYTES);
  return source;
}

function zeroMetrics() {
  return { requests: 0, fullCanonicalReads: 0, parses: 0, fileIdentityChecks: 0, responseBodyBytes: 0 };
}

function resetMetrics(target) { Object.assign(target, zeroMetrics()); }

function jsonResponse(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolveClose) => {
    server.close(resolveClose);
    server.closeAllConnections?.();
  });
}

async function measuredFetch(url, headers) {
  const response = await fetch(url, { cache: "no-store", ...(headers ? { headers } : {}) });
  const bytes = (await response.arrayBuffer()).byteLength;
  return { status: response.status, etag: response.headers.get("etag") ?? "", bytes };
}

async function runPeriodic(url, intervalMs, windowMs, headers) {
  const pending = new Set();
  const timer = setInterval(() => {
    const task = measuredFetch(url, headers).finally(() => pending.delete(task));
    pending.add(task);
  }, intervalMs);
  await delay(windowMs);
  clearInterval(timer);
  await Promise.all(pending);
}

async function measureSnapshotRequests() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-http-measurement-"));
  const path = join(root, "canonical.json");
  const replacement = join(root, "replacement.json");
  writeFileSync(path, exactSource(1));
  const legacy = zeroMetrics();
  const canonical = zeroMetrics();
  const store = createOvenJsonSnapshotStore({
    readSource(...args) { canonical.fullCanonicalReads += 1; return readTextFileWithIdentity(...args); },
    statPath(target) {
      canonical.fileIdentityChecks += 1;
      try { return lstatSync(target); } catch { return null; }
    },
  });
  const readOptions = {
    path,
    scope: "model-lab",
    label: "Empirical canonical snapshot",
    maxSourceBytes: SOURCE_BYTES,
    validate(payload) { canonical.parses += 1; assert.equal(typeof payload.version, "number"); },
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://measurement.local");
    if (url.pathname === "/legacy") {
      legacy.requests += 1;
      legacy.fullCanonicalReads += 1;
      const payload = JSON.parse(readFileSync(path, "utf8"));
      legacy.parses += 1;
      const body = Buffer.from(JSON.stringify({ ovenId: "model-lab", validated: true, payload }));
      legacy.responseBodyBytes += body.length;
      res.writeHead(200, { "content-type": "application/json", "content-length": body.length });
      res.end(body);
      return;
    }
    if (url.pathname === "/canonical") {
      canonical.requests += 1;
      const snapshot = store.read(readOptions);
      const representation = store.response(snapshot, { ovenId: "model-lab", validated: true });
      const served = store.serveResponse({ req, res, representation });
      if (served.status === 200) canonical.responseBodyBytes += representation.responseBytes;
      return;
    }
    jsonResponse(res, 404, { error: "not found" });
  });
  try {
    const baseUrl = await listen(server);
    const legacyUrl = `${baseUrl}/legacy`;
    const canonicalUrl = `${baseUrl}/canonical`;
    const initialLegacy = await measuredFetch(legacyUrl);
    const initialCanonical = await measuredFetch(canonicalUrl);
    assert.equal(initialLegacy.status, 200);
    assert.equal(initialCanonical.status, 200);
    resetMetrics(legacy);
    resetMetrics(canonical);

    await Promise.all([
      runPeriodic(legacyUrl, LEGACY_POLL_MS, IDLE_WINDOW_MS),
      runPeriodic(canonicalUrl, CANONICAL_FALLBACK_MS, IDLE_WINDOW_MS, { "If-None-Match": initialCanonical.etag }),
    ]);
    const idle = { legacy: { ...legacy }, canonical: { ...canonical } };

    writeFileSync(replacement, exactSource(2));
    renameSync(replacement, path);
    store.invalidate(path, "model-lab");
    resetMetrics(legacy);
    resetMetrics(canonical);
    const [legacyResponses, canonicalResponse] = await Promise.all([
      Promise.all(Array.from({ length: CONSUMERS }, () => measuredFetch(legacyUrl))),
      measuredFetch(canonicalUrl, { "If-None-Match": initialCanonical.etag }),
    ]);
    assert.ok(legacyResponses.every((item) => item.status === 200));
    assert.equal(canonicalResponse.status, 200);
    const publishBurst = { legacy: { ...legacy }, canonical: { ...canonical } };

    resetMetrics(canonical);
    const unchangedResponse = await measuredFetch(canonicalUrl, { "If-None-Match": canonicalResponse.etag });
    assert.equal(unchangedResponse.status, 304);
    const unchanged = { ...canonical, status: unchangedResponse.status, receivedBodyBytes: unchangedResponse.bytes };
    return {
      initialRepresentationBytes: initialCanonical.bytes,
      idle,
      publishBurst,
      unchanged,
    };
  } finally {
    await closeServer(server);
    rmSync(root, { recursive: true, force: true });
  }
}

function openSse(url) {
  return new Promise((resolveOpen, reject) => {
    const req = request(url, { headers: { accept: "text/event-stream" } });
    req.once("error", reject);
    req.once("response", (res) => {
      res.once("data", () => resolveOpen({ close() { req.destroy(); res.destroy(); } }));
    });
    req.end();
  });
}

async function measureObserverScans() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-observer-measurement-"));
  const repo = { root, repoKey: repoKey(root), name: "fixture" };
  publishOvenEvent(root, {
    ovenId: "measurement-oven",
    subjectId: "fixture",
    kind: "iteration",
    phase: "complete",
    cursor: "baseline",
    occurredAt: new Date().toISOString(),
    payload: {},
  });
  const legacyPerSubscriber = Array.from({ length: CONSUMERS }, () => 0);
  const legacyTimers = legacyPerSubscriber.map((_, index) => setInterval(() => {
    readAllOvenEventDeliveries([repo], { watermarks: {}, limit: 256 });
    legacyPerSubscriber[index] += 1;
  }, OBSERVER_SCAN_MS));
  await delay(OBSERVER_WINDOW_MS);
  for (const timer of legacyTimers) clearInterval(timer);

  let liveFilesystemScans = 0;
  let subscriberFilesystemScans = 0;
  const observer = createOvenEventObserver({
    resolveRepos: () => [repo],
    scanIntervalMs: OBSERVER_SCAN_MS,
    readLiveDeliveries(repos, selection) {
      liveFilesystemScans += 1;
      return readAllOvenEventDeliveries(repos, selection);
    },
    readSubscriberDeliveries(repos, selection) {
      subscriberFilesystemScans += 1;
      return readAllOvenEventDeliveries(repos, selection);
    },
  });
  const stopLive = observer.observe({});
  const server = createServer((req, res) => {
    try {
      serveOvenEventFeed({
        req,
        res,
        url: new URL(req.url ?? "/", "http://measurement.local"),
        repos: [repo],
        observer,
        json: jsonResponse,
      });
    } catch (error) {
      jsonResponse(res, error?.status ?? 500, { error: error.message });
    }
  });
  try {
    const baseUrl = await listen(server);
    const clients = await Promise.all(Array.from({ length: CONSUMERS }, () => openSse(`${baseUrl}/api/events?stream=1`)));
    liveFilesystemScans = 0;
    subscriberFilesystemScans = 0;
    const scansBefore = observer.stats().scans;
    await delay(OBSERVER_WINDOW_MS);
    const state = observer.stats();
    const timedScans = state.scans - scansBefore;
    assert.ok(timedScans >= 2);
    assert.equal(liveFilesystemScans, timedScans);
    assert.equal(subscriberFilesystemScans, timedScans);
    for (const client of clients) client.close();
    return {
      windowMs: OBSERVER_WINDOW_MS,
      legacy: {
        subscribers: CONSUMERS,
        perSubscriberFilesystemScans: legacyPerSubscriber,
        totalFilesystemScans: legacyPerSubscriber.reduce((sum, count) => sum + count, 0),
      },
      canonical: {
        sseClients: state.subscribers,
        observerTicks: timedScans,
        liveInvalidationFilesystemScans: liveFilesystemScans,
        subscriberCatchupFilesystemScans: subscriberFilesystemScans,
      },
    };
  } finally {
    stopLive();
    observer.close();
    await closeServer(server);
    rmSync(root, { recursive: true, force: true });
  }
}

function reduction(before, after) {
  return before === 0 ? 0 : Number((((before - after) / before) * 100).toFixed(1));
}

function atomicOutput(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}

const snapshots = await measureSnapshotRequests();
const observer = await measureObserverScans();
const responseAdmission = await measureOvenResponseAdmission();
assert.equal(snapshots.idle.legacy.requests, 2);
assert.equal(snapshots.idle.canonical.requests, 0);
assert.equal(snapshots.publishBurst.legacy.requests, CONSUMERS);
assert.equal(snapshots.publishBurst.canonical.requests, 1);
assert.deepEqual(snapshots.unchanged, {
  requests: 1,
  fullCanonicalReads: 0,
  parses: 0,
  fileIdentityChecks: 2,
  responseBodyBytes: 0,
  status: 304,
  receivedBodyBytes: 0,
});
const result = {
  schema: "burnlist-oven-architecture-measurement@2",
  capturedAt: new Date().toISOString(),
  methodology: {
    timers: "real wall-clock timers; no fake timers",
    requests: "real loopback HTTP requests with response bodies consumed",
    filesystem: "real temporary files read and parsed by executable legacy and canonical controls",
    observer: "three real SSE clients sharing the production observer and event-store readers",
    admission: "spawned dashboard server with a paused TCP client at its configured maximum source size",
  },
  scenario: {
    idleWindowMs: IDLE_WINDOW_MS,
    legacyPollMs: LEGACY_POLL_MS,
    canonicalFallbackMs: CANONICAL_FALLBACK_MS,
    observerWindowMs: OBSERVER_WINDOW_MS,
    observerScanMs: OBSERVER_SCAN_MS,
    sourceBytes: SOURCE_BYTES,
    activeConsumers: CONSUMERS,
  },
  snapshots,
  observer,
  responseAdmission,
  reductionsPercent: {
    idleRequests: reduction(snapshots.idle.legacy.requests, snapshots.idle.canonical.requests),
    idleParses: reduction(snapshots.idle.legacy.parses, snapshots.idle.canonical.parses),
    idleResponseBodyBytes: reduction(snapshots.idle.legacy.responseBodyBytes, snapshots.idle.canonical.responseBodyBytes),
    publishBurstRequests: reduction(snapshots.publishBurst.legacy.requests, snapshots.publishBurst.canonical.requests),
    subscriberFilesystemScans: reduction(observer.legacy.totalFilesystemScans, observer.canonical.subscriberCatchupFilesystemScans),
  },
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1) {
  const requested = process.argv[outputIndex + 1];
  if (!requested || process.argv.length !== outputIndex + 2) throw new Error("Usage: measure-oven-snapshot-architecture.mjs [--output <path>]");
  atomicOutput(resolve(requested), serialized);
}
process.stdout.write(serialized);
