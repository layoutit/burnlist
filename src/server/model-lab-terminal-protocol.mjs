import { randomBytes, timingSafeEqual } from "node:crypto";

export const MODEL_LAB_TERMINAL_PROTOCOL = "burnlist-model-lab-terminal@1";
const SESSION_ID = /^[a-f0-9]{32}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const PRODUCER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MAX_PENDING_COMMANDS = 64;
const MAX_COMPLETED_COMMANDS = 64;
const DEFAULT_MAX_SESSIONS = 64;
const DEFAULT_RECONNECT_GRACE_MS = 30_000;

export function createModelLabTerminalProtocol({ writeToken, now = () => Date.now(), random = token, maxSessions = DEFAULT_MAX_SESSIONS, reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS } = {}) {
  if (typeof writeToken !== "string" || !writeToken) throw new Error("Model Lab terminal protocol requires a controller token.");
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) throw new Error("maxSessions must be a positive integer.");
  if (!Number.isSafeInteger(reconnectGraceMs) || reconnectGraceMs < 0) throw new Error("reconnectGraceMs must be a non-negative integer.");
  const sessions = new Map();

  function begin({ producerId, ttlMs = 30_000 } = {}) {
    assertProducerId(producerId);
    assertTtl(ttlMs);
    pruneExpiredSessions();
    if (sessions.size >= maxSessions) fail("SESSION_LIMIT", "Too many Model Lab sessions.", 429);
    const sessionId = random();
    const producerToken = random();
    const startedAt = now();
    const session = { sessionId, producerId, producerToken, ttlMs, reconnectGraceMs, generation: 1, expiresAt: startedAt + ttlMs, sequence: -1, state: null, commands: new Map(), clock: now };
    sessions.set(sessionId, session);
    return publicProducerSession(session);
  }

  function reconnect({ sessionId, producerId, producerToken } = {}) {
    const session = sessionFor(sessionId);
    assertProducer(session, producerId, producerToken);
    if (expiredBeyondGrace(session)) {
      sessions.delete(sessionId);
      fail("UNKNOWN_SESSION", "Model Lab session is unavailable.", 404);
    }
    session.generation += 1;
    session.producerToken = random();
    session.expiresAt = now() + session.ttlMs;
    session.sequence = -1;
    session.state = null;
    session.commands.clear();
    return publicProducerSession(session);
  }

  function publish({ sessionId, producerId, producerToken, generation, sequence, state } = {}) {
    const session = sessionFor(sessionId);
    assertProducer(session, producerId, producerToken);
    assertActive(session);
    if (generation !== session.generation) fail("STALE_GENERATION", "Producer generation is stale.", 409);
    if (!Number.isSafeInteger(sequence) || sequence <= session.sequence) fail("STALE_STATE", "Producer state sequence is stale.", 409);
    assertState(state);
    session.sequence = sequence;
    session.state = clone(state);
    session.expiresAt = now() + session.ttlMs;
    return read(session.sessionId);
  }

  function read(sessionId) {
    const session = sessionFor(sessionId);
    if (expired(session)) return unavailable(session, "expired");
    if (!session.state) return unavailable(session, "connecting");
    return { schema: MODEL_LAB_TERMINAL_PROTOCOL, status: "ready", sessionId: session.sessionId, generation: session.generation, expiresAt: session.expiresAt, state: clone(session.state) };
  }

  function command({ sessionId, requestId, command: commandName, frameIndex } = {}) {
    const session = sessionFor(sessionId);
    assertActive(session);
    if (!REQUEST_ID.test(requestId ?? "")) fail("BAD_REQUEST", "requestId is invalid.", 400);
    const fingerprint = JSON.stringify({ command: commandName, frameIndex });
    const prior = session.commands.get(requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail("IDEMPOTENCY_CONFLICT", "requestId was already used for another command.", 409);
      return commandResponse(session, prior, true);
    }
    if (commandName !== "set-frame") fail("UNSUPPORTED_COMMAND", "Only set-frame is supported.", 400);
    const count = session.state?.frame?.count;
    if (session.state?.status !== "ready" || !Number.isSafeInteger(count)) fail("UNAVAILABLE", "Model Lab is not ready for frame commands.", 409);
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= count) fail("BAD_FRAME", "frameIndex is outside the published frame set.", 400);
    if (pendingCommandCount(session) >= MAX_PENDING_COMMANDS) fail("COMMAND_LIMIT", "Too many unresolved commands.", 429);
    const entry = { requestId, fingerprint, command: commandName, frameIndex, result: null };
    session.commands.set(requestId, entry);
    return commandResponse(session, entry, false);
  }

  function nextCommand({ sessionId, producerId, producerToken, generation } = {}) {
    const session = sessionFor(sessionId);
    assertProducer(session, producerId, producerToken);
    assertActive(session);
    if (generation !== session.generation) fail("STALE_GENERATION", "Producer generation is stale.", 409);
    const entry = [...session.commands.values()].find((candidate) => !candidate.result);
    return entry ? { schema: MODEL_LAB_TERMINAL_PROTOCOL, sessionId, generation, requestId: entry.requestId, command: entry.command, frameIndex: entry.frameIndex } : { schema: MODEL_LAB_TERMINAL_PROTOCOL, sessionId, generation, command: null };
  }

  function result({ sessionId, producerId, producerToken, generation, requestId, ok, frameIndex, error } = {}) {
    const session = sessionFor(sessionId);
    assertProducer(session, producerId, producerToken);
    assertActive(session);
    if (generation !== session.generation) fail("STALE_GENERATION", "Producer generation is stale.", 409);
    const entry = session.commands.get(requestId);
    if (!entry) fail("UNKNOWN_REQUEST", "No matching controller request exists.", 404);
    if (typeof ok !== "boolean") fail("BAD_RESULT", "Command result must include ok.", 400);
    const normalized = ok ? { ok: true, frameIndex: entry.frameIndex } : { ok: false, error: boundedText(error, "error", 240) };
    if (ok && frameIndex !== entry.frameIndex) fail("RESULT_MISMATCH", "Result frame does not match the requested frame.", 409);
    if (entry.result) {
      if (JSON.stringify(entry.result) !== JSON.stringify(normalized)) fail("RESULT_CONFLICT", "A different result was already published.", 409);
      return commandResponse(session, entry, true);
    }
    entry.result = normalized;
    entry.completedAt = now();
    pruneCompletedCommands(session);
    return commandResponse(session, entry, false);
  }

  function assertController(value) {
    if (!sameToken(value, writeToken)) fail("UNAUTHORIZED", "Missing or invalid controller token.", 403);
  }

  function sessionFor(sessionId) {
    if (!SESSION_ID.test(sessionId ?? "") || !sessions.has(sessionId)) fail("UNKNOWN_SESSION", "Model Lab session is unavailable.", 404);
    if (expiredBeyondGrace(sessions.get(sessionId))) {
      sessions.delete(sessionId);
      fail("UNKNOWN_SESSION", "Model Lab session is unavailable.", 404);
    }
    return sessions.get(sessionId);
  }

  function pruneExpiredSessions() {
    for (const [sessionId, session] of sessions) if (expiredBeyondGrace(session)) sessions.delete(sessionId);
  }

  return { begin, reconnect, publish, read, command, nextCommand, result, assertController, sessions };
}

