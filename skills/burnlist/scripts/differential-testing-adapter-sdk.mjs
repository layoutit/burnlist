import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { assertDifferentialTestingData } from "./differential-testing-data-contract.mjs";

export const DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION = 2;
export const DIFFERENTIAL_TESTING_OUTBOX_DISPATCHER_STATE_SCHEMA = "burnlist-differential-testing-outbox-dispatcher-state@1";
export const DIFFERENTIAL_TESTING_PROJECTION_STATE_SCHEMA = "burnlist-differential-testing-projection-state@1";
const scenarioIdPattern = /^[a-f0-9]{16}$/u;
const requestIdPattern = /^[a-f0-9]{64}$/u;
const refreshStatuses = new Set(["queued", "running", "complete", "failed"]);

export function createDifferentialTestingRefreshQueue({
  root = process.cwd(),
  storeDirectory = ".local/differential-testing",
  stateSchema = "project-differential-testing-refresh-state@2",
  validateRequest,
  runTelemetry,
  publishTelemetry,
  scenarioIdentity = (job) => ({ scenarioId: job.scenarioId }),
  assertCausalSuccessor = () => {},
  validateStoredJob,
  invalidateProjection = null,
  classifyTelemetryError = () => "transient",
  now = () => new Date().toISOString(),
  maxScenarios = 256,
  maxJobBytes = 128 * 1024,
  maxAcceptedRequestIds = 256,
  telemetryTimeoutMs = 5 * 60_000,
  telemetryAbortGraceMs = 5_000,
  telemetryMaxAttempts = 5,
  telemetryRetryBaseMs = 1_000,
  telemetryRetryMaxMs = 30_000,
} = {}) {
  if (typeof validateRequest !== "function") throw new Error("validateRequest is required.");
  if (typeof runTelemetry !== "function") throw new Error("runTelemetry is required.");
  if (typeof publishTelemetry !== "function") throw new Error("publishTelemetry is required.");
  if (typeof scenarioIdentity !== "function") throw new Error("scenarioIdentity must be a function.");
  if (typeof assertCausalSuccessor !== "function") throw new Error("assertCausalSuccessor must be a function.");
  if (typeof validateStoredJob !== "function") throw new Error("validateStoredJob must be a function.");
  if (invalidateProjection !== null && typeof invalidateProjection !== "function") throw new Error("invalidateProjection must be a function or null.");
  if (typeof classifyTelemetryError !== "function") throw new Error("classifyTelemetryError must be a function.");
  if (typeof stateSchema !== "string" || !stateSchema.trim()) throw new Error("stateSchema must be a non-empty string.");
  for (const [value, label] of [[maxScenarios, "maxScenarios"], [maxJobBytes, "maxJobBytes"], [maxAcceptedRequestIds, "maxAcceptedRequestIds"]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  }
  for (const [value, label] of [[telemetryTimeoutMs, "telemetryTimeoutMs"], [telemetryAbortGraceMs, "telemetryAbortGraceMs"], [telemetryMaxAttempts, "telemetryMaxAttempts"], [telemetryRetryBaseMs, "telemetryRetryBaseMs"], [telemetryRetryMaxMs, "telemetryRetryMaxMs"]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  }
  if (telemetryRetryMaxMs < telemetryRetryBaseMs) throw new Error("telemetryRetryMaxMs must be at least telemetryRetryBaseMs.");

  const repoRoot = resolve(root);
  const storeRoot = containedPath(repoRoot, storeDirectory, "store directory");
  assertNoSymlinkComponents(repoRoot, storeRoot, "store directory");
  mkdirSync(storeRoot, { recursive: true });
  assertNoSymlinkComponents(repoRoot, storeRoot, "store directory");
  const releaseStoreLock = acquireStoreLock(storeRoot);
  const statePath = resolve(storeRoot, "refresh-state.json");
  const scratchRoot = resolve(storeRoot, ".scratch");
  mkdirSync(scratchRoot, { recursive: true });
  let state;
  try {
    state = loadState(statePath, { stateSchema, validateStoredJob, maxJobBytes, maxAcceptedRequestIds, maxScenarios });
  } catch (error) {
    releaseStoreLock();
    throw error;
  }
  let scheduled = false;
  let scheduleTimer = null;
  let workerPromise = null;
  let closed = false;

  try {
    for (const [scenarioId, scenario] of Object.entries(state.scenarios)) {
      if (scenario.status !== "running") continue;
      scenario.status = "queued";
      scenario.startedAt = null;
      scenario.error = null;
      scenario.nextAttemptAt = now();
      if (!state.queue.includes(scenarioId)) state.queue.push(scenarioId);
    }
    state.activeJobId = null;
    persist("worker-started");
  } catch (error) {
    releaseStoreLock();
    throw error;
  }

  const api = {
    statePath,
    snapshot: () => structuredClone(state),
    scenarioStatus: (scenarioId) => structuredClone(state.scenarios[String(scenarioId || "")] ?? null),
    selectScenario(scenarioId) {
      if (closed) throw new Error("Differential Testing refresh queue is closed.");
      const selectedScenarioId = String(scenarioId || "");
      assertScenarioId(selectedScenarioId);
      if (!state.scenarios[selectedScenarioId]) {
        const error = new Error(`Differential Testing scenario is not registered: ${selectedScenarioId}`);
        error.status = 404;
        throw error;
      }
      const timestamp = now();
      assertTimestamp(timestamp, "scenario selection timestamp");
      state.selectedScenarioId = selectedScenarioId;
      bumpAndPersist("scenario-selected", timestamp);
      return { selectedScenarioId, revision: state.revision, updatedAt: state.updatedAt };
    },
    async accept(request) {
      if (closed) throw new Error("Differential Testing refresh queue is closed.");
      const job = await validateRequest({ root: repoRoot, storeDirectory: storeRoot, request });
      assertJobEnvelope(job, { maxJobBytes });
      callSync(validateStoredJob, job, "validateStoredJob");
      const existing = state.scenarios[job.scenarioId] ?? null;
      if (existing && new Set(existing.acceptedRequestIds).has(job.requestId)) {
        requestProjection("duplicate-accepted");
        return { status: "already-accepted", scenario: structuredClone(existing) };
      }
      callSync(assertCausalSuccessor, {
        current: existing?.pendingRequest ?? existing?.request ?? null,
        candidate: job,
        scenario: existing ? structuredClone(existing) : null,
      }, "assertCausalSuccessor");
      const timestamp = now();
      assertTimestamp(timestamp, "now()");
      state.selectedScenarioId = job.scenarioId;
      if (!existing) {
        if (Object.keys(state.scenarios).length >= maxScenarios) throw new Error(`Differential Testing refresh queue exceeds ${maxScenarios} scenarios.`);
        state.scenarios[job.scenarioId] = initialScenarioState(job, callSync(scenarioIdentity, job, "scenarioIdentity"), timestamp);
        state.queue.push(job.scenarioId);
      } else if (existing.status === "running") {
        recordAcceptedRequestId(existing, job.requestId, maxAcceptedRequestIds);
        existing.pendingRequest = job;
        existing.coalescedCount = Number(existing.coalescedCount || 0) + 1;
        existing.updatedAt = timestamp;
      } else {
        recordAcceptedRequestId(existing, job.requestId, maxAcceptedRequestIds);
        Object.assign(existing, {
          status: "queued",
          request: job,
          pendingRequest: null,
          requestedAt: job.requestedAt,
          startedAt: null,
          finishedAt: null,
          error: null,
          attempts: 0,
          nextAttemptAt: timestamp,
          updatedAt: timestamp,
        });
        if (!state.queue.includes(job.scenarioId)) state.queue.push(job.scenarioId);
      }
      bumpAndPersist("request-accepted", timestamp);
      schedule({ replace: true });
      return { status: state.scenarios[job.scenarioId].status, scenario: structuredClone(state.scenarios[job.scenarioId]) };
    },
    start: () => schedule({ replace: true }),
    async idle() {
      while (scheduled || workerPromise) {
        if (workerPromise) await workerPromise;
        else await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
      }
    },
    close() {
      if (scheduled || workerPromise) throw new Error("Cannot close a busy Differential Testing refresh queue.");
      if (closed) return;
      closed = true;
      if (scheduleTimer) clearTimeout(scheduleTimer);
      scheduleTimer = null;
      releaseStoreLock();
    },
  };

  if (state.queue.length > 0) schedule();
  return api;

  function schedule({ replace = false } = {}) {
    if (closed || workerPromise || state.queue.length === 0) return;
    if (scheduled && !replace) return;
    const delay = nextQueueDelay(state, now());
    if (delay === null) return;
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduled = true;
    scheduleTimer = setTimeout(() => {
      scheduleTimer = null;
      scheduled = false;
      if (closed) return;
      if (workerPromise || state.queue.length === 0) return;
      workerPromise = drain().finally(() => {
        workerPromise = null;
        if (state.queue.length > 0) schedule();
      });
    }, delay);
  }

  async function drain() {
    while (state.queue.length > 0) {
      const queueIndex = nextDueQueueIndex(state, now());
      if (queueIndex < 0) return;
      const [scenarioId] = state.queue.splice(queueIndex, 1);
      const scenario = state.scenarios[scenarioId];
      if (!scenario || scenario.status !== "queued" || !scenario.request) continue;
      const request = scenario.request;
      const runId = randomUUID();
      const scratchDirectory = containedPath(scratchRoot, runId, "scratch directory");
      assertNoSymlinkComponents(storeRoot, scratchRoot, "scratch root");
      mkdirSync(scratchDirectory, { recursive: true });
      assertNoSymlinkComponents(storeRoot, scratchDirectory, "scratch directory");
      Object.assign(scenario, {
        status: "running",
        startedAt: now(),
        finishedAt: null,
        error: null,
        attempts: Math.min(Number.MAX_SAFE_INTEGER, Number(scenario.attempts || 0) + 1),
        nextAttemptAt: null,
        run: { id: runId, scratchDirectory: displayPath(repoRoot, scratchDirectory) },
      });
      state.activeJobId = runId;
      bumpAndPersist();
      let preserveScratch = false;
      try {
        const staged = await runWithTimeout(runTelemetry, {
          root: repoRoot,
          storeDirectory: storeRoot,
          scratchDirectory,
          request,
        }, telemetryTimeoutMs, telemetryAbortGraceMs);
        if (scenario.pendingRequest) {
          queuePendingSuccessor(state, scenarioId, scenario, { superseded: true }, now());
        } else {
          assertTelemetryStage(staged);
          const publication = callSync(publishTelemetry, {
            root: repoRoot,
            storeDirectory: storeRoot,
            scratchDirectory,
            request,
            staged: staged.staged,
          }, "publishTelemetry");
          assertPublication(publication, request.requestId);
          scenario.status = "complete";
          scenario.finishedAt = now();
          scenario.nextAttemptAt = null;
          scenario.publication = publication;
          scenario.run = { ...scenario.run, exitCode: staged.exitCode };
        }
      } catch (error) {
        preserveScratch = error?.preserveScratch === true;
        if (scenario.pendingRequest) {
          queuePendingSuccessor(state, scenarioId, scenario, { superseded: true, discardedError: error?.message ?? String(error) }, now());
        } else {
          const classification = callSync(classifyTelemetryError, error, "classifyTelemetryError");
          if (!["transient", "permanent"].includes(classification)) {
            throw new Error("classifyTelemetryError must return transient or permanent.");
          }
          scenario.error = error?.message ?? String(error);
          scenario.run = { ...scenario.run, exitCode: error?.exitCode ?? null };
          if (classification === "permanent" || scenario.attempts >= telemetryMaxAttempts) {
            scenario.status = "failed";
            scenario.finishedAt = now();
            scenario.nextAttemptAt = null;
            if (classification !== "permanent") {
              scenario.error = `${scenario.error} Telemetry retry exhausted after ${scenario.attempts} attempts.`;
            }
          } else {
            scenario.status = "queued";
            scenario.startedAt = null;
            scenario.finishedAt = null;
            scenario.nextAttemptAt = timestampAfter(now(), retryDelay(scenario.attempts, telemetryRetryBaseMs, telemetryRetryMaxMs));
            if (!state.queue.includes(scenarioId)) state.queue.push(scenarioId);
          }
        }
      } finally {
        state.activeJobId = null;
        if (!preserveScratch) rmSync(scratchDirectory, { recursive: true, force: true });
        bumpAndPersist("telemetry-transition");
      }
    }
  }

  function bumpAndPersist(reason = "refresh-state", timestamp = now()) {
    assertTimestamp(timestamp, "state timestamp");
    state.revision += 1;
    state.updatedAt = timestamp;
    persist(reason);
  }

  function persist(reason = "refresh-state") {
    writeJsonAtomic(statePath, state);
    for (const [scenarioId, scenario] of Object.entries(state.scenarios)) {
      const scenarioDirectory = resolve(storeRoot, "scenarios", scenarioId);
      mkdirSync(scenarioDirectory, { recursive: true });
      assertNoSymlinkComponents(storeRoot, scenarioDirectory, "scenario state directory");
      writeJsonAtomic(resolve(scenarioDirectory, "run-state.json"), scenario);
    }
    requestProjection(reason);
  }

  function requestProjection(reason) {
    if (typeof invalidateProjection !== "function") return;
    callSync(invalidateProjection, {
      revision: String(state.revision),
      reason,
      scenarioId: state.selectedScenarioId,
    }, "invalidateProjection");
  }
}

export function stageDifferentialTestingOutboxEvent(options = {}) {
  const paths = differentialTestingOutboxPaths(options);
  const maxEventBytes = positiveLimit(options.maxEventBytes ?? 128 * 1024, "maxEventBytes");
  const event = assertDifferentialTestingOutboxEvent(options.event, maxEventBytes);
  ensureOutboxDirectories(paths);
  const existing = existingOutboxEvent(paths, event.requestId, event, maxEventBytes);
  if (existing) return existing;
  const stagedPath = resolve(paths.staged, `${event.requestId}.json`);
  const created = writeJsonExclusiveAtomic(stagedPath, event, { compact: true });
  if (!created) return existingOutboxEvent(paths, event.requestId, event, maxEventBytes);
  return { status: "staged", requestId: event.requestId, eventPath: stagedPath };
}

export function promoteDifferentialTestingOutboxEvent(options = {}) {
  const paths = differentialTestingOutboxPaths(options);
  const maxEventBytes = positiveLimit(options.maxEventBytes ?? 128 * 1024, "maxEventBytes");
  ensureOutboxDirectories(paths);
  const requestId = requiredRequestId(options.requestId);
  const stagedPath = resolve(paths.staged, `${requestId}.json`);
  if (!existsSync(stagedPath)) {
    const existing = existingOutboxEvent(paths, requestId, null, maxEventBytes, { includeStaged: false });
    if (existing) return existing;
    throw new Error(`Differential Testing outbox event is not staged: ${requestId}`);
  }
  const event = readOutboxEvent(stagedPath, maxEventBytes);
  if (event.requestId !== requestId) throw new Error(`Differential Testing outbox filename does not match requestId: ${requestId}`);
  const existing = existingOutboxEvent(paths, requestId, event, maxEventBytes, { includeStaged: false });
  if (existing) {
    rmSync(stagedPath, { force: true });
    fsyncDirectory(paths.staged);
    return existing;
  }
  const pendingPath = resolve(paths.pending, `${requestId}.json`);
  try {
    linkSync(stagedPath, pendingPath);
    fsyncDirectory(paths.pending);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    assertSameOutboxEvent(pendingPath, event, maxEventBytes);
  }
  rmSync(stagedPath, { force: true });
  fsyncDirectory(paths.staged);
  return { status: "queued", requestId, eventPath: pendingPath };
}

export function enqueueDifferentialTestingOutboxEvent(options = {}) {
  const staged = stageDifferentialTestingOutboxEvent(options);
  if (!["staged", "already-staged"].includes(staged.status)) return staged;
  return promoteDifferentialTestingOutboxEvent({ ...options, requestId: staged.requestId });
}

export function createDifferentialTestingOutboxDispatcher({
  root = process.cwd(),
  outboxDirectory = ".local/differential-testing/outbox",
  stagedDirectory = "staged",
  pendingDirectory = "pending",
  acknowledgedDirectory = "acked",
  rejectedDirectory = "rejected",
  statePath = null,
  deliver,
  validateEvent = () => {},
  classifyDeliveryError = (error) => error?.permanent === true ? "permanent" : "transient",
  now = () => new Date().toISOString(),
  retryBaseMs = 250,
  retryMaxMs = 30_000,
  pollIntervalMs = 250,
  maxEventBytes = 128 * 1024,
  maxAcknowledgedEvents = 256,
  maxRejectedEvents = 256,
} = {}) {
  if (typeof deliver !== "function") throw new Error("deliver is required.");
  if (typeof validateEvent !== "function") throw new Error("validateEvent must be a function.");
  if (typeof classifyDeliveryError !== "function") throw new Error("classifyDeliveryError must be a function.");
  for (const [value, label] of [
    [retryBaseMs, "retryBaseMs"],
    [retryMaxMs, "retryMaxMs"],
    [pollIntervalMs, "pollIntervalMs"],
    [maxEventBytes, "maxEventBytes"],
    [maxAcknowledgedEvents, "maxAcknowledgedEvents"],
    [maxRejectedEvents, "maxRejectedEvents"],
  ]) positiveLimit(value, label);
  if (retryMaxMs < retryBaseMs) throw new Error("retryMaxMs must be at least retryBaseMs.");
  const paths = differentialTestingOutboxPaths({ root, outboxDirectory, stagedDirectory, pendingDirectory, acknowledgedDirectory, rejectedDirectory });
  ensureOutboxDirectories(paths);
  const dispatcherStatePath = statePath
    ? containedPath(resolve(root), statePath, "outbox dispatcher state")
    : resolve(paths.root, "dispatcher-state.json");
  assertNoSymlinkComponents(resolve(root), dispatcherStatePath, "outbox dispatcher state");
  const releaseLock = acquireProcessLock(paths.root, ".outbox-dispatcher.lock", "Differential Testing outbox");
  let state;
  try {
    state = loadOutboxDispatcherState(dispatcherStatePath);
    reconcileOutboxDispatcherState({ paths, state, maxEventBytes, now });
    writeJsonAtomic(dispatcherStatePath, state);
  } catch (error) {
    releaseLock();
    throw error;
  }
  let started = false;
  let closed = false;
  let timer = null;
  let workerPromise = null;

  return {
    statePath: dispatcherStatePath,
    snapshot: () => structuredClone(state),
    start() {
      if (closed) throw new Error("Differential Testing outbox dispatcher is closed.");
      started = true;
      schedule(0);
    },
    wake() {
      if (closed) throw new Error("Differential Testing outbox dispatcher is closed.");
      if (!started) started = true;
      schedule(0, { replace: true });
    },
    async idle() {
      while (workerPromise || scanOutboxEvents(paths.pending, maxEventBytes).length > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
      }
    },
    close() {
      if (workerPromise) throw new Error("Cannot close a busy Differential Testing outbox dispatcher.");
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      releaseLock();
    },
  };

  function schedule(delay, { replace = false } = {}) {
    if (!started || closed || workerPromise) return;
    if (timer && !replace) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (closed) return;
      workerPromise = drain().finally(() => {
        workerPromise = null;
        if (!closed && existsSync(paths.pending)) schedule(nextOutboxDelay({ paths, state, maxEventBytes, now, pollIntervalMs }));
      });
    }, Math.max(0, delay));
  }

  async function drain() {
    reconcileOutboxDispatcherState({ paths, state, maxEventBytes, now });
    persist();
    while (true) {
      const entry = nextDueOutboxEvent({ paths, state, maxEventBytes, now });
      if (!entry) return;
      const delivery = state.entries[entry.event.requestId];
      const attemptedAt = now();
      assertTimestamp(attemptedAt, "outbox attempt timestamp");
      delivery.attempts = Math.min(Number.MAX_SAFE_INTEGER, delivery.attempts + 1);
      delivery.lastAttemptAt = attemptedAt;
      // Keep persisted in-flight work immediately retryable after process death.
      delivery.nextAttemptAt = attemptedAt;
      delivery.lastError = null;
      bumpAndPersist();
      try {
        callSync(validateEvent, structuredClone(entry.event), "validateEvent");
        await deliver(structuredClone(entry.event), {
          eventPath: entry.path,
          eventSha256: sha256Bytes(entry.bytes),
        });
        moveOutboxEvent(entry.path, resolve(paths.acked, basename(entry.path)), entry.event, maxEventBytes);
        pruneOutboxDirectory(paths.acked, maxAcknowledgedEvents);
        delete state.entries[entry.event.requestId];
        bumpAndPersist();
      } catch (error) {
        const classification = callSync(classifyDeliveryError, error, "classifyDeliveryError");
        if (!["transient", "permanent"].includes(classification)) throw new Error("classifyDeliveryError must return transient or permanent.");
        if (classification === "permanent") {
          moveOutboxEvent(entry.path, resolve(paths.rejected, basename(entry.path)), entry.event, maxEventBytes);
          pruneOutboxDirectory(paths.rejected, maxRejectedEvents);
          delete state.entries[entry.event.requestId];
        } else {
          delivery.lastError = error?.message ?? String(error);
          delivery.nextAttemptAt = timestampAfter(attemptedAt, retryDelay(delivery.attempts, retryBaseMs, retryMaxMs));
        }
        bumpAndPersist();
      }
    }
  }

  function bumpAndPersist() {
    state.revision += 1;
    state.updatedAt = now();
    assertTimestamp(state.updatedAt, "outbox state timestamp");
    persist();
  }

  function persist() {
    writeJsonAtomic(dispatcherStatePath, state);
  }
}

