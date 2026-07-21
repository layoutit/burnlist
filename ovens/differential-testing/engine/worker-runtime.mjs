import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { publishOvenEvent as publishRepoOvenEvent } from "../../../src/events/oven-event-store.mjs";

export const DIFFERENTIAL_TESTING_WORKER_STATE_SCHEMA = "burnlist-differential-testing-worker-state@1";

const requestIdPattern = /^[a-f0-9]{64}$/u;
const scenarioIdPattern = /^[a-f0-9]{16}$/u;
const scenarioStatuses = new Set(["queued", "running", "retrying", "complete", "failed"]);
const projectionStatuses = new Set(["idle", "queued", "running", "retrying", "complete", "failed"]);

export function readDifferentialTestingWorkerState(path) {
  let state;
  try { state = JSON.parse(readFileSync(resolve(path), "utf8")); }
  catch (error) { throw new Error(`Invalid Differential Testing worker state: ${error.message}`); }
  try { assertDifferentialTestingWorkerState(state); }
  catch (error) { throw new Error(`Invalid Differential Testing worker state: ${error.message}`); }
  return state;
}

export function assertDifferentialTestingWorkerState(value) {
  assertExactKeys(value, ["schema", "revision", "updatedAt", "selectedScenarioId", "inbox", "telemetry", "projection", "scenarios"], "worker state");
  if (value.schema !== DIFFERENTIAL_TESTING_WORKER_STATE_SCHEMA
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Number.isFinite(Date.parse(value.updatedAt || ""))
    || !value.scenarios || typeof value.scenarios !== "object" || Array.isArray(value.scenarios)) throw new Error("shape mismatch");
  const scenarioIds = Object.keys(value.scenarios);
  if (scenarioIds.some((id) => !scenarioIdPattern.test(id))
    || (scenarioIds.length === 0 && value.selectedScenarioId !== null)
    || (scenarioIds.length > 0 && !scenarioIds.includes(value.selectedScenarioId))) throw new Error("scenario selection mismatch");
  assertInboxState(value.inbox, { maxAcceptedRequestIds: Number.MAX_SAFE_INTEGER, maxRejectedEvents: Number.MAX_SAFE_INTEGER });
  assertTelemetryState(value.telemetry, scenarioIds);
  assertProjectionState(value.projection, scenarioIds);
  for (const [scenarioId, scenario] of Object.entries(value.scenarios)) assertGenericScenarioState(scenarioId, scenario);
  const queued = scenarioIds.filter((scenarioId) => ["queued", "retrying"].includes(value.scenarios[scenarioId].status)).sort();
  if (canonicalJson(queued) !== canonicalJson([...value.telemetry.queue].sort())) throw new Error("telemetry queue and scenario states disagree");
  const running = scenarioIds.filter((scenarioId) => value.scenarios[scenarioId].status === "running");
  if ((value.telemetry.active === null && running.length !== 0)
    || (value.telemetry.active !== null && (running.length !== 1 || running[0] !== value.telemetry.active.scenarioId))) {
    throw new Error("active telemetry and scenario states disagree");
  }
  if (value.telemetry.active) {
    const activeScenario = value.scenarios[value.telemetry.active.scenarioId];
    if (activeScenario.request.requestId !== value.telemetry.active.requestId
      || activeScenario.run?.id !== value.telemetry.active.runId) throw new Error("active telemetry binding mismatch");
  }
  return { status: "pass" };
}