export async function serveModelLabTerminalProtocol({ req, res, url, protocol, readJson, json, assertControllerWrite } = {}) {
  const path = url.pathname;
  const route = terminalRoute(path);
  if (!route) return false;
  if (req.method !== route.method) return json(res, 405, { error: "method not allowed" });
  if (!LOOPBACK.has(req.socket?.remoteAddress ?? "")) return json(res, 403, { error: "loopback connection required" });
  try {
    if (route.name === "sessions") {
      assertControllerWrite(req);
      return json(res, 201, protocol.begin(await readJson(req)));
    }
    if (route.name === "state") {
      assertControllerWrite(req);
      return json(res, 200, protocol.read(url.searchParams.get("sessionId")));
    }
    if (route.name === "publish") {
      return json(res, 200, protocol.publish(await readJson(req)));
    }
    if (route.name === "reconnect") {
      return json(res, 200, protocol.reconnect(await readJson(req)));
    }
    if (route.name === "commands") {
      assertControllerWrite(req);
      return json(res, 202, protocol.command(await readJson(req)));
    }
    if (route.name === "next") {
      return json(res, 200, protocol.nextCommand(await readJson(req)));
    }
    if (route.name === "results") {
      return json(res, 200, protocol.result(await readJson(req)));
    }
  } catch (error) {
    return json(res, error.status ?? 400, { error: error.message, code: error.code ?? "BAD_REQUEST" });
  }
}

function terminalRoute(path) {
  return {
    "/api/model-lab-terminal/sessions": { name: "sessions", method: "POST" },
    "/api/model-lab-terminal/state": { name: "state", method: "GET" },
    "/api/model-lab-terminal/publish": { name: "publish", method: "POST" },
    "/api/model-lab-terminal/reconnect": { name: "reconnect", method: "POST" },
    "/api/model-lab-terminal/commands": { name: "commands", method: "POST" },
    "/api/model-lab-terminal/commands/next": { name: "next", method: "POST" },
    "/api/model-lab-terminal/results": { name: "results", method: "POST" },
  }[path];
}