export function createDifferentialTestingProjectionWorker({
  root = process.cwd(),
  statePath = ".local/differential-testing/projection-state.json",
  stateSchema = DIFFERENTIAL_TESTING_PROJECTION_STATE_SCHEMA,
  publish,
  now = () => new Date().toISOString(),
  retryBaseMs = 250,
  retryMaxMs = 30_000,
} = {}) {
  if (typeof publish !== "function") throw new Error("publish is required.");
  if (typeof stateSchema !== "string" || !stateSchema.trim()) throw new Error("stateSchema must be a non-empty string.");
  for (const [value, label] of [[retryBaseMs, "retryBaseMs"], [retryMaxMs, "retryMaxMs"]]) positiveLimit(value, label);
  if (retryMaxMs < retryBaseMs) throw new Error("retryMaxMs must be at least retryBaseMs.");
  const repoRoot = resolve(root);
  const projectionStatePath = containedPath(repoRoot, statePath, "projection state");
  assertNoSymlinkComponents(repoRoot, projectionStatePath, "projection state");
  mkdirSync(dirname(projectionStatePath), { recursive: true });
  const releaseLock = acquireProcessLock(dirname(projectionStatePath), `.${basename(projectionStatePath)}.lock`, "Differential Testing projection");
  let state;
  try {
    state = loadProjectionState(projectionStatePath, stateSchema);
    if (state.status === "running") {
      state.status = "queued";
      state.startedAt = null;
      state.nextAttemptAt = now();
      writeJsonAtomic(projectionStatePath, state);
    }
  } catch (error) {
    releaseLock();
    throw error;
  }
  let started = false;
  let closed = false;
  let timer = null;
  let workerPromise = null;

  return {
    statePath: projectionStatePath,
    snapshot: () => structuredClone(state),
    invalidate({ revision, reason, scenarioId = null } = {}) {
      if (closed) throw new Error("Differential Testing projection worker is closed.");
      const sourceRevision = requiredText(revision, "projection revision");
      const projectionReason = requiredText(reason, "projection reason");
      if (scenarioId !== null) assertScenarioId(scenarioId);
      const timestamp = now();
      assertTimestamp(timestamp, "projection invalidation timestamp");
      const sameRevision = state.requested?.revision === sourceRevision;
      state.requested = {
        revision: sourceRevision,
        requestedAt: timestamp,
        reasons: sameRevision ? uniqueStrings([...state.requested.reasons, projectionReason]) : [projectionReason],
        scenarioIds: sameRevision
          ? uniqueStrings([...state.requested.scenarioIds, ...(scenarioId ? [scenarioId] : [])])
          : scenarioId ? [scenarioId] : [],
      };
      state.revision += 1;
      state.updatedAt = timestamp;
      state.error = null;
      if (state.status !== "running") {
        state.status = "queued";
        state.attempts = 0;
        state.nextAttemptAt = timestamp;
      }
      persist();
      if (started && state.status !== "running") schedule(0, { replace: true });
      return structuredClone(state);
    },
    start() {
      if (closed) throw new Error("Differential Testing projection worker is closed.");
      started = true;
      if (["queued", "retrying"].includes(state.status)) schedule(nextProjectionDelay(state, now()));
    },
    wake() {
      if (closed) throw new Error("Differential Testing projection worker is closed.");
      if (!started) started = true;
      if (["queued", "retrying"].includes(state.status)) schedule(0, { replace: true });
    },
    async idle() {
      while (workerPromise || ["queued", "running", "retrying"].includes(state.status)) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
      }
    },
    close() {
      if (workerPromise) throw new Error("Cannot close a busy Differential Testing projection worker.");
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      releaseLock();
    },
  };

  function schedule(delay, { replace = false } = {}) {
    if (!started || closed || workerPromise) return;
    if (timer && !replace) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (closed) return;
      workerPromise = runProjection().finally(() => {
        workerPromise = null;
        if (!closed && ["queued", "retrying"].includes(state.status)) schedule(nextProjectionDelay(state, now()));
      });
    }, Math.max(0, delay));
  }

  async function runProjection() {
    if (!state.requested || nextProjectionDelay(state, now()) > 0) return;
    const target = structuredClone(state.requested);
    const invalidationRevision = state.revision;
    state.status = "running";
    state.startedAt = now();
    state.completedAt = null;
    state.nextAttemptAt = null;
    state.attempts = Math.min(Number.MAX_SAFE_INTEGER, state.attempts + 1);
    state.error = null;
    persist();
    try {
      await publish({
        root: repoRoot,
        revision: target.revision,
        reasons: structuredClone(target.reasons),
        scenarioIds: structuredClone(target.scenarioIds),
      });
      if (state.revision !== invalidationRevision) {
        state.status = "queued";
        state.attempts = 0;
        state.nextAttemptAt = now();
      } else {
        const timestamp = now();
        state.status = "complete";
        state.published = { revision: target.revision, publishedAt: timestamp };
        state.completedAt = timestamp;
        state.nextAttemptAt = null;
        state.error = null;
      }
    } catch (error) {
      if (state.revision !== invalidationRevision) {
        state.status = "queued";
        state.attempts = 0;
        state.nextAttemptAt = now();
        state.error = null;
      } else {
        state.status = "retrying";
        state.error = error?.message ?? String(error);
        state.nextAttemptAt = timestampAfter(now(), retryDelay(state.attempts, retryBaseMs, retryMaxMs));
      }
    }
    state.updatedAt = now();
    persist();
  }

  function persist() {
    writeJsonAtomic(projectionStatePath, state);
  }
}

