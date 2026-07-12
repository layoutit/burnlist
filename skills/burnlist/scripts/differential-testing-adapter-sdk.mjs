import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
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

export const DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION = 1;
const scenarioIdPattern = /^[a-f0-9]{16}$/u;
const refreshStatuses = new Set(["queued", "running", "complete", "failed"]);

export function createDifferentialTestingRefreshQueue({
  root = process.cwd(),
  storeDirectory = ".local/differential-testing",
  stateSchema = "project-differential-testing-refresh-state@1",
  validateRequest,
  runTelemetry,
  publishTelemetry,
  scenarioIdentity = (job) => ({ scenarioId: job.scenarioId }),
  assertCausalSuccessor = () => {},
  validateStoredJob,
  onStateChange = null,
  now = () => new Date().toISOString(),
  maxScenarios = 256,
  maxJobBytes = 128 * 1024,
  maxAcceptedRequestIds = 256,
} = {}) {
  if (typeof validateRequest !== "function") throw new Error("validateRequest is required.");
  if (typeof runTelemetry !== "function") throw new Error("runTelemetry is required.");
  if (typeof publishTelemetry !== "function") throw new Error("publishTelemetry is required.");
  if (typeof scenarioIdentity !== "function") throw new Error("scenarioIdentity must be a function.");
  if (typeof assertCausalSuccessor !== "function") throw new Error("assertCausalSuccessor must be a function.");
  if (typeof validateStoredJob !== "function") throw new Error("validateStoredJob must be a function.");
  if (typeof stateSchema !== "string" || !stateSchema.trim()) throw new Error("stateSchema must be a non-empty string.");
  for (const [value, label] of [[maxScenarios, "maxScenarios"], [maxJobBytes, "maxJobBytes"], [maxAcceptedRequestIds, "maxAcceptedRequestIds"]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  }

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
  let workerPromise = null;
  let closed = false;

  try {
    for (const [scenarioId, scenario] of Object.entries(state.scenarios)) {
      if (scenario.status !== "running") continue;
      scenario.status = "queued";
      scenario.startedAt = null;
      scenario.error = null;
      if (!state.queue.includes(scenarioId)) state.queue.push(scenarioId);
    }
    state.activeJobId = null;
    persist();
  } catch (error) {
    releaseStoreLock();
    throw error;
  }

  const api = {
    statePath,
    snapshot: () => structuredClone(state),
    scenarioStatus: (scenarioId) => structuredClone(state.scenarios[String(scenarioId || "")] ?? null),
    async accept(request) {
      if (closed) throw new Error("Differential Testing refresh queue is closed.");
      const job = await validateRequest({ root: repoRoot, storeDirectory: storeRoot, request });
      assertJobEnvelope(job, { maxJobBytes });
      callSync(validateStoredJob, job, "validateStoredJob");
      const existing = state.scenarios[job.scenarioId] ?? null;
      if (existing && new Set(existing.acceptedRequestIds).has(job.requestId)) {
        return { status: "already-accepted", scenario: structuredClone(existing) };
      }
      if (existing) callSync(assertCausalSuccessor, { current: existing.pendingRequest ?? existing.request, candidate: job, scenario: structuredClone(existing) }, "assertCausalSuccessor");
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
          updatedAt: timestamp,
        });
        if (!state.queue.includes(job.scenarioId)) state.queue.push(job.scenarioId);
      }
      bumpAndPersist(timestamp);
      schedule();
      return { status: state.scenarios[job.scenarioId].status, scenario: structuredClone(state.scenarios[job.scenarioId]) };
    },
    start: schedule,
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
      releaseStoreLock();
    },
  };

  if (state.queue.length > 0) schedule();
  return api;

  function schedule() {
    if (closed || scheduled || workerPromise || state.queue.length === 0) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (workerPromise || state.queue.length === 0) return;
      workerPromise = drain().finally(() => {
        workerPromise = null;
        if (state.queue.length > 0) schedule();
      });
    });
  }

  async function drain() {
    while (state.queue.length > 0) {
      const scenarioId = state.queue.shift();
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
        run: { id: runId, scratchDirectory: displayPath(repoRoot, scratchDirectory) },
      });
      state.activeJobId = runId;
      bumpAndPersist();
      try {
        const staged = await runTelemetry({
          root: repoRoot,
          storeDirectory: storeRoot,
          scratchDirectory,
          request,
        });
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
          scenario.publication = publication;
          scenario.run = { ...scenario.run, exitCode: staged.exitCode };
        }
      } catch (error) {
        if (scenario.pendingRequest) {
          queuePendingSuccessor(state, scenarioId, scenario, { superseded: true, discardedError: error?.message ?? String(error) }, now());
        } else {
          scenario.status = "failed";
          scenario.finishedAt = now();
          scenario.error = error?.message ?? String(error);
          scenario.run = { ...scenario.run, exitCode: error?.exitCode ?? null };
        }
      } finally {
        state.activeJobId = null;
        rmSync(scratchDirectory, { recursive: true, force: true });
        bumpAndPersist();
      }
    }
  }

  function bumpAndPersist(timestamp = now()) {
    assertTimestamp(timestamp, "state timestamp");
    state.revision += 1;
    state.updatedAt = timestamp;
    persist();
  }

  function persist() {
    writeJsonAtomic(statePath, state);
    for (const [scenarioId, scenario] of Object.entries(state.scenarios)) {
      const scenarioDirectory = resolve(storeRoot, "scenarios", scenarioId);
      mkdirSync(scenarioDirectory, { recursive: true });
      assertNoSymlinkComponents(storeRoot, scenarioDirectory, "scenario state directory");
      writeJsonAtomic(resolve(scenarioDirectory, "run-state.json"), scenario);
    }
    if (typeof onStateChange !== "function") return;
    try {
      callSync(onStateChange, structuredClone(state), "onStateChange");
      state.ovenPublication = { status: "complete", updatedAt: now(), error: null };
    } catch (error) {
      state.ovenPublication = { status: "failed", updatedAt: now(), error: error?.message ?? String(error) };
    }
    writeJsonAtomic(statePath, state);
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
    for (const [scenarioId, payload] of payloads) writeJsonAtomic(resolve(generation, "scenarios", `${scenarioId}.json`), payload);
    writeJsonAtomic(resolve(generation, "current.json"), currentPayload);
    if (existsSync(root) && !lstatSync(root).isSymbolicLink()) throw new Error(`Oven bundle path must be an atomic symlink: ${root}`);
    symlinkSync(basename(generation), temporaryLink, "dir");
    renameSync(temporaryLink, root);
    pruneGenerations(parent, outputName, generation, keepGenerations);
  } finally {
    rmSync(temporaryLink, { force: true });
    if (activeGeneration(root) !== generation) rmSync(generation, { recursive: true, force: true });
  }
  return { outputRoot: root, generation, selectedScenarioId, scenarioCount: payloads.size };
}