function publicProducerSession(session) { return { schema: MODEL_LAB_TERMINAL_PROTOCOL, sessionId: session.sessionId, producerId: session.producerId, producerToken: session.producerToken, generation: session.generation, expiresAt: session.expiresAt }; }
function commandResponse(session, entry, replayed) { return { schema: MODEL_LAB_TERMINAL_PROTOCOL, sessionId: session.sessionId, requestId: entry.requestId, command: entry.command, frameIndex: entry.frameIndex, status: entry.result ? "complete" : "pending", result: entry.result ? clone(entry.result) : undefined, replayed }; }
function pendingCommandCount(session) { return [...session.commands.values()].filter((entry) => !entry.result).length; }
function pruneCompletedCommands(session) {
  const completed = [...session.commands.values()].filter((entry) => entry.result).sort((left, right) => left.completedAt - right.completedAt);
  for (const entry of completed.slice(0, Math.max(0, completed.length - MAX_COMPLETED_COMMANDS))) session.commands.delete(entry.requestId);
}
function unavailable(session, reason) { return { schema: MODEL_LAB_TERMINAL_PROTOCOL, status: "unavailable", reason, sessionId: session.sessionId, generation: session.generation, expiresAt: session.expiresAt }; }
function expired(session) { return nowTime(session) >= session.expiresAt; }
function expiredBeyondGrace(session) { return nowTime(session) >= session.expiresAt + session.reconnectGraceMs; }
function nowTime(session) { return sessionNow(session); }
function sessionNow(session) { return session.clock(); }
function assertActive(session) { if (expired(session)) fail("EXPIRED", "Model Lab session has expired; reconnect the producer.", 410); }
function assertProducer(session, producerId, producerToken) {
  if (producerId !== session.producerId || !sameToken(producerToken, session.producerToken)) fail("UNAUTHORIZED_PRODUCER", "Producer identity or token is invalid.", 403);
}
function assertProducerId(value) { if (!PRODUCER_ID.test(value ?? "")) fail("BAD_PRODUCER", "producerId is invalid.", 400); }
function assertTtl(value) { if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) fail("BAD_TTL", "ttlMs must be between 1000 and 300000.", 400); }
function assertState(value) {
  if (!plain(value) || !["loading", "ready", "error"].includes(value.status) || typeof value.ready !== "boolean" || (value.status === "ready") !== value.ready) fail("BAD_STATE", "Producer state must declare a truthful readiness status.", 400);
  assertKeys(value, ["status", "ready", "frame", "metrics", "error"], "state");
  if (value.status === "error") boundedText(value.error, "state.error", 240);
  else if (value.error !== undefined) fail("BAD_STATE", "Only error state may include error text.", 400);
  assertFrame(value.frame);
  assertMetrics(value.metrics);
}
function assertFrame(value) {
  if (!plain(value)) fail("BAD_STATE", "state.frame is required.", 400);
  assertKeys(value, ["index", "id", "count"], "state.frame");
  if (!Number.isSafeInteger(value.index) || value.index < 0 || !Number.isSafeInteger(value.count) || value.count < 1 || value.count > 100_000 || value.index >= value.count) fail("BAD_STATE", "state.frame has invalid bounds.", 400);
  boundedText(value.id, "state.frame.id", 160);
}
function assertMetrics(value) {
  if (!plain(value)) fail("BAD_STATE", "state.metrics is required.", 400);
  const allowed = ["domNodeCount", "visibleLeafCount", "renderedLeafCount", "stableLeafIdentityCount", "childListMutationCount"];
  assertKeys(value, allowed, "state.metrics");
  for (const key of allowed) if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1_000_000) fail("BAD_STATE", `state.metrics.${key} is invalid.`, 400);
}
function assertKeys(value, keys, label) { if (Object.keys(value).some((key) => !keys.includes(key))) fail("BAD_STATE", `${label} contains an unknown field.`, 400); }
function boundedText(value, label, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum) fail("BAD_STATE", `${label} must be non-empty bounded text.`, 400); return value; }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function token() { return randomBytes(16).toString("hex"); }
function sameToken(left, right) { if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false; return timingSafeEqual(Buffer.from(left), Buffer.from(right)); }
function fail(code, message, status) { const error = new Error(message); error.code = code; error.status = status; throw error; }