export function publishDifferentialTestingOvenBundle({
  outputRoot,
  currentPayload,
  scenarioPayloads = new Map(),
  keepGenerations = 4,
} = {}) {
  const root = resolve(String(outputRoot || ""));
  if (!outputRoot) throw new Error("outputRoot is required.");
  if (!Number.isSafeInteger(keepGenerations) || keepGenerations < 1 || keepGenerations > 20) throw new Error("keepGenerations must be between 1 and 20.");
  const payloads = scenarioPayloads instanceof Map ? new Map(scenarioPayloads) : new Map(Object.entries(scenarioPayloads || {}));
  assertDifferentialTestingData(currentPayload);
  const selectedScenarioId = currentPayload.scenarioCatalog.selectedScenarioId;
  const catalog = currentPayload.scenarioCatalog.scenarios;
  const catalogJson = canonicalJson(catalog);
  const catalogIds = catalog.map((scenario) => scenario.id).sort();
  const payloadIds = [...payloads.keys()].sort();
  if (payloads.size === 0 && selectedScenarioId !== null) throw new Error("A selected scenario requires a scenario payload.");
  if (payloads.size > 0 && selectedScenarioId === null) throw new Error("Scenario payloads require a selected scenario.");
  if (canonicalJson(payloadIds) !== canonicalJson(catalogIds)) throw new Error("Scenario payload keys must exactly match the published catalog.");
  for (const [scenarioId, payload] of payloads) {
    assertScenarioId(scenarioId);
    assertDifferentialTestingData(payload);
    if (payload.scenarioCatalog.selectedScenarioId !== scenarioId) throw new Error(`Scenario payload ${scenarioId} selects another scenario.`);
    if (canonicalJson(payload.scenarioCatalog.scenarios) !== catalogJson) throw new Error(`Scenario payload ${scenarioId} has a different catalog.`);
  }
  if (selectedScenarioId !== null && !payloads.has(selectedScenarioId)) throw new Error("The selected scenario payload is missing.");
  if (selectedScenarioId !== null && canonicalJson(payloads.get(selectedScenarioId)) !== canonicalJson(currentPayload)) {
    throw new Error("currentPayload must equal the selected scenario payload.");
  }

  const parent = dirname(root);
  const outputName = basename(root);
  mkdirSync(parent, { recursive: true });
  const generation = resolve(parent, `.${outputName}.generation-${Date.now()}-${randomUUID()}`);
  const temporaryLink = resolve(parent, `.${outputName}.${process.pid}.${randomUUID()}.link`);
  mkdirSync(resolve(generation, "scenarios"), { recursive: true });
  try {
    for (const [scenarioId, payload] of payloads) writeJsonAtomic(resolve(generation, "scenarios", `${scenarioId}.json`), payload, { compact: true });
    writeJsonAtomic(resolve(generation, "current.json"), currentPayload, { compact: true });
    if (existsSync(root) && !lstatSync(root).isSymbolicLink()) throw new Error(`Oven bundle path must be an atomic symlink: ${root}`);
    symlinkSync(basename(generation), temporaryLink, "dir");
    renameSync(temporaryLink, root);
    fsyncDirectory(parent);
    pruneGenerations(parent, outputName, generation, keepGenerations);
  } finally {
    rmSync(temporaryLink, { force: true });
    if (activeGeneration(root) !== generation) rmSync(generation, { recursive: true, force: true });
  }
  return { outputRoot: root, generation, selectedScenarioId, scenarioCount: payloads.size };
}

