import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION,
  DIFFERENTIAL_TESTING_WORKER_STATE_SCHEMA,
  createDifferentialTestingWorker,
} from "./differential-testing-adapter-sdk.mjs";

test("SDK v3 persists one state before inbox deletion and handles projection-only events", async () => {
  assert.equal(DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION, 3);
  const root = await mkdtemp(join(tmpdir(), "burnlist-differential-worker-"));
  const inbox = [];
  const durableBeforeDelete = [];
  let telemetryRuns = 0;
  let projectionRuns = 0;
  try {
    const first = job("1111111111111111", "a".repeat(64), 1);
    inbox.push(entry(eventFor(first, true)));
    const worker = fixtureWorker({
      root,
      inbox,
      async deleteInbox(current) {
        const state = JSON.parse(await readFile(worker.statePath, "utf8"));
        durableBeforeDelete.push(state.inbox.acceptedRequestIds.includes(current.event.requestId));
        removeEntry(inbox, current);
      },
      async runTelemetry({ request }) {
        telemetryRuns += 1;
        return { exitCode: 1, staged: { requestId: request.requestId } };
      },
      async project() { projectionRuns += 1; },
    });
    worker.start();
    await worker.idle();
    assert.equal(telemetryRuns, 1);
    assert.equal(worker.scenarioStatus(first.scenarioId).status, "complete");

    const projectionOnly = eventFor(job(first.scenarioId, "b".repeat(64), 1), false, { revision: 2 });
    inbox.push(entry(projectionOnly));
    await worker.idle();
    assert.equal(telemetryRuns, 1);
    assert.deepEqual(worker.scenarioStatus(first.scenarioId).session, { revision: 2 });

    const revision = worker.snapshot().revision;
    inbox.push(entry(projectionOnly));
    await worker.idle();
    assert.equal(worker.snapshot().revision, revision);
    assert.equal(inbox.length, 0);
    assert.ok(durableBeforeDelete.every(Boolean));
    assert.ok(projectionRuns >= 2);
    assert.equal(JSON.parse(await readFile(worker.statePath, "utf8")).schema, DIFFERENTIAL_TESTING_WORKER_STATE_SCHEMA);
    worker.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SDK v3 serializes scenarios and coalesces one running successor", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-differential-serial-"));
  const inbox = [];
  const releases = [];
  const starts = [];
  let active = 0;
  let maxActive = 0;
  try {
    const first = job("1111111111111111", "a".repeat(64), 1);
    const second = job("2222222222222222", "b".repeat(64), 1);
    const successor = job(first.scenarioId, "c".repeat(64), 2, first.requestId);
    inbox.push(entry(eventFor(first, true)), entry(eventFor(second, true)));
    const worker = fixtureWorker({
      root,
      inbox,
      async runTelemetry({ request }) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        starts.push(request.requestId);
        await new Promise((resolveRelease) => releases.push(resolveRelease));
        active -= 1;
        return { exitCode: 1, staged: { requestId: request.requestId } };
      },
    });
    worker.start();
    await waitFor(() => worker.scenarioStatus(first.scenarioId)?.status === "running");
    inbox.push(entry(eventFor(successor, true)));
    await worker.poll();
    assert.equal(worker.scenarioStatus(first.scenarioId).pendingRequest.requestId, successor.requestId);
    releases.shift()();
    await waitFor(() => starts.length === 2);
    assert.deepEqual(starts, [first.requestId, second.requestId]);
    releases.shift()();
    await waitFor(() => starts.length === 3);
    assert.equal(starts[2], successor.requestId);
    releases.shift()();
    await worker.idle();
    assert.equal(maxActive, 1);
    assert.equal(worker.scenarioStatus(first.scenarioId).status, "complete");
    assert.equal(worker.scenarioStatus(second.scenarioId).status, "complete");
    worker.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SDK v3 retries transient work and recovers interrupted telemetry and projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-differential-restart-"));
  const request = job("1111111111111111", "a".repeat(64), 1);
  let telemetryRuns = 0;
  let projectionRuns = 0;
  try {
    const seed = fixtureWorker({ root, inbox: [] });
    const state = seed.snapshot();
    seed.close();
    const current = new Date().toISOString();
    state.revision = 4;
    state.updatedAt = current;
    state.selectedScenarioId = request.scenarioId;
    state.inbox.acceptedRequestIds = [request.requestId];
    state.telemetry.active = {
      scenarioId: request.scenarioId,
      requestId: request.requestId,
      runId: "interrupted",
      startedAt: current,
    };
    state.projection = {
      status: "running",
      requestedRevision: 2,
      publishedRevision: 1,
      reasons: ["telemetry-running"],
      scenarioIds: [request.scenarioId],
      attempts: 1,
      nextAttemptAt: null,
      startedAt: current,
      finishedAt: null,
      error: null,
    };
    state.scenarios[request.scenarioId] = scenarioState(request, current);
    await writeJson(join(root, ".local", "differential-testing", "state.json"), state);

    const worker = fixtureWorker({
      root,
      inbox: [],
      async runTelemetry({ request: resumed }) {
        telemetryRuns += 1;
        if (telemetryRuns === 1) throw new Error("temporary telemetry failure");
        return { exitCode: 1, staged: { requestId: resumed.requestId } };
      },
      async project() {
        projectionRuns += 1;
        if (projectionRuns === 1) throw new Error("temporary projection failure");
      },
    });
    assert.equal(worker.scenarioStatus(request.scenarioId).status, "queued");
    assert.equal(worker.snapshot().projection.status, "queued");
    worker.start();
    await worker.idle();
    assert.equal(telemetryRuns, 2);
    assert.ok(projectionRuns >= 2);
    assert.equal(worker.scenarioStatus(request.scenarioId).status, "complete");
    assert.equal(worker.snapshot().projection.status, "complete");
    worker.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SDK v3 quarantines an uncooperative timed-out runner and enforces one worker lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-differential-timeout-"));
  const request = job("1111111111111111", "a".repeat(64), 1);
  const inbox = [entry(eventFor(request, true))];
  let fatal = null;
  try {
    const worker = fixtureWorker({
      root,
      inbox,
      telemetryTimeoutMs: 10,
      telemetryAbortGraceMs: 10,
      telemetryMaxAttempts: 1,
      onFatal(error) { fatal = error; },
      runTelemetry: async () => new Promise(() => {}),
    });
    assert.throws(() => fixtureWorker({ root, inbox: [] }), (error) => error?.code === "ELOCKED");
    worker.start();
    await assert.rejects(worker.idle(), /abort grace/u);
    assert.match(fatal?.message ?? "", /abort grace/u);
    assert.throws(() => worker.scenarioStatus(request.scenarioId), /abort grace/u);
    worker.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SDK v3 rejects legacy state and delete callback configuration failures are fatal", async () => {
  const legacyRoot = await mkdtemp(join(tmpdir(), "burnlist-differential-legacy-"));
  try {
    await writeJson(join(legacyRoot, ".local", "differential-testing", "state.json"), {
      schema: "project-differential-testing-refresh-state@2",
      revision: 0,
    });
    assert.throws(() => fixtureWorker({ root: legacyRoot, inbox: [] }), /Invalid Differential Testing worker state/u);
  } finally {
    await rm(legacyRoot, { recursive: true, force: true });
  }

  const root = await mkdtemp(join(tmpdir(), "burnlist-differential-delete-"));
  const request = job("1111111111111111", "a".repeat(64), 1);
  const inbox = [entry(eventFor(request, true))];
  let worker;
  try {
    worker = fixtureWorker({
      root,
      inbox,
      deleteInbox() { throw new Error("bad delete callback"); },
    });
    worker.start();
    await assert.rejects(worker.idle(), /bad delete callback/u);
    assert.equal(inbox.length, 1);
    assert.equal(JSON.parse(await readFile(worker.statePath, "utf8")).inbox.acceptedRequestIds[0], request.requestId);
  } finally {
    try { worker?.close(); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});

function fixtureWorker({ root, inbox, ...overrides }) {
  return createDifferentialTestingWorker({
    root,
    pollIntervalMs: 5,
    telemetryRetryBaseMs: 2,
    telemetryRetryMaxMs: 4,
    projectionRetryBaseMs: 2,
    projectionRetryMaxMs: 4,
    readInbox: () => [...inbox],
    deleteInbox: (current) => removeEntry(inbox, current),
    describeEvent: ({ event }) => ({
      requestId: event.requestId,
      requestedAt: event.requestedAt,
      scenarioId: event.scenarioId,
      kind: event.kind,
      session: structuredClone(event.session),
      telemetry: event.telemetry,
    }),
    validateRequest: async ({ event }) => structuredClone(event.job),
    validateStoredJob(value) {
      if (!value || !/^[a-f0-9]{64}$/u.test(String(value.requestId || ""))) throw new Error("invalid fixture job");
    },
    validateStoredSession({ session }) {
      if (!session || !Number.isSafeInteger(session.revision)) throw new Error("invalid fixture session");
    },
    scenarioIdentity: (value) => ({ scenarioId: value.scenarioId }),
    validateScenarioIdentity({ identity, scenarioId }) {
      if (identity?.scenarioId !== scenarioId) throw new Error("invalid fixture identity");
    },
    assertCausalSuccessor({ current, candidate }) {
      if (current === null && candidate.previousRequestId !== null) throw conflict("successor has no baseline");
      if (current && candidate.previousRequestId !== current.requestId) throw conflict("successor branches");
    },
    async runTelemetry({ request: current }) {
      return { exitCode: 1, staged: { requestId: current.requestId } };
    },
    publishTelemetry: ({ request: current }) => ({ requestId: current.requestId, reportPath: `${current.requestId}.json` }),
    classifyTelemetryError: (error) => error?.permanent === true ? "permanent" : "transient",
    project: async () => {},
    ...overrides,
  });
}

function job(scenarioId, requestId, revision, previousRequestId = null) {
  return {
    requestId,
    requestedAt: new Date().toISOString(),
    scenarioId,
    revision,
    previousRequestId,
  };
}

function eventFor(value, telemetry, session = { revision: value.revision }) {
  return {
    requestId: value.requestId,
    requestedAt: value.requestedAt,
    scenarioId: value.scenarioId,
    kind: telemetry ? "telemetry" : "projection-only",
    session,
    telemetry,
    ...(telemetry ? { job: structuredClone(value) } : {}),
  };
}

function entry(event) {
  return { event, eventPath: `/inbox/${event.requestId}.json` };
}

function removeEntry(inbox, current) {
  const index = inbox.findIndex((candidate) => candidate.eventPath === current.eventPath);
  if (index >= 0) inbox.splice(index, 1);
}

function scenarioState(request, current) {
  return {
    identity: { scenarioId: request.scenarioId },
    session: { revision: request.revision },
    event: {
      requestId: request.requestId,
      requestedAt: request.requestedAt,
      scenarioId: request.scenarioId,
      kind: "telemetry",
      telemetry: true,
    },
    status: "running",
    request,
    pendingRequest: null,
    coalescedCount: 0,
    requestedAt: request.requestedAt,
    startedAt: current,
    finishedAt: null,
    updatedAt: current,
    run: { id: "interrupted", scratchDirectory: ".local/differential-testing/.scratch/interrupted" },
    publication: null,
    error: null,
    attempts: 1,
    nextAttemptAt: null,
  };
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.permanent = true;
  return error;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for worker state");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
}
