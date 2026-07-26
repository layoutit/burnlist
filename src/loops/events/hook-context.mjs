import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { containedJoin, withRepoStateLock } from "../../server/repo-state.mjs";
import { writeAtomicText } from "../../cli/local-exclude.mjs";
import { runStore } from "../run/run-store.mjs";
import { isRunRef } from "../run/run-ref.mjs";

const SCHEMA = "burnlist-loop-hook-context@1";
const BINDING_SCHEMA = "burnlist-loop-hook-bindings@1";
const MAX_CONTEXTS = 32;
const MAX_BINDINGS = 128;
const MAX_BYTES = 64 * 1024;
const safe = (value, maximum = 256) => typeof value === "string" && value.length > 0
  && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
const digest = (kind, value) => `${kind}1-sha256:${createHash("sha256")
  .update(`burnlist-${kind}-v1\0${value}`).digest("hex")}`;

function contextPath(repoRoot) { return containedJoin(repoRoot, "loop-hook-context.json"); }
function bindingPath(repoRoot) { return containedJoin(repoRoot, "loop-hook-bindings.json"); }
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
function validateBinding(value) {
  const keys = ["runId", "session", "agent", "tool", "createdAt", "expiresAt"];
  if (!exact(value, keys) || !isRunRef(value.runId)
    || !/^session1-sha256:[a-f0-9]{64}$/u.test(value.session)
    || value.agent !== null && !/^agent1-sha256:[a-f0-9]{64}$/u.test(value.agent)
    || !/^tool1-sha256:[a-f0-9]{64}$/u.test(value.tool)
    || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= value.createdAt) throw new Error("Loop hook binding is invalid.");
  return value;
}
function readBindings(repoRoot) {
  const path = bindingPath(repoRoot);
  if (!existsSync(path)) return { schema: BINDING_SCHEMA, bindings: [] };
  const bytes = readFileSync(path);
  if (bytes.length < 2 || bytes.length > MAX_BYTES) throw new Error("Loop hook bindings exceed bounds.");
  let value;
  try { value = JSON.parse(bytes); } catch { throw new Error("Loop hook bindings are malformed."); }
  if (!exact(value, ["schema", "bindings"]) || value.schema !== BINDING_SCHEMA
    || !Array.isArray(value.bindings) || value.bindings.length > MAX_BINDINGS)
    throw new Error("Loop hook bindings are invalid.");
  value.bindings.forEach(validateBinding);
  if (!Buffer.from(`${JSON.stringify(value)}\n`).equals(bytes))
    throw new Error("Loop hook bindings are not canonical.");
  return value;
}
function writeBindings(repoRoot, bindings) {
  const value = { schema: BINDING_SCHEMA, bindings };
  const text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Loop hook bindings exceed bounds.");
  writeAtomicText(bindingPath(repoRoot), text);
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

/** Publish one pending observational context after the canonical claim is durable. */
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

function shellWords(command) {
  if (!safe(command, 4096)) return null;
  const words = []; let word = "", active = false, quote = null;
  for (const character of command) {
    if (quote) {
      if (character === quote) { quote = null; active = true; continue; }
      if (/[\u0000-\u001f\u007f]/u.test(character)
        || quote === "\"" && /[$`\\]/u.test(character)) return null;
      word += character; active = true; continue;
    }
    if (character === "'" || character === "\"") { quote = character; active = true; continue; }
    if (/\s/u.test(character)) {
      if (active) { words.push(word); word = ""; active = false; }
      continue;
    }
    if (!/[A-Za-z0-9_./:@#=-]/u.test(character)) return null;
    word += character; active = true;
  }
  if (quote) return null;
  if (active) words.push(word);
  return words;
}
function claimCommand(repoRoot, payload) {
  if (payload?.hook_event_name !== "PreToolUse" && payload?.hook_event_name !== "PostToolUse"
    || payload?.tool_name !== "Bash" || !safe(payload?.tool_use_id)
    || !payload.tool_input || typeof payload.tool_input !== "object") return null;
  const words = shellWords(payload.tool_input.command);
  if (!words || ![4, 6].includes(words.length) || words[0] !== "burnlist"
    || words[1] !== "loop" || !["next", "claim"].includes(words[2]) || !isRunRef(words[3])
    || words.length === 6 && words[4] !== "--repo") return null;
  if (words.length === 6 && resolve(payload.cwd, words[5]) !== resolve(repoRoot)) return null;
  return { runId: words[3], toolUseId: payload.tool_use_id };
}
function bindingIdentity(provider, payload, command) {
  const identity = observedIdentity(payload, provider);
  if (!identity.session) return null;
  return { ...identity, tool: digest("tool",
    `${provider}\0${payload.session_id}\0${command.toolUseId}`) };
}

/** Prepare an exact native session/tool/Run tuple before the Burnlist claim command executes. */
export function prepareLoopHookBinding(repoRoot, { provider, payload, now = Date.now() }) {
  if (!["codex", "claude"].includes(provider)) return null;
  const command = claimCommand(repoRoot, payload);
  const identity = command && bindingIdentity(provider, payload, command);
  if (!identity) return null;
  return withRepoStateLock(repoRoot, () => {
    const stored = readBindings(repoRoot).bindings
      .filter((entry) => entry.expiresAt > now && entry.tool !== identity.tool);
    stored.push(validateBinding({
      runId: command.runId, session: identity.session, agent: identity.agent,
      tool: identity.tool, createdAt: now, expiresAt: now + 60_000,
    }));
    writeBindings(repoRoot, stored.slice(-MAX_BINDINGS));
    return command.runId;
  });
}

/** Bind the matching native identity only after that exact tool call made its claim durable. */
export function bindPreparedLoopHookContext(repoRoot, { provider, payload, now = Date.now() }) {
  if (!["codex", "claude"].includes(provider)) return null;
  const command = claimCommand(repoRoot, payload);
  const identity = command && bindingIdentity(provider, payload, command);
  if (!identity || payload.hook_event_name !== "PostToolUse") return null;
  return withRepoStateLock(repoRoot, () => {
    const stored = readBindings(repoRoot);
    const liveBindings = stored.bindings.filter((entry) => entry.expiresAt > now);
    const matches = liveBindings.filter((entry) => entry.tool === identity.tool
      && entry.session === identity.session && entry.runId === command.runId);
    writeBindings(repoRoot, liveBindings.filter((entry) => !matches.includes(entry)));
    if (matches.length !== 1) return null;
    const contexts = readContext(repoRoot).contexts.filter((entry) => live(repoRoot, entry, now));
    const selected = contexts.filter((entry) => entry.runId === command.runId
      && entry.createdAt >= matches[0].createdAt);
    if (selected.length !== 1) {
      writeContext(repoRoot, { schema: SCHEMA, contexts });
      return null;
    }
    if (!selected[0].sessions.includes(identity.session)) selected[0].sessions.push(identity.session);
    if (identity.agent && !selected[0].agents.includes(identity.agent))
      selected[0].agents.push(identity.agent);
    writeContext(repoRoot, { schema: SCHEMA, contexts });
    return command.runId;
  });
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