export function createDifferentialTestingWorkerHandler({
  queue,
  serviceName = "differential-testing-worker",
  requestPaths = ["/api/events"],
  maxBodyBytes = 128 * 1024,
} = {}) {
  if (!queue || typeof queue.accept !== "function" || typeof queue.snapshot !== "function" || typeof queue.scenarioStatus !== "function") {
    throw new Error("queue must expose accept, snapshot, and scenarioStatus.");
  }
  if (!Array.isArray(requestPaths) || requestPaths.length === 0 || requestPaths.some((path) => typeof path !== "string" || !path.startsWith("/"))) {
    throw new Error("requestPaths must contain absolute URL paths.");
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error("maxBodyBytes must be a positive integer.");
  const acceptedPaths = new Set(requestPaths);
  return async function differentialTestingWorkerHandler(request, response) {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers?.host ?? "127.0.0.1"}`);
      if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { status: "ok", service: serviceName });
      if (request.method === "GET" && url.pathname === "/api/status") {
        const scenarioId = String(url.searchParams.get("scenario") || "").trim();
        if (scenarioId) assertScenarioId(scenarioId);
        return sendJson(response, 200, scenarioId ? { scenarioId, refresh: queue.scenarioStatus(scenarioId) } : queue.snapshot());
      }
      if (request.method === "POST" && acceptedPaths.has(url.pathname)) {
        const accepted = await queue.accept(await readJsonBody(request, maxBodyBytes));
        return sendJson(response, accepted.status === "already-accepted" ? 200 : 202, accepted);
      }
      return sendJson(response, 404, { error: "not found" });
    } catch (error) {
      const requestedStatus = Number(error?.status);
      const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 500;
      return sendJson(response, status, { error: error?.message ?? String(error) });
    }
  };
}

function initialScenarioState(job, identity, timestamp) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity) || identity.scenarioId !== job.scenarioId) {
    throw new Error("scenarioIdentity must return an object bound to job.scenarioId.");
  }
  return {
    status: "queued",
    identity,
    request: job,
    pendingRequest: null,
    coalescedCount: 0,
    requestedAt: job.requestedAt,
    startedAt: null,
    finishedAt: null,
    updatedAt: timestamp,
    run: null,
    publication: null,
    error: null,
    attempts: 0,
    nextAttemptAt: timestamp,
    acceptedRequestIds: [job.requestId],
  };
}

function queuePendingSuccessor(state, scenarioId, scenario, run, timestamp) {
  scenario.status = "queued";
  scenario.request = scenario.pendingRequest;
  scenario.pendingRequest = null;
  scenario.run = { ...scenario.run, ...run };
  scenario.requestedAt = scenario.request.requestedAt;
  scenario.startedAt = null;
  scenario.finishedAt = null;
  scenario.updatedAt = timestamp;
  scenario.error = null;
  scenario.attempts = 0;
  scenario.nextAttemptAt = timestamp;
  if (!state.queue.includes(scenarioId)) state.queue.push(scenarioId);
}

function recordAcceptedRequestId(scenario, requestId, limit) {
  scenario.acceptedRequestIds = [...scenario.acceptedRequestIds.filter((id) => id !== requestId), requestId].slice(-limit);
}

function loadState(path, { stateSchema, validateStoredJob, maxJobBytes, maxAcceptedRequestIds, maxScenarios }) {
  if (!existsSync(path)) return emptyState(stateSchema);
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    assertStateShape(state, { stateSchema, validateStoredJob, maxJobBytes, maxAcceptedRequestIds, maxScenarios });
    return state;
  } catch (error) {
    throw new Error(`Invalid Differential Testing refresh state: ${error.message}`);
  }
}

function assertStateShape(state, { stateSchema, validateStoredJob, maxJobBytes, maxAcceptedRequestIds, maxScenarios }) {
  const expected = ["schema", "revision", "updatedAt", "activeJobId", "selectedScenarioId", "queue", "scenarios"];
  if (!state || typeof state !== "object" || Array.isArray(state)
    || canonicalJson(Object.keys(state).sort()) !== canonicalJson(expected.sort())
    || state.schema !== stateSchema
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isFinite(Date.parse(state.updatedAt || ""))
    || (state.activeJobId !== null && typeof state.activeJobId !== "string")
    || !Array.isArray(state.queue)
    || !state.scenarios || typeof state.scenarios !== "object" || Array.isArray(state.scenarios)) throw new Error("shape mismatch");
  const ids = Object.keys(state.scenarios);
  if (ids.length > maxScenarios) throw new Error("scenario limit exceeded");
  if (ids.some((id) => !scenarioIdPattern.test(id))) throw new Error("invalid scenario id");
  if (state.selectedScenarioId !== null && (!scenarioIdPattern.test(state.selectedScenarioId) || !ids.includes(state.selectedScenarioId))) throw new Error("selected scenario mismatch");
  if (new Set(state.queue).size !== state.queue.length || state.queue.some((id) => !ids.includes(id))) throw new Error("queue mismatch");
  for (const [scenarioId, scenario] of Object.entries(state.scenarios)) {
    const scenarioKeys = ["status", "identity", "request", "pendingRequest", "coalescedCount", "requestedAt", "startedAt", "finishedAt", "updatedAt", "run", "publication", "error", "attempts", "nextAttemptAt", "acceptedRequestIds"];
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)
      || canonicalJson(Object.keys(scenario).sort()) !== canonicalJson(scenarioKeys.sort())
      || !refreshStatuses.has(scenario.status)
      || scenario?.identity?.scenarioId !== scenarioId
      || scenario?.request?.scenarioId !== scenarioId
      || (scenario.pendingRequest && scenario.pendingRequest.scenarioId !== scenarioId)
      || !Array.isArray(scenario.acceptedRequestIds)
      || scenario.acceptedRequestIds.length > maxAcceptedRequestIds
      || new Set(scenario.acceptedRequestIds).size !== scenario.acceptedRequestIds.length
      || scenario.acceptedRequestIds.some((id) => typeof id !== "string" || !id)
      || !Number.isSafeInteger(scenario.attempts) || scenario.attempts < 0
      || (scenario.nextAttemptAt !== null && !Number.isFinite(Date.parse(scenario.nextAttemptAt || "")))
      || !scenario.acceptedRequestIds.includes(scenario.request.requestId)
      || (scenario.pendingRequest && !scenario.acceptedRequestIds.includes(scenario.pendingRequest.requestId))) throw new Error(`scenario state mismatch for ${scenarioId}`);
    assertJobEnvelope(scenario.request, { maxJobBytes });
    if (scenario.pendingRequest) assertJobEnvelope(scenario.pendingRequest, { maxJobBytes });
    callSync(validateStoredJob, scenario.request, "validateStoredJob");
    if (scenario.pendingRequest) callSync(validateStoredJob, scenario.pendingRequest, "validateStoredJob");
  }
}

function emptyState(schema) {
  return { schema, revision: 0, updatedAt: new Date().toISOString(), activeJobId: null, selectedScenarioId: null, queue: [], scenarios: {} };
}

function assertJobEnvelope(job, { maxJobBytes }) {
  if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error("Validated request must return a job object.");
  if (typeof job.requestId !== "string" || !job.requestId.trim()) throw new Error("Validated job requires requestId.");
  assertTimestamp(job.requestedAt, "job.requestedAt");
  assertScenarioId(job.scenarioId);
  if (Buffer.byteLength(JSON.stringify(job)) > maxJobBytes) throw new Error(`Validated job exceeds ${maxJobBytes} bytes.`);
}

function assertScenarioId(value) {
  if (!scenarioIdPattern.test(String(value || ""))) throw new Error(`Invalid Differential Testing scenario id: ${value || "missing"}`);
}

function assertTimestamp(value, label) {
  if (!Number.isFinite(Date.parse(value || ""))) throw new Error(`${label} must be a timestamp.`);
}

function assertTelemetryStage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !Number.isSafeInteger(value.exitCode) || value.exitCode < 0
    || !Object.hasOwn(value, "staged")) throw new Error("runTelemetry must return { exitCode, staged }.");
}

function assertPublication(value, requestId) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.requestId !== requestId) {
    throw new Error("publishTelemetry must return a publication bound to requestId.");
  }
}

function callSync(callback, value, label) {
  const result = callback(value);
  if (result && typeof result.then === "function") {
    result.catch(() => {});
    throw new Error(`${label} must be synchronous.`);
  }
  return result;
}

function nextQueueDelay(state, timestamp) {
  const nowMs = Date.parse(timestamp);
  let earliest = Infinity;
  for (const scenarioId of state.queue) {
    const scenario = state.scenarios[scenarioId];
    if (!scenario || scenario.status !== "queued") continue;
    earliest = Math.min(earliest, Date.parse(scenario.nextAttemptAt || timestamp));
  }
  return earliest === Infinity ? null : Math.max(0, earliest - nowMs);
}

function nextDueQueueIndex(state, timestamp) {
  const nowMs = Date.parse(timestamp);
  return state.queue.findIndex((scenarioId) => {
    const scenario = state.scenarios[scenarioId];
    return scenario?.status === "queued" && Date.parse(scenario.nextAttemptAt || timestamp) <= nowMs;
  });
}

async function runWithTimeout(callback, options, timeoutMs, abortGraceMs) {
  const controller = new AbortController();
  let timeout;
  const execution = Promise.resolve().then(() => callback({ ...options, signal: controller.signal }));
  const completion = execution.then(
    (value) => ({ status: "fulfilled", value }),
    (error) => ({ status: "rejected", error }),
  );
  const expired = new Promise((resolveTimeout) => {
    timeout = setTimeout(() => resolveTimeout({ status: "timeout" }), timeoutMs);
  });
  const first = await Promise.race([completion, expired]);
  clearTimeout(timeout);
  if (first.status === "fulfilled") return first.value;
  if (first.status === "rejected") throw first.error;

  controller.abort();
  let graceTimer;
  const graceExpired = new Promise((resolveGrace) => {
    graceTimer = setTimeout(() => resolveGrace({ status: "abort-grace-expired" }), abortGraceMs);
  });
  const settled = await Promise.race([completion, graceExpired]);
  clearTimeout(graceTimer);
  if (settled.status === "abort-grace-expired") {
    const error = new Error(`Differential Testing telemetry exceeded ${timeoutMs}ms and did not stop within the ${abortGraceMs}ms abort grace.`);
    error.code = "EABORTGRACE";
    error.permanent = true;
    error.preserveScratch = true;
    throw error;
  }
  const error = new Error(`Differential Testing telemetry exceeded ${timeoutMs}ms.`);
  error.code = "ETIMEDOUT";
  throw error;
}

function retryDelay(attempts, baseMs, maxMs) {
  const exponent = Math.max(0, Math.min(30, Number(attempts || 1) - 1));
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

function timestampAfter(timestamp, delayMs) {
  const base = Date.parse(timestamp);
  if (!Number.isFinite(base)) throw new Error("Cannot calculate a retry from an invalid timestamp.");
  return new Date(base + delayMs).toISOString();
}

function positiveLimit(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function requiredRequestId(value) {
  const id = String(value || "");
  if (!requestIdPattern.test(id)) throw new Error(`Invalid Differential Testing request id: ${id || "missing"}`);
  return id;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function differentialTestingOutboxPaths({
  root = process.cwd(),
  outboxDirectory = ".local/differential-testing/outbox",
  stagedDirectory = "staged",
  pendingDirectory = "pending",
  acknowledgedDirectory = "acked",
  rejectedDirectory = "rejected",
} = {}) {
  const repoRoot = resolve(root);
  const outboxRoot = containedPath(repoRoot, outboxDirectory, "outbox directory");
  return {
    repoRoot,
    root: outboxRoot,
    staged: containedPath(outboxRoot, stagedDirectory, "staged outbox directory"),
    pending: containedPath(outboxRoot, pendingDirectory, "pending outbox directory"),
    acked: containedPath(outboxRoot, acknowledgedDirectory, "acknowledged outbox directory"),
    rejected: containedPath(outboxRoot, rejectedDirectory, "rejected outbox directory"),
  };
}

function ensureOutboxDirectories(paths) {
  assertNoSymlinkComponents(paths.repoRoot, paths.root, "outbox directory");
  mkdirSync(paths.root, { recursive: true });
  for (const directory of [paths.staged, paths.pending, paths.acked, paths.rejected]) {
    assertNoSymlinkComponents(paths.root, directory, "outbox status directory");
    mkdirSync(directory, { recursive: true });
    assertNoSymlinkComponents(paths.root, directory, "outbox status directory");
  }
}

function assertDifferentialTestingOutboxEvent(value, maxEventBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Differential Testing outbox event must be an object.");
  requiredRequestId(value.requestId);
  assertTimestamp(value.requestedAt, "outbox event requestedAt");
  if (Buffer.byteLength(JSON.stringify(value)) > maxEventBytes) throw new Error(`Differential Testing outbox event exceeds ${maxEventBytes} bytes.`);
  return structuredClone(value);
}

function readOutboxEvent(path, maxEventBytes) {
  const bytes = readFileSync(path);
  if (bytes.length > maxEventBytes) throw new Error(`Differential Testing outbox event exceeds ${maxEventBytes} bytes: ${path}`);
  let event;
  try { event = JSON.parse(bytes); }
  catch (error) { throw new Error(`Invalid Differential Testing outbox event ${path}: ${error.message}`); }
  return assertDifferentialTestingOutboxEvent(event, maxEventBytes);
}

function assertSameOutboxEvent(path, expected, maxEventBytes) {
  const actual = readOutboxEvent(path, maxEventBytes);
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`Differential Testing outbox request id collision: ${expected.requestId}`);
  return actual;
}

function existingOutboxEvent(paths, requestId, expected, maxEventBytes, { includeStaged = true } = {}) {
  const candidates = [
    ["already-acked", paths.acked],
    ["already-rejected", paths.rejected],
    ["already-queued", paths.pending],
    ...(includeStaged ? [["already-staged", paths.staged]] : []),
  ].map(([status, directory]) => ({ status, path: resolve(directory, `${requestId}.json`) }))
    .filter((entry) => existsSync(entry.path));
  if (candidates.length === 0) return null;
  if (candidates.length > 1) throw new Error(`Differential Testing outbox request exists in multiple states: ${requestId}`);
  const event = expected ? assertSameOutboxEvent(candidates[0].path, expected, maxEventBytes) : readOutboxEvent(candidates[0].path, maxEventBytes);
  return { status: candidates[0].status, requestId: event.requestId, eventPath: candidates[0].path };
}

function writeJsonExclusiveAtomic(path, value, { compact = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx");
    writeFileSync(descriptor, `${JSON.stringify(value, null, compact ? undefined : 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    try {
      linkSync(temporary, path);
      fsyncDirectory(dirname(path));
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") return false;
      throw error;
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporary, { force: true });
    fsyncDirectory(dirname(path));
  }
}

function scanOutboxEvents(directory, maxEventBytes) {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) throw new Error(`Unexpected Differential Testing outbox entry: ${resolve(directory, entry.name)}`);
    const path = resolve(directory, entry.name);
    const bytes = readFileSync(path);
    if (bytes.length > maxEventBytes) throw new Error(`Differential Testing outbox event exceeds ${maxEventBytes} bytes: ${path}`);
    let event;
    try { event = JSON.parse(bytes); }
    catch (error) { throw new Error(`Invalid Differential Testing outbox event ${path}: ${error.message}`); }
    assertDifferentialTestingOutboxEvent(event, maxEventBytes);
    if (`${event.requestId}.json` !== entry.name) throw new Error(`Differential Testing outbox filename does not match requestId: ${entry.name}`);
    return { path, bytes, event };
  });
}

