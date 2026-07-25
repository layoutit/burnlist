import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { containedJoin, withRepoStateLock } from "../../server/repo-state.mjs";
import { writeAtomicText } from "../../cli/local-exclude.mjs";
import { runStore } from "../run/run-store.mjs";

const SCHEMA = "burnlist-loop-hook-context@1";
const MAX_CONTEXTS = 32;
const MAX_BYTES = 64 * 1024;
const safe = (value, maximum = 256) => typeof value === "string" && value.length > 0
  && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
const digest = (kind, value) => `${kind}1-sha256:${createHash("sha256")
  .update(`burnlist-${kind}-v1\0${value}`).digest("hex")}`;

function contextPath(repoRoot) { return containedJoin(repoRoot, "loop-hook-context.json"); }
function empty() { return { schema: SCHEMA, contexts: [] }; }
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key, index) => Object.keys(value)[index] === key);
}
function validateContext(value) {
  const keys = ["runId", "itemRef", "nodeId", "attempt", "claimId", "invocationId",
    "createdAt", "expiresAt", "sessions", "agents", "model", "effort"];
  if (!exact(value, keys) || !safe(value.runId) || !safe(value.itemRef)
    || !safe(value.nodeId, 64) || !Number.isSafeInteger(value.attempt) || value.attempt < 1
    || !safe(value.claimId) || !safe(value.invocationId)
    || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= value.createdAt || !Array.isArray(value.sessions)
    || !Array.isArray(value.agents) || value.sessions.length > 32 || value.agents.length > 64
    || value.sessions.some((entry) => !/^session1-sha256:[a-f0-9]{64}$/u.test(entry))
    || value.agents.some((entry) => !/^agent1-sha256:[a-f0-9]{64}$/u.test(entry))
    || value.model !== null && !safe(value.model, 128)
    || value.effort !== null && !safe(value.effort, 32)) throw new Error("Loop hook context is invalid.");
  return value;
}
function readContext(repoRoot) {
  const path = contextPath(repoRoot);
  if (!existsSync(path)) return empty();
  const bytes = readFileSync(path);
  if (bytes.length < 2 || bytes.length > MAX_BYTES) throw new Error("Loop hook context exceeds bounds.");
  let value;
  try { value = JSON.parse(bytes); } catch { throw new Error("Loop hook context is malformed."); }
  if (!exact(value, ["schema", "contexts"]) || value.schema !== SCHEMA
    || !Array.isArray(value.contexts) || value.contexts.length > MAX_CONTEXTS)
    throw new Error("Loop hook context is invalid.");
  value.contexts.forEach(validateContext);
  if (!Buffer.from(`${JSON.stringify(value)}\n`).equals(bytes))
    throw new Error("Loop hook context is not canonical.");
  return value;
}
function writeContext(repoRoot, value) {
  const text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Loop hook context exceeds bounds.");
  writeAtomicText(contextPath(repoRoot), text);
}
function live(repoRoot, context, now) {
  if (context.expiresAt <= now) return false;
  try {
    const store = runStore(repoRoot), replay = store.read(context.runId);
    const active = store.readExternalClaim(context.runId, replay);
    return Boolean(active && active.claim.claimId === context.claimId
      && active.claim.nodeId === context.nodeId && active.claim.attempt === context.attempt);
  } catch { return false; }
}

/** Publish one pending correlation tuple after the canonical claim is durable. */
export function activateLoopHookContext(repoRoot, { replay, claim, envelope }, {
  now = Date.now(),
} = {}) {
  if (!replay?.projection?.itemRef || !claim || !envelope?.invocationId)
    throw new Error("Loop hook context activation requires a claimed Run.");
  return withRepoStateLock(repoRoot, () => {
    const current = readContext(repoRoot);
    const contexts = current.contexts.filter((entry) => entry.runId !== claim.runId
      && live(repoRoot, entry, now));
    contexts.push(validateContext({
      runId: claim.runId, itemRef: replay.projection.itemRef, nodeId: claim.nodeId,
      attempt: claim.attempt, claimId: claim.claimId, invocationId: envelope.invocationId,
      createdAt: now, expiresAt: claim.expiresAt, sessions: [], agents: [],
      model: null, effort: null,
    }));
    const value = { schema: SCHEMA, contexts: contexts.slice(-MAX_CONTEXTS) };
    writeContext(repoRoot, value);
    return contexts.at(-1);
  });
}

function observedIdentity(payload, provider) {
  const session = safe(payload?.session_id) ? digest("session", `${provider}\0${payload.session_id}`) : null;
  const rawAgent = payload?.agent_id ?? payload?.agentId;
  const agent = safe(rawAgent) ? digest("agent", `${provider}\0${rawAgent}`) : null;
  return { session, agent };
}

/** Resolve and bind native identities without exposing their raw values. */
export function resolveLoopHookContext(repoRoot, { provider, payload, now = Date.now() }) {
  const identity = observedIdentity(payload, provider);
  if (!identity.session) return null;
  return withRepoStateLock(repoRoot, () => {
    const stored = readContext(repoRoot);
    const contexts = stored.contexts.filter((entry) => live(repoRoot, entry, now));
    let match = contexts.filter((entry) => entry.sessions.includes(identity.session)
      || identity.agent && entry.agents.includes(identity.agent));
    if (!match.length && contexts.length === 1) match = contexts;
    if (match.length !== 1) {
      if (contexts.length !== stored.contexts.length)
        writeContext(repoRoot, { schema: SCHEMA, contexts });
      return null;
    }
    const selected = match[0];
    if (!selected.sessions.includes(identity.session)) selected.sessions.push(identity.session);
    if (identity.agent && !selected.agents.includes(identity.agent)) selected.agents.push(identity.agent);
    const model = safe(payload.model, 128) ? payload.model : selected.model;
    const effortValue = payload?.effort?.level ?? payload?.effort;
    const effort = safe(effortValue, 32) ? effortValue : selected.effort;
    selected.model = model; selected.effort = effort;
    writeContext(repoRoot, { schema: SCHEMA, contexts });
    return Object.freeze({ ...selected, sessionKey: identity.session, agentKey: identity.agent });
  });
}

export const loopHookIdentity = digest;