export async function submitDifferentialTestingRequest({
  endpoint,
  request,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  if (!endpoint) throw new Error("endpoint is required.");
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("request must be an object.");
  if (typeof fetchImpl !== "function") return { status: "unavailable", request, error: "fetch is unavailable" };
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) return { status: "rejected", request, httpStatus: response.status, error: String(body?.error || `HTTP ${response.status}`) };
    return { status: String(body?.status || "queued"), request, response: body };
  } catch (error) {
    return { status: "unavailable", request, error: error?.message ?? String(error) };
  }
}

export function createDifferentialTestingWorkerHandler({
  queue,
  serviceName = "differential-testing-worker",
  requestPaths = ["/api/improvements", "/api/scenarios"],
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
  const expected = ["schema", "revision", "updatedAt", "activeJobId", "selectedScenarioId", "ovenPublication", "queue", "scenarios"];
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
    const scenarioKeys = ["status", "identity", "request", "pendingRequest", "coalescedCount", "requestedAt", "startedAt", "finishedAt", "updatedAt", "run", "publication", "error", "acceptedRequestIds"];
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
      || !scenario.acceptedRequestIds.includes(scenario.request.requestId)
      || (scenario.pendingRequest && !scenario.acceptedRequestIds.includes(scenario.pendingRequest.requestId))) throw new Error(`scenario state mismatch for ${scenarioId}`);
    assertJobEnvelope(scenario.request, { maxJobBytes });
    if (scenario.pendingRequest) assertJobEnvelope(scenario.pendingRequest, { maxJobBytes });
    callSync(validateStoredJob, scenario.request, "validateStoredJob");
    if (scenario.pendingRequest) callSync(validateStoredJob, scenario.pendingRequest, "validateStoredJob");
  }
  if (state.ovenPublication !== null
    && (!state.ovenPublication || typeof state.ovenPublication !== "object" || Array.isArray(state.ovenPublication)
      || !["complete", "failed"].includes(state.ovenPublication.status)
      || !Number.isFinite(Date.parse(state.ovenPublication.updatedAt || ""))
      || (state.ovenPublication.status === "complete" && state.ovenPublication.error !== null)
      || (state.ovenPublication.status === "failed" && typeof state.ovenPublication.error !== "string"))) throw new Error("Oven publication state mismatch");
}

function emptyState(schema) {
  return { schema, revision: 0, updatedAt: new Date().toISOString(), activeJobId: null, selectedScenarioId: null, ovenPublication: null, queue: [], scenarios: {} };
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

function acquireStoreLock(storeRoot) {
  const path = resolve(storeRoot, ".refresh-worker.lock");
  const token = randomUUID();
  const create = () => writeFileSync(path, `${JSON.stringify({ pid: process.pid, token })}\n`, { flag: "wx" });
  try {
    create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(readFileSync(path, "utf8")); } catch {}
    if (Number.isInteger(owner?.pid) && processIsAlive(owner.pid)) {
      const lockError = new Error(`Differential Testing refresh store is already locked by pid ${owner.pid}.`);
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

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
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
  for (const generation of generations) if (!keep.has(generation.path)) rmSync(generation.path, { recursive: true, force: true });
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