function loadOutboxDispatcherState(path) {
  if (!existsSync(path)) return {
    schema: DIFFERENTIAL_TESTING_OUTBOX_DISPATCHER_STATE_SCHEMA,
    revision: 0,
    updatedAt: new Date().toISOString(),
    entries: {},
  };
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`Invalid Differential Testing outbox dispatcher state: ${error.message}`); }
  const keys = ["schema", "revision", "updatedAt", "entries"];
  if (!state || typeof state !== "object" || Array.isArray(state)
    || canonicalJson(Object.keys(state).sort()) !== canonicalJson(keys.sort())
    || state.schema !== DIFFERENTIAL_TESTING_OUTBOX_DISPATCHER_STATE_SCHEMA
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isFinite(Date.parse(state.updatedAt || ""))
    || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) throw new Error("Invalid Differential Testing outbox dispatcher state: shape mismatch");
  for (const [requestId, entry] of Object.entries(state.entries)) {
    const entryKeys = ["attempts", "lastAttemptAt", "nextAttemptAt", "lastError"];
    if (!requestIdPattern.test(requestId)
      || !entry || typeof entry !== "object" || Array.isArray(entry)
      || canonicalJson(Object.keys(entry).sort()) !== canonicalJson(entryKeys.sort())
      || !Number.isSafeInteger(entry.attempts) || entry.attempts < 0
      || (entry.lastAttemptAt !== null && !Number.isFinite(Date.parse(entry.lastAttemptAt || "")))
      || !Number.isFinite(Date.parse(entry.nextAttemptAt || ""))
      || (entry.lastError !== null && typeof entry.lastError !== "string")) throw new Error(`Invalid Differential Testing outbox dispatcher entry: ${requestId}`);
  }
  return state;
}