export function createDifferentialTestingWorker({
  root = process.cwd(),
  storeDirectory = ".local/differential-testing",
  stateFile = "state.json",
  readInbox,
  deleteInbox,
  describeEvent,
  validateRequest,
  validateStoredJob,
  validateStoredSession,
  scenarioIdentity,
  validateScenarioIdentity,
  assertCausalSuccessor,
  runTelemetry,
  publishTelemetry,
  classifyTelemetryError,
  project,
  onFatal = () => {},
  emitOvenEvent = null,
  onOvenEventError = () => {},
  now = () => new Date().toISOString(),
  pollIntervalMs = 250,
  telemetryTimeoutMs = 5 * 60_000,
  telemetryAbortGraceMs = 5_000,
  telemetryMaxAttempts = 5,
  telemetryRetryBaseMs = 1_000,
  telemetryRetryMaxMs = 30_000,
  projectionMaxAttempts = 5,
  projectionRetryBaseMs = 500,
  projectionRetryMaxMs = 30_000,
  maxScenarios = 256,
  maxAcceptedRequestIds = 1_024,
  maxRejectedEvents = 128,
  maxJobBytes = 256 * 1024,
  maxSessionBytes = 128 * 1024,
  maxIdentityBytes = 128 * 1024,
  maxPublicationBytes = 128 * 1024,
} = {}) {
  for (const [callback, label] of [
    [readInbox, "readInbox"],
    [deleteInbox, "deleteInbox"],
    [describeEvent, "describeEvent"],
    [validateRequest, "validateRequest"],
    [validateStoredJob, "validateStoredJob"],
    [validateStoredSession, "validateStoredSession"],
    [scenarioIdentity, "scenarioIdentity"],
    [validateScenarioIdentity, "validateScenarioIdentity"],
    [assertCausalSuccessor, "assertCausalSuccessor"],
    [runTelemetry, "runTelemetry"],
    [publishTelemetry, "publishTelemetry"],
    [classifyTelemetryError, "classifyTelemetryError"],
    [project, "project"],
    [onFatal, "onFatal"],
    [onOvenEventError, "onOvenEventError"],
  ]) {
    if (typeof callback !== "function") throw new Error(`${label} is required.`);
  }
  for (const [value, label] of [
    [pollIntervalMs, "pollIntervalMs"],
    [telemetryTimeoutMs, "telemetryTimeoutMs"],
    [telemetryAbortGraceMs, "telemetryAbortGraceMs"],
    [telemetryMaxAttempts, "telemetryMaxAttempts"],
    [telemetryRetryBaseMs, "telemetryRetryBaseMs"],
    [telemetryRetryMaxMs, "telemetryRetryMaxMs"],
    [projectionMaxAttempts, "projectionMaxAttempts"],
    [projectionRetryBaseMs, "projectionRetryBaseMs"],
    [projectionRetryMaxMs, "projectionRetryMaxMs"],
    [maxScenarios, "maxScenarios"],
    [maxAcceptedRequestIds, "maxAcceptedRequestIds"],
    [maxRejectedEvents, "maxRejectedEvents"],
    [maxJobBytes, "maxJobBytes"],
    [maxSessionBytes, "maxSessionBytes"],
    [maxIdentityBytes, "maxIdentityBytes"],
    [maxPublicationBytes, "maxPublicationBytes"],
  ]) positiveInteger(value, label);
  if (telemetryRetryMaxMs < telemetryRetryBaseMs || projectionRetryMaxMs < projectionRetryBaseMs) {
    throw new Error("Retry maximums must be at least their base delays.");
  }

  const repoRoot = resolve(root);
  if (emitOvenEvent !== null && typeof emitOvenEvent !== "function") throw new Error("emitOvenEvent must be a function or null.");
  const eventPublisher = emitOvenEvent ?? ((event) => publishRepoOvenEvent(repoRoot, event));
  const storeRoot = containedPath(repoRoot, storeDirectory, "Differential Testing store");
  const statePath = containedPath(storeRoot, stateFile, "Differential Testing worker state");
  const scratchRoot = resolve(storeRoot, ".scratch");
  mkdirSync(scratchRoot, { recursive: true });
  const releaseLock = acquireWorkerLock(storeRoot);
  let state;
  try {
    state = loadWorkerState(statePath);
    recoverInterruptedState(state, timestamp(now(), "worker start timestamp"));
    persistWorkerState(statePath, state);
  } catch (error) {
    releaseLock();
    throw error;
  }

  let started = false;
  let closed = false;
  let interval = null;
  let tickPromise = null;
  let pollPromise = null;
  let telemetryPromise = null;
  let projectionPromise = null;
  let fatalError = null;

  const api = {
    statePath,
    snapshot() {
      if (fatalError) throw fatalError;
      return structuredClone(state);
    },
    scenarioStatus(scenarioId) {
      if (fatalError) throw fatalError;
      return structuredClone(state.scenarios[String(scenarioId || "")] ?? null);
    },
    start() {
      if (closed) throw new Error("Differential Testing worker is closed.");
      if (started) return;
      started = true;
      interval = setInterval(() => {
        void tick().catch(fail);
      }, pollIntervalMs);
      interval.unref?.();
      void tick().catch(fail);
    },
    async poll() {
      if (closed) throw new Error("Differential Testing worker is closed.");
      if (fatalError) throw fatalError;
      try { return await pollInbox(); }
      catch (error) { fail(error); throw error; }
    },
    async idle() {
      while (true) {
        if (fatalError) throw fatalError;
        await tick();
        const inbox = await Promise.resolve(readInbox());
        if (!Array.isArray(inbox)) throw new Error("readInbox must return an array.");
        if (inbox.length === 0 && !tickPromise && !pollPromise && !telemetryPromise && !projectionPromise
          && state.telemetry.queue.length === 0
          && !["queued", "running", "retrying"].includes(state.projection.status)) return;
        await delay(5);
      }
    },
    close() {
      if (tickPromise || pollPromise || telemetryPromise || projectionPromise) throw new Error("Cannot close a busy Differential Testing worker.");
      if (closed) return;
      closed = true;
      if (interval) clearInterval(interval);
      interval = null;
      releaseLock();
    },
  };
  return api;

  async function tick() {
    if (closed) return;
    if (fatalError) throw fatalError;
    if (tickPromise) return tickPromise;
    tickPromise = (async () => {
      await pollInbox();
      startTelemetryIfDue();
      startProjectionIfDue();
    })().finally(() => { tickPromise = null; });
    return tickPromise;
  }

  async function pollInbox() {
    if (pollPromise) return pollPromise;
    pollPromise = drainInbox().finally(() => { pollPromise = null; });
    return pollPromise;
  }

  async function drainInbox() {
    let entries;
    try {
      entries = await Promise.resolve(readInbox());
      if (!Array.isArray(entries)) throw new Error("readInbox must return an array.");
    } catch (error) {
      if (isTransientIo(error)) return { accepted: 0, rejected: 0, deferred: 1 };
      throw error;
    }
    let accepted = 0;
    let rejected = 0;
    let deferred = 0;
    for (const entry of entries) {
      let descriptor = null;
      let fallbackRequestId = null;
      try {
        descriptor = normalizeDescriptor(callSync(describeEvent, { root: repoRoot, event: entry?.event, entry }, "describeEvent"));
        fallbackRequestId = descriptor.requestId;
        try {
          assertJsonSize(descriptor.session, maxSessionBytes, "event session");
          callSync(validateStoredSession, {
            root: repoRoot,
            session: structuredClone(descriptor.session),
            scenarioId: descriptor.scenarioId,
            event: structuredClone(eventSummary(descriptor)),
          }, "validateStoredSession");
        } catch (error) {
          throw permanentUnlessTransient(error);
        }
        if (requestWasHandled(state, descriptor.requestId)) {
          if (!await removeInboxEntry(entry)) deferred += 1;
          continue;
        }
        try {
          if (descriptor.telemetry) await acceptTelemetryEvent(entry.event, descriptor);
          else acceptProjectionOnlyEvent(descriptor);
        } catch (error) {
          throw permanentUnlessTransient(error);
        }
        recordAcceptedRequest(state, descriptor.requestId, maxAcceptedRequestIds);
        queueProjection(descriptor.kind, descriptor.scenarioId);
        bumpAndPersist();
        if (!await removeInboxEntry(entry)) deferred += 1;
        accepted += 1;
      } catch (error) {
        if (error?.workerFatal === true) throw error;
        const requestId = requestIdPattern.test(String(fallbackRequestId || entry?.event?.requestId || ""))
          ? String(fallbackRequestId || entry.event.requestId)
          : "0".repeat(64);
        if (isPermanent(error)) {
          state.inbox.rejected.push({
            requestId,
            requestedAt: Number.isFinite(Date.parse(descriptor?.requestedAt || entry?.event?.requestedAt || ""))
              ? String(descriptor?.requestedAt || entry.event.requestedAt)
              : timestamp(now(), "rejection timestamp"),
            rejectedAt: timestamp(now(), "rejection timestamp"),
            error: error?.message ?? String(error),
          });
          state.inbox.rejected = state.inbox.rejected.slice(-maxRejectedEvents);
          bumpAndPersist();
          if (!await removeInboxEntry(entry)) deferred += 1;
          rejected += 1;
        } else {
          deferred += 1;
        }
      }
    }
    return { accepted, rejected, deferred };
  }

  async function removeInboxEntry(entry) {
    try {
      await Promise.resolve(deleteInbox(entry));
      return true;
    } catch (error) {
      if (isTransientIo(error)) return false;
      if (error && typeof error === "object") error.workerFatal = true;
      throw error;
    }
  }

  function acceptProjectionOnlyEvent(descriptor) {
    const scenario = state.scenarios[descriptor.scenarioId];
    if (!scenario) throw permanentConflict("Projection-only event requires an initialized scenario.");
    scenario.session = structuredClone(descriptor.session);
    scenario.event = eventSummary(descriptor);
    scenario.updatedAt = timestamp(now(), "scenario update timestamp");
    state.selectedScenarioId = descriptor.scenarioId;
  }

  async function acceptTelemetryEvent(event, descriptor) {
    const job = await validateRequest({ root: repoRoot, storeDirectory: storeRoot, event, descriptor });
    validateJobEnvelope(job, descriptor);
    assertJsonSize(job, maxJobBytes, "validated job");
    callSync(validateStoredJob, structuredClone(job), "validateStoredJob");
    const existing = state.scenarios[descriptor.scenarioId] ?? null;
    callSync(assertCausalSuccessor, {
      current: structuredClone(existing?.pendingRequest ?? existing?.request ?? null),
      candidate: structuredClone(job),
      scenario: existing ? structuredClone(existing) : null,
    }, "assertCausalSuccessor");
    const currentTimestamp = timestamp(now(), "request acceptance timestamp");
    state.selectedScenarioId = descriptor.scenarioId;
    if (!existing) {
      if (Object.keys(state.scenarios).length >= maxScenarios) throw permanentConflict(`Differential Testing worker exceeds ${maxScenarios} scenarios.`);
      const identity = callSync(scenarioIdentity, structuredClone(job), "scenarioIdentity");
      callSync(validateScenarioIdentity, {
        root: repoRoot,
        storeDirectory: storeRoot,
        identity: structuredClone(identity),
        scenarioId: descriptor.scenarioId,
        job: structuredClone(job),
      }, "validateScenarioIdentity");
      assertJsonSize(identity, maxIdentityBytes, "scenario identity");
      state.scenarios[descriptor.scenarioId] = initialScenario({ job, identity, descriptor, currentTimestamp });
      state.telemetry.queue.push(descriptor.scenarioId);
      return;
    }
    existing.session = structuredClone(descriptor.session);
    existing.event = eventSummary(descriptor);
    existing.coalescedCount += 1;
    existing.updatedAt = currentTimestamp;
    if (existing.status === "running") {
      existing.pendingRequest = job;
      return;
    }
    Object.assign(existing, {
      status: "queued",
      request: job,
      pendingRequest: null,
      requestedAt: job.requestedAt,
      startedAt: null,
      finishedAt: null,
      error: null,
      attempts: 0,
      nextAttemptAt: currentTimestamp,
    });
    if (!state.telemetry.queue.includes(descriptor.scenarioId)) state.telemetry.queue.push(descriptor.scenarioId);
  }

  function startTelemetryIfDue() {
    if (telemetryPromise || state.telemetry.active) return;
    const index = state.telemetry.queue.findIndex((scenarioId) => {
      const scenario = state.scenarios[scenarioId];
      return ["queued", "retrying"].includes(scenario?.status)
        && Date.parse(scenario.nextAttemptAt || state.updatedAt) <= Date.parse(now());
    });
    if (index < 0) return;
    const [scenarioId] = state.telemetry.queue.splice(index, 1);
    telemetryPromise = executeTelemetry(scenarioId)
      .catch(fail)
      .finally(() => { telemetryPromise = null; });
  }

  async function executeTelemetry(scenarioId) {
    const scenario = state.scenarios[scenarioId];
    const request = scenario.request;
    const runId = randomUUID();
    const scratchDirectory = containedPath(scratchRoot, runId, "Differential Testing scratch directory");
    mkdirSync(scratchDirectory, { recursive: true });
    const startedAt = timestamp(now(), "telemetry start timestamp");
    Object.assign(scenario, {
      status: "running",
      startedAt,
      finishedAt: null,
      error: null,
      attempts: scenario.attempts + 1,
      nextAttemptAt: null,
      run: { id: runId, scratchDirectory: displayPath(repoRoot, scratchDirectory) },
    });
    state.telemetry.active = { scenarioId, requestId: request.requestId, runId, startedAt };
    const iterationAttempt = scenario.attempts;
    queueProjection("telemetry-running", scenarioId);
    bumpAndPersist();
    let preserveScratch = false;
    let quarantined = false;
    let iterationPhase = "failed";
    let iterationError = null;
    try {
      const staged = await runWithTimeout(runTelemetry, {
        root: repoRoot,
        storeDirectory: storeRoot,
        scratchDirectory,
        request: structuredClone(request),
      }, telemetryTimeoutMs, telemetryAbortGraceMs);
      if (scenario.pendingRequest) {
        iterationPhase = "superseded";
        queuePendingScenario(scenario, { superseded: true }, timestamp(now(), "successor timestamp"));
        if (!state.telemetry.queue.includes(scenarioId)) state.telemetry.queue.push(scenarioId);
      } else {
        if (!staged || typeof staged !== "object" || Array.isArray(staged) || !("staged" in staged)) {
          throw permanentConflict("runTelemetry returned an invalid staged result.");
        }
        const publication = callSync(publishTelemetry, {
          root: repoRoot,
          storeDirectory: storeRoot,
          scratchDirectory,
          request: structuredClone(request),
          staged: staged.staged,
        }, "publishTelemetry");
        if (!publication || typeof publication !== "object" || publication.requestId !== request.requestId) {
          throw permanentConflict("Telemetry publication is not bound to its request.");
        }
        assertJsonSize(publication, maxPublicationBytes, "telemetry publication");
        scenario.status = "complete";
        scenario.finishedAt = timestamp(now(), "telemetry completion timestamp");
        scenario.nextAttemptAt = null;
        scenario.publication = structuredClone(publication);
        scenario.run = { ...scenario.run, exitCode: staged.exitCode ?? null };
        iterationPhase = "complete";
      }
    } catch (error) {
      iterationError = String(error?.message ?? error).slice(0, 1_000);
      preserveScratch = error?.preserveScratch === true;
      if (error?.workerFatal === true) {
        quarantined = true;
        throw error;
      } else if (scenario.pendingRequest) {
        iterationPhase = "superseded";
        queuePendingScenario(scenario, { superseded: true, discardedError: error?.message ?? String(error) }, timestamp(now(), "successor timestamp"));
        if (!state.telemetry.queue.includes(scenarioId)) state.telemetry.queue.push(scenarioId);
      } else {
        let classification;
        try {
          classification = callSync(classifyTelemetryError, error, "classifyTelemetryError");
          if (!["transient", "permanent"].includes(classification)) throw new Error("classifyTelemetryError must return transient or permanent.");
        } catch (callbackError) {
          quarantined = true;
          if (callbackError && typeof callbackError === "object") callbackError.workerFatal = true;
          throw callbackError;
        }
        scenario.error = error?.message ?? String(error);
        scenario.run = { ...scenario.run, exitCode: error?.exitCode ?? null };
        if (classification === "permanent" || scenario.attempts >= telemetryMaxAttempts) {
          scenario.status = "failed";
          iterationPhase = "failed";
          scenario.finishedAt = timestamp(now(), "telemetry failure timestamp");
          scenario.nextAttemptAt = null;
          if (classification !== "permanent") scenario.error += ` Telemetry retry exhausted after ${scenario.attempts} attempts.`;
        } else {
          scenario.status = "retrying";
          iterationPhase = "retrying";
          scenario.startedAt = null;
          scenario.finishedAt = null;
          scenario.nextAttemptAt = timestampAfter(now(), retryDelay(scenario.attempts, telemetryRetryBaseMs, telemetryRetryMaxMs));
          if (!state.telemetry.queue.includes(scenarioId)) state.telemetry.queue.push(scenarioId);
        }
      }
    } finally {
      if (!quarantined) {
        state.telemetry.active = null;
        if (!preserveScratch) rmSync(scratchDirectory, { recursive: true, force: true });
        scenario.updatedAt = timestamp(now(), "scenario update timestamp");
        queueProjection(`telemetry-${scenario.status}`, scenarioId);
        bumpAndPersist();
        try {
          const emitted = eventPublisher({
            ovenId: "differential-testing",
            subjectId: scenarioId,
            kind: "iteration",
            phase: iterationPhase,
            cursor: runId,
            occurredAt: scenario.updatedAt,
            payload: {
              requestId: request.requestId,
              runId,
              attempt: iterationAttempt,
              status: iterationPhase,
              published: iterationPhase === "complete",
              ...(iterationError ? { error: iterationError } : {}),
            },
          });
          if (emitted && typeof emitted.then === "function") {
            void Promise.resolve(emitted).catch(() => {});
            throw new Error("emitOvenEvent must complete synchronously.");
          }
        } catch (error) {
          try { onOvenEventError(error, { scenarioId, requestId: request.requestId, runId, phase: iterationPhase }); } catch {}
        }
      }
    }
  }

  function startProjectionIfDue() {
    if (projectionPromise || !["queued", "retrying"].includes(state.projection.status)) return;
    if (Date.parse(state.projection.nextAttemptAt || state.updatedAt) > Date.parse(now())) return;
    projectionPromise = executeProjection()
      .catch(fail)
      .finally(() => { projectionPromise = null; });
  }

  async function executeProjection() {
    const target = state.projection.requestedRevision;
    state.projection.status = "running";
    state.projection.startedAt = timestamp(now(), "projection start timestamp");
    state.projection.finishedAt = null;
    state.projection.attempts += 1;
    state.projection.nextAttemptAt = null;
    state.projection.error = null;
    bumpAndPersist();
    try {
      await project({
        root: repoRoot,
        statePath,
        revision: target,
        reasons: [...state.projection.reasons],
        scenarioIds: [...state.projection.scenarioIds],
      });
      if (state.projection.requestedRevision !== target) {
        resetQueuedProjection();
      } else {
        state.projection.status = "complete";
        state.projection.publishedRevision = target;
        state.projection.finishedAt = timestamp(now(), "projection completion timestamp");
        state.projection.nextAttemptAt = null;
        state.projection.reasons = [];
        state.projection.scenarioIds = [];
      }
    } catch (error) {
      if (state.projection.requestedRevision !== target) {
        resetQueuedProjection();
      } else if (state.projection.attempts >= projectionMaxAttempts) {
        state.projection.status = "failed";
        state.projection.finishedAt = timestamp(now(), "projection failure timestamp");
        state.projection.nextAttemptAt = null;
        state.projection.error = `${error?.message ?? String(error)} Projection retry exhausted after ${state.projection.attempts} attempts.`;
      } else {
        state.projection.status = "retrying";
        state.projection.error = error?.message ?? String(error);
        state.projection.nextAttemptAt = timestampAfter(now(), retryDelay(state.projection.attempts, projectionRetryBaseMs, projectionRetryMaxMs));
      }
    }
    bumpAndPersist();
  }

  function resetQueuedProjection() {
    state.projection.status = "queued";
    state.projection.attempts = 0;
    state.projection.nextAttemptAt = timestamp(now(), "projection queue timestamp");
    state.projection.error = null;
  }

  function queueProjection(reason, scenarioId) {
    state.projection.requestedRevision += 1;
    state.projection.reasons = uniqueStrings([...state.projection.reasons, requiredText(reason, "projection reason")]);
    state.projection.scenarioIds = uniqueStrings([...state.projection.scenarioIds, ...(scenarioId ? [requiredScenarioId(scenarioId)] : [])]);
    if (state.projection.status !== "running") resetQueuedProjection();
  }

  function bumpAndPersist() {
    state.revision += 1;
    state.updatedAt = timestamp(now(), "worker state timestamp");
    try {
      persistWorkerState(statePath, state);
    } catch (error) {
      const fatal = error instanceof Error ? error : new Error(String(error));
      fatal.workerFatal = true;
      fail(fatal);
      throw fatal;
    }
  }

  function loadWorkerState(path) {
    if (!existsSync(path)) return emptyWorkerState(timestamp(now(), "worker state timestamp"));
    let loaded;
    try { loaded = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { throw new Error(`Invalid Differential Testing worker state: ${error.message}`); }
    try { validateWorkerState(loaded); }
    catch (error) { throw new Error(`Invalid Differential Testing worker state: ${error.message}`); }
    return loaded;
  }

  function fail(error) {
    const fatal = error instanceof Error ? error : new Error(String(error));
    if (fatalError) return;
    fatalError = fatal;
    try { onFatal(fatal); } catch {}
  }

  function validateWorkerState(value) {
    assertDifferentialTestingWorkerState(value);
    const scenarioIds = Object.keys(value.scenarios);
    if (scenarioIds.length > maxScenarios
      || value.inbox.acceptedRequestIds.length > maxAcceptedRequestIds
      || value.inbox.rejected.length > maxRejectedEvents) throw new Error("configured worker state limit exceeded");
    for (const [scenarioId, scenario] of Object.entries(value.scenarios)) validateScenarioState(scenarioId, scenario);
  }

  function validateScenarioState(scenarioId, scenario) {
    const event = normalizeEventSummary(scenario.event);
    assertJsonSize(scenario.session, maxSessionBytes, "stored session");
    assertJsonSize(scenario.identity, maxIdentityBytes, "stored scenario identity");
    if (scenario.run !== null) {
      assertJsonSize(scenario.run, maxPublicationBytes, "stored run");
    }
    if (scenario.publication !== null) {
      assertJsonSize(scenario.publication, maxPublicationBytes, "stored publication");
    }
    callSync(validateStoredSession, {
      root: repoRoot,
      session: structuredClone(scenario.session),
      scenarioId,
      event: structuredClone(event),
    }, "validateStoredSession");
    validateStoredJobEnvelope(scenario.request, scenarioId);
    if (scenario.pendingRequest) validateStoredJobEnvelope(scenario.pendingRequest, scenarioId);
    callSync(validateScenarioIdentity, {
      root: repoRoot,
      storeDirectory: storeRoot,
      identity: structuredClone(scenario.identity),
      scenarioId,
      job: structuredClone(scenario.request),
    }, "validateScenarioIdentity");
  }

  function validateStoredJobEnvelope(job, scenarioId) {
    if (!job || typeof job !== "object" || Array.isArray(job)
      || job.scenarioId !== scenarioId
      || !requestIdPattern.test(String(job.requestId || ""))
      || !Number.isFinite(Date.parse(job.requestedAt || ""))) throw new Error(`stored job envelope mismatch for ${scenarioId}`);
    assertJsonSize(job, maxJobBytes, "stored job");
    callSync(validateStoredJob, structuredClone(job), "validateStoredJob");
  }
}

function emptyWorkerState(updatedAt) {
  return {
    schema: DIFFERENTIAL_TESTING_WORKER_STATE_SCHEMA,
    revision: 0,
    updatedAt,
    selectedScenarioId: null,
    inbox: { acceptedRequestIds: [], rejected: [] },
    telemetry: { queue: [], active: null },
    projection: {
      status: "idle",
      requestedRevision: 0,
      publishedRevision: null,
      reasons: [],
      scenarioIds: [],
      attempts: 0,
      nextAttemptAt: null,
      startedAt: null,
      finishedAt: null,
      error: null,
    },
    scenarios: {},
  };
}

function initialScenario({ job, identity, descriptor, currentTimestamp }) {
  return {
    identity: structuredClone(identity),
    session: structuredClone(descriptor.session),
    event: eventSummary(descriptor),
    status: "queued",
    request: structuredClone(job),
    pendingRequest: null,
    coalescedCount: 0,
    requestedAt: job.requestedAt,
    startedAt: null,
    finishedAt: null,
    updatedAt: currentTimestamp,
    run: null,
    publication: null,
    error: null,
    attempts: 0,
    nextAttemptAt: currentTimestamp,
  };
}

function assertGenericScenarioState(scenarioId, scenario) {
  assertExactKeys(scenario, [
    "identity", "session", "event", "status", "request", "pendingRequest", "coalescedCount",
    "requestedAt", "startedAt", "finishedAt", "updatedAt", "run", "publication", "error",
    "attempts", "nextAttemptAt",
  ], `scenario ${scenarioId}`);
  if (!scenarioStatuses.has(scenario.status)
    || !scenario.request || typeof scenario.request !== "object" || Array.isArray(scenario.request)
    || scenario.request.scenarioId !== scenarioId
    || !requestIdPattern.test(String(scenario.request.requestId || ""))
    || !Number.isFinite(Date.parse(scenario.request.requestedAt || ""))
    || (scenario.pendingRequest && (scenario.pendingRequest.scenarioId !== scenarioId
      || !requestIdPattern.test(String(scenario.pendingRequest.requestId || ""))
      || !Number.isFinite(Date.parse(scenario.pendingRequest.requestedAt || ""))))
    || !Number.isSafeInteger(scenario.coalescedCount) || scenario.coalescedCount < 0
    || !Number.isSafeInteger(scenario.attempts) || scenario.attempts < 0
    || !Number.isFinite(Date.parse(scenario.requestedAt || ""))
    || !Number.isFinite(Date.parse(scenario.updatedAt || ""))
    || !nullableTimestamp(scenario.startedAt)
    || !nullableTimestamp(scenario.finishedAt)
    || !nullableTimestamp(scenario.nextAttemptAt)
    || (scenario.error !== null && (typeof scenario.error !== "string" || !scenario.error))) {
    throw new Error(`scenario state mismatch for ${scenarioId}`);
  }
  const event = normalizeEventSummary(scenario.event);
  if (event.scenarioId !== scenarioId) throw new Error(`scenario event mismatch for ${scenarioId}`);
  if (scenario.run !== null && (!scenario.run || typeof scenario.run !== "object" || Array.isArray(scenario.run)
    || typeof scenario.run.id !== "string" || !scenario.run.id
    || typeof scenario.run.scratchDirectory !== "string" || !scenario.run.scratchDirectory)) {
    throw new Error(`scenario run mismatch for ${scenarioId}`);
  }
  if (scenario.publication !== null && (!scenario.publication || typeof scenario.publication !== "object"
    || Array.isArray(scenario.publication) || !requestIdPattern.test(String(scenario.publication.requestId || "")))) {
    throw new Error(`scenario publication mismatch for ${scenarioId}`);
  }
  if (scenario.status === "complete" && scenario.publication?.requestId !== scenario.request.requestId) {
    throw new Error(`completed scenario publication mismatch for ${scenarioId}`);
  }
}

function normalizeDescriptor(value) {
  try {
    assertExactKeys(value, ["requestId", "requestedAt", "scenarioId", "kind", "session", "telemetry"], "event descriptor");
    const descriptor = {
      requestId: requiredRequestId(value.requestId),
      requestedAt: timestamp(value.requestedAt, "event requestedAt"),
      scenarioId: requiredScenarioId(value.scenarioId),
      kind: requiredText(value.kind, "event kind"),
      session: structuredClone(value.session),
      telemetry: value.telemetry,
    };
    if (typeof descriptor.telemetry !== "boolean") throw new Error("Event descriptor telemetry must be boolean.");
    return descriptor;
  } catch (error) {
    if (error && typeof error === "object") error.permanent = true;
    throw error;
  }
}

function eventSummary(descriptor) {
  return {
    requestId: descriptor.requestId,
    requestedAt: descriptor.requestedAt,
    scenarioId: descriptor.scenarioId,
    kind: descriptor.kind,
    telemetry: descriptor.telemetry,
  };
}

function normalizeEventSummary(value) {
  assertExactKeys(value, ["requestId", "requestedAt", "scenarioId", "kind", "telemetry"], "scenario event");
  if (typeof value.telemetry !== "boolean") throw new Error("scenario event telemetry mismatch");
  return {
    requestId: requiredRequestId(value.requestId),
    requestedAt: timestamp(value.requestedAt, "scenario event requestedAt"),
    scenarioId: requiredScenarioId(value.scenarioId),
    kind: requiredText(value.kind, "scenario event kind"),
    telemetry: value.telemetry,
  };
}

function validateJobEnvelope(job, descriptor) {
  if (!job || typeof job !== "object" || Array.isArray(job)
    || job.requestId !== descriptor.requestId
    || job.requestedAt !== descriptor.requestedAt
    || job.scenarioId !== descriptor.scenarioId) throw permanentConflict("Validated job does not match its event descriptor.");
}

function assertInboxState(value, { maxAcceptedRequestIds, maxRejectedEvents }) {
  assertExactKeys(value, ["acceptedRequestIds", "rejected"], "worker inbox state");
  if (!Array.isArray(value.acceptedRequestIds)
    || value.acceptedRequestIds.length > maxAcceptedRequestIds
    || new Set(value.acceptedRequestIds).size !== value.acceptedRequestIds.length
    || value.acceptedRequestIds.some((id) => !requestIdPattern.test(id))
    || !Array.isArray(value.rejected) || value.rejected.length > maxRejectedEvents) throw new Error("inbox state mismatch");
  for (const rejection of value.rejected) {
    assertExactKeys(rejection, ["requestId", "requestedAt", "rejectedAt", "error"], "rejected inbox event");
    if (!requestIdPattern.test(rejection.requestId)
      || !Number.isFinite(Date.parse(rejection.requestedAt || ""))
      || !Number.isFinite(Date.parse(rejection.rejectedAt || ""))
      || typeof rejection.error !== "string" || !rejection.error) throw new Error("rejected inbox event mismatch");
  }
}

function assertTelemetryState(value, scenarioIds) {
  assertExactKeys(value, ["queue", "active"], "worker telemetry state");
  if (!Array.isArray(value.queue) || new Set(value.queue).size !== value.queue.length
    || value.queue.some((id) => !scenarioIds.includes(id))) throw new Error("telemetry queue mismatch");
  if (value.active !== null) {
    assertExactKeys(value.active, ["scenarioId", "requestId", "runId", "startedAt"], "active telemetry");
    if (!scenarioIds.includes(value.active.scenarioId)
      || !requestIdPattern.test(value.active.requestId)
      || typeof value.active.runId !== "string" || !value.active.runId
      || !Number.isFinite(Date.parse(value.active.startedAt || ""))) throw new Error("active telemetry mismatch");
  }
}

function assertProjectionState(value, scenarioIds) {
  assertExactKeys(value, ["status", "requestedRevision", "publishedRevision", "reasons", "scenarioIds", "attempts", "nextAttemptAt", "startedAt", "finishedAt", "error"], "projection state");
  const publishedRevision = value.publishedRevision ?? -1;
  if (!projectionStatuses.has(value.status)
    || !Number.isSafeInteger(value.requestedRevision) || value.requestedRevision < 0
    || (value.publishedRevision !== null && (!Number.isSafeInteger(value.publishedRevision)
      || value.publishedRevision < 0 || value.publishedRevision > value.requestedRevision))
    || !Array.isArray(value.reasons) || value.reasons.some((item) => typeof item !== "string" || !item)
    || !Array.isArray(value.scenarioIds) || value.scenarioIds.some((id) => !scenarioIds.includes(id))
    || !Number.isSafeInteger(value.attempts) || value.attempts < 0
    || !nullableTimestamp(value.nextAttemptAt)
    || !nullableTimestamp(value.startedAt)
    || !nullableTimestamp(value.finishedAt)
    || (value.error !== null && (typeof value.error !== "string" || !value.error))
    || (value.status === "idle" && (value.requestedRevision !== 0 || value.publishedRevision !== null))
    || (value.status === "complete" && publishedRevision !== value.requestedRevision)
    || (["queued", "running", "retrying"].includes(value.status) && value.requestedRevision <= publishedRevision)) {
    throw new Error("projection state mismatch");
  }
}

function recoverInterruptedState(state, currentTimestamp) {
  let changed = false;
  if (state.telemetry.active) {
    const scenario = state.scenarios[state.telemetry.active.scenarioId];
    if (scenario) {
      if (scenario.pendingRequest) queuePendingScenario(scenario, { recoveredSuperseded: true }, currentTimestamp);
      else {
        scenario.status = "queued";
        scenario.startedAt = null;
        scenario.nextAttemptAt = currentTimestamp;
      }
      if (!state.telemetry.queue.includes(state.telemetry.active.scenarioId)) state.telemetry.queue.push(state.telemetry.active.scenarioId);
    }
    state.telemetry.active = null;
    changed = true;
  }
  for (const [scenarioId, scenario] of Object.entries(state.scenarios)) {
    if (scenario.status !== "running") continue;
    if (scenario.pendingRequest) queuePendingScenario(scenario, { recoveredSuperseded: true }, currentTimestamp);
    else {
      scenario.status = "queued";
      scenario.startedAt = null;
      scenario.nextAttemptAt = currentTimestamp;
    }
    if (!state.telemetry.queue.includes(scenarioId)) state.telemetry.queue.push(scenarioId);
    changed = true;
  }
  if (state.projection.status === "running") {
    state.projection.status = "queued";
    state.projection.startedAt = null;
    state.projection.nextAttemptAt = currentTimestamp;
    changed = true;
  }
  if (changed) {
    state.revision += 1;
    state.updatedAt = currentTimestamp;
  }
}

function queuePendingScenario(scenario, run, currentTimestamp) {
  scenario.status = "queued";
  scenario.request = scenario.pendingRequest;
  scenario.pendingRequest = null;
  scenario.requestedAt = scenario.request.requestedAt;
  scenario.startedAt = null;
  scenario.finishedAt = null;
  scenario.updatedAt = currentTimestamp;
  scenario.error = null;
  scenario.attempts = 0;
  scenario.nextAttemptAt = currentTimestamp;
  scenario.run = { ...scenario.run, ...run };
}

function requestWasHandled(state, requestId) {
  return state.inbox.acceptedRequestIds.includes(requestId)
    || state.inbox.rejected.some((entry) => entry.requestId === requestId)
    || Object.values(state.scenarios).some((scenario) => scenario.event.requestId === requestId
      || scenario.request.requestId === requestId
      || scenario.pendingRequest?.requestId === requestId
      || scenario.publication?.requestId === requestId);
}

function recordAcceptedRequest(state, requestId, limit) {
  state.inbox.acceptedRequestIds = [...state.inbox.acceptedRequestIds.filter((id) => id !== requestId), requestId].slice(-limit);
}

async function runWithTimeout(callback, options, timeoutMs, abortGraceMs) {
  const controller = new AbortController();
  const execution = Promise.resolve().then(() => callback({ ...options, signal: controller.signal }));
  const completion = execution.then(
    (value) => ({ status: "fulfilled", value }),
    (error) => ({ status: "rejected", error }),
  );
  let timeoutTimer;
  const expired = new Promise((resolveExpired) => { timeoutTimer = setTimeout(() => resolveExpired({ status: "timeout" }), timeoutMs); });
  const first = await Promise.race([completion, expired]);
  clearTimeout(timeoutTimer);
  if (first.status === "fulfilled") return first.value;
  if (first.status === "rejected") throw first.error;
  controller.abort();
  let graceTimer;
  const graceExpired = new Promise((resolveGrace) => { graceTimer = setTimeout(() => resolveGrace({ status: "abort-grace-expired" }), abortGraceMs); });
  const settled = await Promise.race([completion, graceExpired]);
  clearTimeout(graceTimer);
  if (settled.status === "abort-grace-expired") {
    const error = new Error(`Telemetry did not stop within the ${abortGraceMs}ms abort grace.`);
    error.permanent = true;
    error.preserveScratch = true;
    error.workerFatal = true;
    throw error;
  }
  const error = new Error(`Differential Testing telemetry exceeded ${timeoutMs}ms.`);
  error.code = "ETIMEDOUT";
  throw error;
}

function persistWorkerState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx");
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`);
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

function acquireWorkerLock(storeRoot) {
  mkdirSync(storeRoot, { recursive: true });
  const path = resolve(storeRoot, ".worker.lock");
  const token = randomUUID();
  const create = () => writeFileSync(path, `${JSON.stringify({ pid: process.pid, token })}\n`, { flag: "wx" });
  try { create(); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(readFileSync(path, "utf8")); } catch {}
    if (Number.isInteger(owner?.pid) && processIsAlive(owner.pid)) {
      const lockError = new Error(`Differential Testing worker is already running as pid ${owner.pid}.`);
      lockError.code = "ELOCKED";
      throw lockError;
    }
    rmSync(path, { force: true });
    create();
  }
  return () => {
    try {
      const owner = JSON.parse(readFileSync(path, "utf8"));
      if (owner.token === token) rmSync(path, { force: true });
    } catch {}
  };
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

function callSync(callback, value, label) {
  const result = callback(value);
  if (result && typeof result.then === "function") throw new Error(`${label} must be synchronous.`);
  return result;
}

function assertJsonSize(value, limit, label) {
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value)); }
  catch (error) { throw new Error(`${label} is not serializable: ${error.message}`); }
  if (bytes > limit) throw new Error(`${label} exceeds ${limit} bytes.`);
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) throw new Error(`${label} shape mismatch.`);
}

function isPermanent(error) {
  return error?.permanent === true || (Number(error?.status) >= 400 && Number(error?.status) < 500);
}

function isTransientIo(error) {
  return ["EAGAIN", "EBUSY", "EIO", "EMFILE", "ENFILE", "ENOMEM"].includes(error?.code)
    || error?.transient === true;
}

function permanentUnlessTransient(error) {
  const result = error instanceof Error ? error : new Error(String(error));
  if (!isTransientIo(result)) result.permanent = true;
  return result;
}

function permanentConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.permanent = true;
  return error;
}

function requiredRequestId(value) {
  const requestId = String(value || "");
  if (!requestIdPattern.test(requestId)) throw permanentConflict("requestId must be a lowercase SHA-256 digest.");
  return requestId;
}

function requiredScenarioId(value) {
  const scenarioId = String(value || "");
  if (!scenarioIdPattern.test(scenarioId)) throw permanentConflict("scenarioId must be a lowercase 16-character hexadecimal id.");
  return scenarioId;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function timestamp(value, label) {
  if (!Number.isFinite(Date.parse(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}

function nullableTimestamp(value) {
  return value === null || Number.isFinite(Date.parse(value || ""));
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
}

function retryDelay(attempts, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, Math.min(30, attempts - 1))));
}

function timestampAfter(value, delayMs) {
  return new Date(Date.parse(value) + delayMs).toISOString();
}

function uniqueStrings(values) {
  return [...new Set(values)].sort();
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function containedPath(root, path, label) {
  const base = resolve(root);
  const target = isAbsolute(path) ? resolve(path) : resolve(base, path);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error(`${label} escapes ${base}: ${target}`);
  return target;
}

function displayPath(root, path) {
  const value = relative(root, path);
  return value && !value.startsWith("..") && !isAbsolute(value) ? value.split(sep).join("/") : resolve(path);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
