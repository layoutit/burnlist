import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildPayload } from "../examples/differential-testing/adapter.mjs";
import {
  createDifferentialTestingRefreshQueue,
  createDifferentialTestingWorkerHandler,
  publishDifferentialTestingOvenBundle,
  submitDifferentialTestingRequest,
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
      stateSchema: "fixture-refresh-state@1",
      validateRequest: async ({ request }) => structuredClone(request.job),
      validateStoredJob() {},
      scenarioIdentity: (job) => ({ scenarioId: job.scenarioId, replay: job.replay }),
      assertCausalSuccessor({ current, candidate: next }) {
        if (next.parentRevision !== current.revision) {
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
      stateSchema: "fixture-refresh-state@1",
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

    state.cadenceFrames = 10;
    await writeFile(first.statePath, `${JSON.stringify(state)}\n`);
    assert.throws(() => createDifferentialTestingRefreshQueue(options), /Invalid Differential Testing refresh state: shape mismatch/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic refresh queue locks one store and fails closed on malformed callbacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-adapter-hardening-"));
  const base = {
    root,
    stateSchema: "fixture-refresh-state@1",
    validateRequest: async ({ request }) => structuredClone(request.job),
    validateStoredJob() {},
    scenarioIdentity: (entry) => ({ scenarioId: entry.scenarioId }),
    runTelemetry: async () => undefined,
    publishTelemetry: ({ request }) => ({ requestId: request.requestId }),
  };
  try {
    const queue = createDifferentialTestingRefreshQueue(base);
    assert.throws(() => createDifferentialTestingRefreshQueue(base), (error) => error?.code === "ELOCKED");
    await queue.accept({ job: job("1111111111111111", "a", "1", "0") });
    await queue.idle();
    assert.equal(queue.scenarioStatus("1111111111111111").status, "failed");
    assert.match(queue.scenarioStatus("1111111111111111").error, /runTelemetry must return/u);
    queue.close();

    const asyncPublisher = createDifferentialTestingRefreshQueue({
      ...base,
      runTelemetry: async ({ request }) => ({ exitCode: 0, staged: { requestId: request.requestId } }),
      onStateChange: async () => { throw new Error("async publication failed"); },
    });
    assert.equal(asyncPublisher.snapshot().ovenPublication.status, "failed");
    assert.match(asyncPublisher.snapshot().ovenPublication.error, /must be synchronous/u);
    asyncPublisher.close();
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
    assert.deepEqual(JSON.parse(await readFile(join(outputRoot, "current.json"), "utf8")), payload);
    assert.deepEqual(JSON.parse(await readFile(join(outputRoot, "scenarios", `${scenarioId}.json`), "utf8")), payload);

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

test("generic signal client preserves accepted, rejected, and unavailable outcomes", async () => {
  const accepted = await submitDifferentialTestingRequest({
    endpoint: "http://worker.invalid/api/improvements",
    request: { id: "accepted" },
    fetchImpl: async () => ({ ok: true, async json() { return { status: "queued" }; } }),
  });
  assert.equal(accepted.status, "queued");
  const rejected = await submitDifferentialTestingRequest({
    endpoint: "http://worker.invalid/api/improvements",
    request: { id: "rejected" },
    fetchImpl: async () => ({ ok: false, status: 409, async json() { return { error: "branched" }; } }),
  });
  assert.deepEqual({ status: rejected.status, httpStatus: rejected.httpStatus, error: rejected.error }, { status: "rejected", httpStatus: 409, error: "branched" });
  const unavailable = await submitDifferentialTestingRequest({
    endpoint: "http://worker.invalid/api/improvements",
    request: { id: "offline" },
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(unavailable.status, "unavailable");
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
    const submission = await fetch(`${origin}/api/improvements`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "fixture" }) });
    assert.equal(submission.status, 202);
    assert.deepEqual(accepted, [{ id: "fixture" }]);
    const falseSuccess = await fetch(`${origin}/api/improvements`, { method: "POST", body: JSON.stringify({ reject: true }) });
    assert.equal(falseSuccess.status, 500);
    const oversized = await fetch(`${origin}/api/improvements`, { method: "POST", body: JSON.stringify({ value: "x".repeat(100) }) });
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