function reconcileOutboxDispatcherState({ paths, state, maxEventBytes, now }) {
  const pending = scanOutboxEvents(paths.pending, maxEventBytes);
  const acked = new Map(scanOutboxEvents(paths.acked, maxEventBytes).map((entry) => [entry.event.requestId, entry]));
  const rejected = new Map(scanOutboxEvents(paths.rejected, maxEventBytes).map((entry) => [entry.event.requestId, entry]));
  let removedPending = false;
  for (const entry of pending) {
    const terminal = acked.get(entry.event.requestId) ?? rejected.get(entry.event.requestId);
    if (terminal) {
      if (sha256Bytes(terminal.bytes) !== sha256Bytes(entry.bytes)) throw new Error(`Differential Testing outbox request id collision: ${entry.event.requestId}`);
      rmSync(entry.path, { force: true });
      removedPending = true;
      continue;
    }
    if (!state.entries[entry.event.requestId]) {
      state.entries[entry.event.requestId] = { attempts: 0, lastAttemptAt: null, nextAttemptAt: now(), lastError: null };
    }
  }
  if (removedPending) fsyncDirectory(paths.pending);
  const pendingIds = new Set(scanOutboxEvents(paths.pending, maxEventBytes).map((entry) => entry.event.requestId));
  for (const requestId of Object.keys(state.entries)) if (!pendingIds.has(requestId)) delete state.entries[requestId];
}

