import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildPayload } from "../examples/differential-testing/adapter.mjs";
import {
  DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION,
  createDifferentialTestingOutboxDispatcher,
  createDifferentialTestingProjectionWorker,
  createDifferentialTestingRefreshQueue,
  createDifferentialTestingWorkerHandler,
  enqueueDifferentialTestingOutboxEvent,
  publishDifferentialTestingOvenBundle,
  stageDifferentialTestingOutboxEvent,
  promoteDifferentialTestingOutboxEvent,
} from "./differential-testing-adapter-sdk.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(join(here, "../examples/differential-testing/reference.json"), "utf8"));
const candidate = JSON.parse(readFileSync(join(here, "../examples/differential-testing/candidate.json"), "utf8"));

test("generic refresh queue serializes scenarios and discards superseded work", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-queue-"));
  const releases = [];
  const starts = [];
  const publications = [];
  let active = 0;
  let maxActive = 0;
  try {
    const queue = createDifferentialTestingRefreshQueue({
      root,
      stateSchema: "fixture-refresh-state@2",
      validateRequest: async ({ request }) => structuredClone(request.job),
      validateStoredJob() {},
      scenarioIdentity: (job) => ({ scenarioId: job.scenarioId, replay: job.replay }),
      assertCausalSuccessor({ current, candidate: next }) {
        if (current && next.parentRevision !== current.revision) {
          const error = new Error("not a causal successor");
          error.status = 409;
          throw error;
        }
      },
      runTelemetry: async ({ request }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        starts.push(request.requestId);
        await new Promise((resolveRelease) => releases.push(resolveRelease));
        active -= 1;
        return { exitCode: 0, staged: { requestId: request.requestId } };
      },
      publishTelemetry: ({ request }) => {
        publications.push(request.requestId);
        return { requestId: request.requestId };
      },
    });
    await queue.accept({ job: job("1111111111111111", "a", "1", "0") });
    await waitFor(() => queue.scenarioStatus("1111111111111111")?.status === "running");
    await queue.accept({ job: job("1111111111111111", "b", "2", "1") });
    await queue.accept({ job: job("1111111111111111", "c", "3", "2") });
    assert.equal((await queue.accept({ job: job("1111111111111111", "b", "2", "1") })).status, "already-accepted");
    await queue.accept({ job: job("2222222222222222", "d", "1", "0") });
    releases.shift()();
    await waitFor(() => starts.length === 2);
    releases.shift()();
    await waitFor(() => starts.length === 3);
    releases.shift()();
    await queue.idle();
    assert.deepEqual(starts, ["a", "d", "c"]);
    assert.deepEqual(publications, ["d", "c"]);
    assert.equal(maxActive, 1);
    assert.equal(queue.scenarioStatus("1111111111111111").status, "complete");
    assert.equal(queue.scenarioStatus("1111111111111111").publication.requestId, "c");
    assert.equal((await queue.accept({ job: job("1111111111111111", "b", "2", "1") })).status, "already-accepted");
    await queue.idle();
    queue.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic refresh queue automatically restores interrupted work and rejects invalid persisted state", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-restart-"));
  try {
    let runs = 0;
    const options = {
      root,
      stateSchema: "fixture-refresh-state@2",
      validateRequest: async ({ request }) => structuredClone(request.job),
      validateStoredJob() {},
      scenarioIdentity: (entry) => ({ scenarioId: entry.scenarioId }),
      runTelemetry: async ({ request }) => {
        runs += 1;
        return { exitCode: 0, staged: { requestId: request.requestId } };
      },
      publishTelemetry: ({ request }) => ({ requestId: request.requestId }),
    };
    const first = createDifferentialTestingRefreshQueue(options);
    await first.accept({ job: job("1111111111111111", "a", "1", "0") });
    await first.idle();
    const state = JSON.parse(await readFile(first.statePath, "utf8"));
    state.scenarios["1111111111111111"].status = "running";
    state.scenarios["1111111111111111"].publication = null;
    state.scenarios["1111111111111111"].startedAt = new Date().toISOString();
    state.activeJobId = "interrupted";
    first.close();
    await writeFile(first.statePath, `${JSON.stringify(state)}\n`);
    const resumed = createDifferentialTestingRefreshQueue(options);
    await resumed.idle();
    assert.equal(runs, 2);
    assert.equal(resumed.scenarioStatus("1111111111111111").status, "complete");
    assert.equal((await resumed.accept({ job: job("1111111111111111", "a", "1", "0") })).status, "already-accepted");
    await resumed.idle();
    resumed.close();

    state.schema = "fixture-refresh-state@1";
    await writeFile(first.statePath, `${JSON.stringify(state)}\n`);
    assert.throws(() => createDifferentialTestingRefreshQueue(options), /Invalid Differential Testing refresh state: shape mismatch/u);
    state.schema = "fixture-refresh-state@2";
    state.cadenceFrames = 10;
    await writeFile(first.statePath, `${JSON.stringify(state)}\n`);
    assert.throws(() => createDifferentialTestingRefreshQueue(options), /Invalid Differential Testing refresh state: shape mismatch/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh queue selects an existing scenario and invalidates projection without scheduling telemetry", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-selection-"));
  const invalidations = [];
  let runs = 0;
  try {
    const queue = createDifferentialTestingRefreshQueue({
      root,
      stateSchema: "fixture-refresh-state@2",
      validateRequest: async ({ request }) => structuredClone(request.job),
      validateStoredJob() {},
      scenarioIdentity: (entry) => ({ scenarioId: entry.scenarioId }),
      runTelemetry: async ({ request }) => {
        runs += 1;
        return { exitCode: 0, staged: { requestId: request.requestId } };
      },
      publishTelemetry: ({ request }) => ({ requestId: request.requestId }),
      invalidateProjection: (entry) => invalidations.push(entry),
    });
    await queue.accept({ job: job("1111111111111111", "a", "1", "0") });
    await queue.accept({ job: job("2222222222222222", "b", "1", "0") });
    await queue.idle();
    const runsBeforeSelection = runs;
    const revisionBeforeSelection = queue.snapshot().revision;

    const selected = queue.selectScenario("1111111111111111");
    assert.equal(selected.selectedScenarioId, "1111111111111111");
    assert.equal(selected.revision, revisionBeforeSelection + 1);
    const selectedAgain = queue.selectScenario("1111111111111111");
    assert.equal(selectedAgain.revision, selected.revision + 1);
    assert.equal(queue.snapshot().selectedScenarioId, "1111111111111111");
    assert.equal(runs, runsBeforeSelection);
    assert.deepEqual(invalidations.slice(-2).map((entry) => entry.reason), ["scenario-selected", "scenario-selected"]);
    assert.throws(
      () => queue.selectScenario("3333333333333333"),
      (error) => error?.status === 404,
    );
    queue.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic refresh queue locks one store and fails closed on malformed callbacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-hardening-"));
  const base = {
    root,
    stateSchema: "fixture-refresh-state@2",
    validateRequest: async ({ request }) => structuredClone(request.job),
    validateStoredJob() {},
    scenarioIdentity: (entry) => ({ scenarioId: entry.scenarioId }),
    runTelemetry: async () => undefined,
    publishTelemetry: ({ request }) => ({ requestId: request.requestId }),
    classifyTelemetryError: () => "permanent",
  };
  try {
    const queue = createDifferentialTestingRefreshQueue(base);
    assert.throws(() => createDifferentialTestingRefreshQueue(base), (error) => error?.code === "ELOCKED");
    await queue.accept({ job: job("1111111111111111", "a", "1", "0") });
    await queue.idle();
    assert.equal(queue.scenarioStatus("1111111111111111").status, "failed");
    assert.match(queue.scenarioStatus("1111111111111111").error, /runTelemetry must return/u);
    queue.close();

    assert.throws(() => createDifferentialTestingRefreshQueue({
      ...base,
      runTelemetry: async ({ request }) => ({ exitCode: 0, staged: { requestId: request.requestId } }),
      invalidateProjection: async () => {},
    }), /invalidateProjection must be synchronous/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic refresh queue rejects symlinked stores", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "burnlist-adapter-outside-"));
  try {
    await mkdir(join(root, ".local"), { recursive: true });
    await symlink(outside, join(root, ".local", "differential-testing"));
    assert.throws(() => createDifferentialTestingRefreshQueue({
      root,
      validateRequest: async ({ request }) => request.job,
      validateStoredJob() {},
      runTelemetry: async () => ({ exitCode: 0, staged: {} }),
      publishTelemetry: () => ({ requestId: "fixture" }),
    }), /contains a symlink/u);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("SDK v2 refresh queue times out telemetry, retries transient failures, and invalidates projection durably", async () => {
  assert.equal(DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION, 2);
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-retry-"));
  const invalidations = [];
  let runs = 0;
  let activeTimedOutRuns = 0;
  try {
    const queue = createDifferentialTestingRefreshQueue({
      root,
      stateSchema: "fixture-refresh-state@2",
      validateRequest: async ({ request }) => structuredClone(request.job),
      validateStoredJob() {},
      scenarioIdentity: (entry) => ({ scenarioId: entry.scenarioId }),
      assertCausalSuccessor({ current, candidate }) {
        if (current === null && candidate.revision !== "1") throw new Error("initial request required");
      },
      runTelemetry: async ({ request, signal }) => {
        runs += 1;
        if (runs === 1) {
          activeTimedOutRuns += 1;
          await new Promise((resolveWait, rejectWait) => {
            signal.addEventListener("abort", () => {
              setTimeout(() => {
                activeTimedOutRuns -= 1;
                rejectWait(new Error("aborted"));
              }, 5);
            }, { once: true });
          });
        }
        return { exitCode: 0, staged: { requestId: request.requestId } };
      },
      publishTelemetry: ({ request }) => ({ requestId: request.requestId }),
      invalidateProjection: (value) => invalidations.push(value),
      telemetryTimeoutMs: 5,
      telemetryAbortGraceMs: 50,
      telemetryRetryBaseMs: 1,
      telemetryRetryMaxMs: 2,
    });
    await queue.accept({ job: job("1111111111111111", "a", "1", "0") });
    await queue.idle();
    assert.equal(runs, 2);
    assert.equal(queue.scenarioStatus("1111111111111111").status, "complete");
    assert.equal(queue.scenarioStatus("1111111111111111").attempts, 2);
    assert.equal(activeTimedOutRuns, 0);
    assert.ok(invalidations.some((entry) => entry.reason === "request-accepted"));
    assert.ok(invalidations.some((entry) => entry.reason === "telemetry-transition"));
    queue.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh queue terminates transient telemetry after the configured attempt budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-retry-exhaustion-"));
  let runs = 0;
  try {
    const queue = createDifferentialTestingRefreshQueue({
      root,
      stateSchema: "fixture-refresh-state@2",
      validateRequest: async ({ request }) => structuredClone(request.job),
      validateStoredJob() {},
      scenarioIdentity: (entry) => ({ scenarioId: entry.scenarioId }),
      async runTelemetry() {
        runs += 1;
        throw new Error("runner unavailable");
      },
      publishTelemetry: ({ request }) => ({ requestId: request.requestId }),
      telemetryMaxAttempts: 2,
      telemetryRetryBaseMs: 1,
      telemetryRetryMaxMs: 1,
    });
    await queue.accept({ job: job("1111111111111111", "a", "1", "0") });
    await queue.idle();
    const scenario = queue.scenarioStatus("1111111111111111");
    assert.equal(runs, 2);
    assert.equal(scenario.status, "failed");
    assert.equal(scenario.attempts, 2);
    assert.match(scenario.error, /runner unavailable.*retry exhausted after 2 attempts/u);
    queue.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem outbox stages raw events and dispatcher sorts, retries, acknowledges, and rejects", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-outbox-"));
  const firstId = "1".repeat(64);
  const secondId = "2".repeat(64);
  const rejectedId = "3".repeat(64);
  const calls = [];
  let firstAttempts = 0;
  let dispatcher = null;
  let resumed = null;
  try {
    const first = outboxEvent(firstId, "2026-01-01T00:00:00.000Z");
    const second = outboxEvent(secondId, "2026-01-01T00:00:01.000Z");
    const rejected = outboxEvent(rejectedId, "2026-01-01T00:00:02.000Z");
    assert.equal(stageDifferentialTestingOutboxEvent({ root, event: second }).status, "staged");
    assert.equal(promoteDifferentialTestingOutboxEvent({ root, requestId: secondId }).status, "queued");
    assert.equal(enqueueDifferentialTestingOutboxEvent({ root, event: first }).status, "queued");
    assert.equal(enqueueDifferentialTestingOutboxEvent({ root, event: first }).status, "already-queued");
    assert.equal(enqueueDifferentialTestingOutboxEvent({ root, event: rejected }).status, "queued");

    dispatcher = createDifferentialTestingOutboxDispatcher({
      root,
      retryBaseMs: 20,
      retryMaxMs: 20,
      pollIntervalMs: 1,
      maxAcknowledgedEvents: 1,
      maxRejectedEvents: 1,
      async deliver(event, context) {
        calls.push(event.requestId);
        assert.match(context.eventSha256, /^[a-f0-9]{64}$/u);
        assert.ok(context.eventPath.endsWith(`${event.requestId}.json`));
        if (event.requestId === firstId && firstAttempts++ === 0) throw new Error("temporary delivery failure");
        if (event.requestId === rejectedId) {
          const error = new Error("invalid event");
          error.permanent = true;
          throw error;
        }
      },
    });
    dispatcher.start();
    await dispatcher.idle();
    assert.equal(calls[0], firstId);
    assert.ok(calls.indexOf(secondId) < calls.indexOf(rejectedId));
    assert.equal(calls.filter((id) => id === firstId).length, 2);
    assert.equal(dispatcher.snapshot().entries[firstId], undefined);
    const acknowledged = await readdir(join(root, ".local", "differential-testing", "outbox", "acked"));
    assert.equal(acknowledged.length, 1);
    const acknowledgedId = acknowledged[0].replace(/\.json$/u, "");
    assert.equal(enqueueDifferentialTestingOutboxEvent({ root, event: acknowledgedId === firstId ? first : second }).status, "already-acked");
    assert.equal(enqueueDifferentialTestingOutboxEvent({ root, event: rejected }).status, "already-rejected");
    dispatcher.close();
    dispatcher = null;

    resumed = createDifferentialTestingOutboxDispatcher({ root, async deliver() {} });
    assert.deepEqual(resumed.snapshot().entries, {});
    resumed.close();
    resumed = null;
  } finally {
    try { dispatcher?.close(); } catch {}
    try { resumed?.close(); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});

test("outbox persists in-flight delivery as immediately retryable", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-outbox-in-flight-"));
  const requestId = "9".repeat(64);
  const attemptedAt = "2026-01-01T00:00:05.000Z";
  let releaseDelivery;
  const delivery = new Promise((resolveDelivery) => { releaseDelivery = resolveDelivery; });
  let dispatcher = null;
  try {
    enqueueDifferentialTestingOutboxEvent({ root, event: outboxEvent(requestId, "2026-01-01T00:00:00.000Z") });
    dispatcher = createDifferentialTestingOutboxDispatcher({
      root,
      now: () => attemptedAt,
      async deliver() { await delivery; },
    });
    dispatcher.start();
    await waitFor(() => dispatcher.snapshot().entries[requestId]?.attempts === 1);
    const persisted = JSON.parse(await readFile(dispatcher.statePath, "utf8"));
    assert.equal(persisted.entries[requestId].lastAttemptAt, attemptedAt);
    assert.equal(persisted.entries[requestId].nextAttemptAt, attemptedAt);
    assert.ok(Number.isFinite(Date.parse(persisted.entries[requestId].nextAttemptAt)));
    releaseDelivery();
    await dispatcher.idle();
    dispatcher.close();
    dispatcher = null;
  } finally {
    releaseDelivery?.();
    try { dispatcher?.close(); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});

test("outbox and projection retry state resume after worker restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-retry-restart-"));
  const requestId = "4".repeat(64);
  try {
    enqueueDifferentialTestingOutboxEvent({ root, event: outboxEvent(requestId, "2026-01-01T00:00:00.000Z") });
    const firstDispatcher = createDifferentialTestingOutboxDispatcher({
      root,
      retryBaseMs: 20,
      retryMaxMs: 20,
      pollIntervalMs: 1,
      async deliver() { throw new Error("offline"); },
    });
    firstDispatcher.start();
    await waitFor(() => firstDispatcher.snapshot().entries[requestId]?.lastError === "offline");
    const persistedNextAttempt = firstDispatcher.snapshot().entries[requestId].nextAttemptAt;
    firstDispatcher.close();

    let delivered = 0;
    const resumedDispatcher = createDifferentialTestingOutboxDispatcher({
      root,
      retryBaseMs: 20,
      retryMaxMs: 20,
      pollIntervalMs: 1,
      async deliver() { delivered += 1; },
    });
    assert.equal(resumedDispatcher.snapshot().entries[requestId].nextAttemptAt, persistedNextAttempt);
    resumedDispatcher.start();
    await resumedDispatcher.idle();
    assert.equal(delivered, 1);
    resumedDispatcher.close();

    const firstProjection = createDifferentialTestingProjectionWorker({
      root,
      retryBaseMs: 20,
      retryMaxMs: 20,
      async publish() { throw new Error("offline"); },
    });
    firstProjection.invalidate({ revision: "1", reason: "fixture" });
    firstProjection.start();
    await waitFor(() => firstProjection.snapshot().status === "retrying");
    const projectionNextAttempt = firstProjection.snapshot().nextAttemptAt;
    firstProjection.close();

    let projected = 0;
    const resumedProjection = createDifferentialTestingProjectionWorker({
      root,
      retryBaseMs: 20,
      retryMaxMs: 20,
      async publish() { projected += 1; },
    });
    assert.equal(resumedProjection.snapshot().status, "retrying");
    assert.equal(resumedProjection.snapshot().nextAttemptAt, projectionNextAttempt);
    resumedProjection.start();
    await resumedProjection.idle();
    assert.equal(projected, 1);
    assert.equal(resumedProjection.snapshot().status, "complete");
    resumedProjection.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projection worker coalesces invalidations and retries publication without blocking invalidation", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-projection-"));
  const calls = [];
  const releases = [];
  let failures = 1;
  try {
    const projection = createDifferentialTestingProjectionWorker({
      root,
      retryBaseMs: 1,
      retryMaxMs: 2,
      async publish(request) {
        calls.push(request);
        if (failures-- > 0) throw new Error("temporary projection failure");
        if (request.revision === "1") await new Promise((resolveRelease) => releases.push(resolveRelease));
      },
    });
    projection.invalidate({ revision: "1", reason: "refresh-state", scenarioId: "1111111111111111" });
    projection.start();
    await waitFor(() => calls.length === 2);
    projection.invalidate({ revision: "2", reason: "session-published", scenarioId: "1111111111111111" });
    projection.invalidate({ revision: "2", reason: "telemetry-complete", scenarioId: "1111111111111111" });
    releases.shift()();
    await projection.idle();
    assert.deepEqual(calls.map((entry) => entry.revision), ["1", "1", "2"]);
    assert.deepEqual(calls[2].reasons, ["session-published", "telemetry-complete"]);
    assert.equal(projection.snapshot().status, "complete");
    assert.equal(projection.snapshot().published.revision, "2");
    projection.close();

    const resumed = createDifferentialTestingProjectionWorker({ root, async publish() {} });
    assert.equal(resumed.snapshot().status, "complete");
    resumed.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic Oven publisher validates and atomically switches a scenario bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-publisher-"));
  try {
    const outputRoot = join(root, "burnlist");
    const populatedReference = structuredClone(reference);
    populatedReference.fields = [{ id: "position", label: "Position", sourceOwner: "fixture", meaning: "Fixture position", unit: "m", tolerance: 0.001 }];
    populatedReference.samples = [{ tick: 0, values: { position: 0 } }];
    const populatedCandidate = structuredClone(candidate);
    populatedCandidate.samples = [{ tick: 0, values: { position: 0.1 } }];
    const payload = buildPayload(populatedReference, populatedCandidate);
    const scenarioId = payload.scenarioCatalog.selectedScenarioId;
    const published = publishDifferentialTestingOvenBundle({
      outputRoot,
      currentPayload: payload,
      scenarioPayloads: new Map([[scenarioId, payload]]),
    });
    assert.equal(published.scenarioCount, 1);
    assert.equal((await lstat(outputRoot)).isSymbolicLink(), true);
    const currentBytes = await readFile(join(outputRoot, "current.json"), "utf8");
    const scenarioBytes = await readFile(join(outputRoot, "scenarios", `${scenarioId}.json`), "utf8");
    assert.equal(currentBytes, `${JSON.stringify(payload)}\n`);
    assert.equal(scenarioBytes, `${JSON.stringify(payload)}\n`);
    assert.deepEqual(JSON.parse(currentBytes), payload);
    assert.deepEqual(JSON.parse(scenarioBytes), payload);

    const secondScenarioId = "fedcba9876543210";
    const catalog = [payload.scenarioCatalog.scenarios[0], { ...payload.scenarioCatalog.scenarios[0], id: secondScenarioId, label: "Second scenario" }];
    const selectedPayload = payloadForScenario(payload, scenarioId, catalog);
    const secondPayload = payloadForScenario(payload, secondScenarioId, catalog);
    assert.throws(() => publishDifferentialTestingOvenBundle({
      outputRoot: join(root, "incomplete-burnlist"),
      currentPayload: selectedPayload,
      scenarioPayloads: new Map([[scenarioId, selectedPayload]]),
    }), /exactly match the published catalog/u);
    const complete = publishDifferentialTestingOvenBundle({
      outputRoot: join(root, "complete-burnlist"),
      currentPayload: selectedPayload,
      scenarioPayloads: new Map([[scenarioId, selectedPayload], [secondScenarioId, secondPayload]]),
    });
    assert.equal(complete.scenarioCount, 2);

    const wrongCurrent = structuredClone(payload);
    wrongCurrent.title = "A different projection";
    assert.throws(() => publishDifferentialTestingOvenBundle({
      outputRoot,
      currentPayload: wrongCurrent,
      scenarioPayloads: new Map([[scenarioId, payload]]),
    }), /currentPayload must equal the selected scenario payload/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic worker handler exposes bounded health, status, and submission routes", async () => {
  const accepted = [];
  const queue = {
    snapshot: () => ({ selectedScenarioId: null, scenarios: {} }),
    scenarioStatus: (scenarioId) => ({ scenarioId, status: "queued" }),
    async accept(request) {
      if (request.reject) {
        const error = new Error("rejected");
        error.status = 200;
        throw error;
      }
      accepted.push(request);
      return { status: "queued" };
    },
  };
  const server = createServer(createDifferentialTestingWorkerHandler({ queue, serviceName: "fixture-worker", maxBodyBytes: 64 }));
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${origin}/health`);
    assert.deepEqual(await health.json(), { status: "ok", service: "fixture-worker" });
    const status = await fetch(`${origin}/api/status?scenario=1111111111111111`);
    assert.deepEqual(await status.json(), { scenarioId: "1111111111111111", refresh: { scenarioId: "1111111111111111", status: "queued" } });
    const submission = await fetch(`${origin}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "fixture" }) });
    assert.equal(submission.status, 202);
    assert.deepEqual(accepted, [{ id: "fixture" }]);
    const retired = await fetch(`${origin}/api/improvements`, { method: "POST", body: JSON.stringify({ id: "retired" }) });
    assert.equal(retired.status, 404);
    const falseSuccess = await fetch(`${origin}/api/events`, { method: "POST", body: JSON.stringify({ reject: true }) });
    assert.equal(falseSuccess.status, 500);
    const oversized = await fetch(`${origin}/api/events`, { method: "POST", body: JSON.stringify({ value: "x".repeat(100) }) });
    assert.equal(oversized.status, 413);
  } finally {
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
});

function job(scenarioId, requestId, revision, parentRevision) {
  return {
    requestId,
    requestedAt: new Date().toISOString(),
    scenarioId,
    revision,
    parentRevision,
    replay: `${scenarioId}.json`,
  };
}

function outboxEvent(requestId, requestedAt) {
  return {
    schema: "fixture-differential-testing-event@1",
    requestId,
    requestedAt,
    scenarioId: requestId.slice(0, 16),
    kind: "session-published",
  };
}

function payloadForScenario(source, scenarioId, catalog) {
  const payload = structuredClone(source);
  payload.scenarioCatalog = { selectedScenarioId: scenarioId, scenarios: structuredClone(catalog) };
  payload.refresh.scenarioId = scenarioId;
  payload.refresh.report.scenarioId = scenarioId;
  for (const row of payload.progress) row.scenarioId = scenarioId;
  for (const row of payload.log) row.scenarioId = scenarioId;
  return payload;
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for queue state");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
}