function nextDueOutboxEvent({ paths, state, maxEventBytes, now }) {
  const nowMs = Date.parse(now());
  return scanOutboxEvents(paths.pending, maxEventBytes)
    .filter((entry) => Date.parse(state.entries[entry.event.requestId]?.nextAttemptAt || "") <= nowMs)
    .sort((left, right) => Date.parse(left.event.requestedAt) - Date.parse(right.event.requestedAt) || left.event.requestId.localeCompare(right.event.requestId))[0] ?? null;
}

function nextOutboxDelay({ paths, state, maxEventBytes, now, pollIntervalMs }) {
  const nowMs = Date.parse(now());
  const waits = scanOutboxEvents(paths.pending, maxEventBytes)
    .map((entry) => Math.max(0, Date.parse(state.entries[entry.event.requestId]?.nextAttemptAt || now()) - nowMs));
  return waits.length > 0 ? Math.min(pollIntervalMs, ...waits) : pollIntervalMs;
}

function moveOutboxEvent(source, destination, event, maxEventBytes) {
  if (existsSync(destination)) {
    assertSameOutboxEvent(destination, event, maxEventBytes);
    rmSync(source, { force: true });
    fsyncDirectory(dirname(source));
    return;
  }
  linkSync(source, destination);
  fsyncDirectory(dirname(destination));
  rmSync(source, { force: true });
  fsyncDirectory(dirname(source));
}

function pruneOutboxDirectory(directory, limit) {
  const entries = readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) throw new Error(`Unexpected Differential Testing outbox entry: ${resolve(directory, entry.name)}`);
    const path = resolve(directory, entry.name);
    return { path, mtimeMs: statSync(path).mtimeMs };
  }).sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path));
  const removed = entries.slice(limit);
  for (const entry of removed) rmSync(entry.path, { force: true });
  if (removed.length > 0) fsyncDirectory(directory);
}

function loadProjectionState(path, schema) {
  if (!existsSync(path)) return {
    schema,
    revision: 0,
    updatedAt: new Date().toISOString(),
    status: "idle",
    requested: null,
    published: null,
    startedAt: null,
    completedAt: null,
    attempts: 0,
    nextAttemptAt: null,
    error: null,
  };
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`Invalid Differential Testing projection state: ${error.message}`); }
  const keys = ["schema", "revision", "updatedAt", "status", "requested", "published", "startedAt", "completedAt", "attempts", "nextAttemptAt", "error"];
  if (!state || typeof state !== "object" || Array.isArray(state)
    || canonicalJson(Object.keys(state).sort()) !== canonicalJson(keys.sort())
    || state.schema !== schema
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isFinite(Date.parse(state.updatedAt || ""))
    || !["idle", "queued", "running", "retrying", "complete"].includes(state.status)
    || !Number.isSafeInteger(state.attempts) || state.attempts < 0
    || (state.startedAt !== null && !Number.isFinite(Date.parse(state.startedAt || "")))
    || (state.completedAt !== null && !Number.isFinite(Date.parse(state.completedAt || "")))
    || (state.nextAttemptAt !== null && !Number.isFinite(Date.parse(state.nextAttemptAt || "")))
    || (state.error !== null && typeof state.error !== "string")) throw new Error("Invalid Differential Testing projection state: shape mismatch");
  assertProjectionRequest(state.requested, { nullable: true });
  if (state.published !== null
    && (!state.published || typeof state.published !== "object" || Array.isArray(state.published)
      || canonicalJson(Object.keys(state.published).sort()) !== canonicalJson(["revision", "publishedAt"].sort())
      || typeof state.published.revision !== "string" || !state.published.revision
      || !Number.isFinite(Date.parse(state.published.publishedAt || "")))) throw new Error("Invalid Differential Testing projection state: published mismatch");
  if (state.status !== "idle" && !state.requested) throw new Error("Invalid Differential Testing projection state: requested projection is missing");
  return state;
}

function assertProjectionRequest(value, { nullable = false } = {}) {
  if (nullable && value === null) return;
  const keys = ["revision", "requestedAt", "reasons", "scenarioIds"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys.sort())
    || typeof value.revision !== "string" || !value.revision
    || !Number.isFinite(Date.parse(value.requestedAt || ""))
    || !Array.isArray(value.reasons) || value.reasons.length === 0 || value.reasons.some((entry) => typeof entry !== "string" || !entry)
    || !Array.isArray(value.scenarioIds) || value.scenarioIds.some((entry) => !scenarioIdPattern.test(entry))) throw new Error("Invalid Differential Testing projection state: requested mismatch");
}

function nextProjectionDelay(state, timestamp) {
  if (!["queued", "retrying"].includes(state.status)) return 0;
  return Math.max(0, Date.parse(state.nextAttemptAt || timestamp) - Date.parse(timestamp));
}

function uniqueStrings(values) {
  return [...new Set(values)].sort();
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function acquireStoreLock(storeRoot) {
  return acquireProcessLock(storeRoot, ".refresh-worker.lock", "Differential Testing refresh store");
}

function acquireProcessLock(storeRoot, filename, label) {
  const path = resolve(storeRoot, filename);
  const token = randomUUID();
  const create = () => writeFileSync(path, `${JSON.stringify({ pid: process.pid, token })}\n`, { flag: "wx" });
  try {
    create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(readFileSync(path, "utf8")); } catch {}
    if (Number.isInteger(owner?.pid) && processIsAlive(owner.pid)) {
      const lockError = new Error(`${label} is already locked by pid ${owner.pid}.`);
      lockError.code = "ELOCKED";
      throw lockError;
    }
    rmSync(path, { force: true });
    create();
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const owner = JSON.parse(readFileSync(path, "utf8"));
      if (owner.token === token) rmSync(path, { force: true });
    } catch {}
    process.removeListener("exit", release);
  };
  process.once("exit", release);
  return release;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function assertNoSymlinkComponents(root, target, label) {
  const rel = relative(root, target);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) throw new Error(`${label} contains a symlink: ${current}`);
  }
}

function writeJsonAtomic(path, value, { compact = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx");
    writeFileSync(descriptor, `${JSON.stringify(value, null, compact ? undefined : 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

function readJsonBody(request, limit) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > limit) {
        const error = new Error("request body is too large");
        error.status = 413;
        rejectBody(error);
        return;
      }
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (error) {
        const invalid = new Error(`request body is invalid JSON: ${error.message}`);
        invalid.status = 400;
        rejectBody(invalid);
      }
    });
    request.on("error", rejectBody);
  });
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function pruneGenerations(parent, outputName, active, keepCount) {
  const prefix = `.${outputName}.generation-`;
  const generations = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => ({ path: resolve(parent, entry.name), mtimeMs: statSync(resolve(parent, entry.name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const keep = new Set([resolve(active), ...generations.slice(0, keepCount).map((entry) => entry.path)]);
  let removed = false;
  for (const generation of generations) {
    if (keep.has(generation.path)) continue;
    rmSync(generation.path, { recursive: true, force: true });
    removed = true;
  }
  if (removed) fsyncDirectory(parent);
}

function activeGeneration(path) {
  try { return lstatSync(path).isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : ""; } catch { return ""; }
}

function containedPath(root, path, label) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === ".." || (isWindowsEscape(rel))) throw new Error(`${label} escapes ${root}: ${target}`);
  return target;
}

function isWindowsEscape(path) {
  return sep === "\\" && /^[A-Za-z]:/u.test(path);
}

function displayPath(root, path) {
  return relative(root, path).split(sep).join("/");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
