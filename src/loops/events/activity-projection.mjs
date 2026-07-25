import { createHash } from "node:crypto";

const MAX_ACTIVITY = 10;
const OPTIONAL_KINDS = new Set(["subagent-started", "subagent-finished", "subagent-failed", "tool-started", "tool-finished"]);
const OPTIONAL_KEYS = new Set(["at", "origin", "kind", "provider", "runId", "nodeId", "attempt", "invocationId", "parentAgentId", "subagentId", "tool", "observedPath", "truncated"]);
const safe = (value, maximum = 128) => typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9._:/-]+$/u.test(value);
const logicalPath = (value) => typeof value === "string" && value.length > 0 && value.length <= 256
  && !value.startsWith("/") && !/^[A-Za-z]:/u.test(value) && !value.includes("\\")
  && !value.split("/").some((part) => part === "." || part === ".." || !part)
  && !/[\u0000-\u001f\u007f]/u.test(value);

function correlation(runId, nodeId, attempt, invocationId) {
  // Bind activity to one exact invocation while keeping its identifier out of
  // the observer projection.
  const input = `${runId}\0${nodeId}\0${attempt}\0${invocationId}`;
  return `ac1-sha256:${createHash("sha256").update(input).digest("hex")}`;
}

/**
 * Normalizes a record after a provider hook has already removed provider raw
 * content. This module deliberately has no hook I/O or persistence: callers
 * may only supply the narrow structural record below.
 */
export function normalizeOptionalActivityRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !OPTIONAL_KEYS.has(key))
    || !["host-hook", "agent-reported"].includes(value.origin)
    || !OPTIONAL_KINDS.has(value.kind)
    || !["claude", "codex"].includes(value.provider)
    || !safe(value.runId) || !safe(value.nodeId) || !Number.isSafeInteger(value.at) || value.at < 0
    || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || !safe(value.invocationId)
    || value.parentAgentId !== undefined && !safe(value.parentAgentId)
    || value.subagentId !== undefined && !safe(value.subagentId)
    || value.tool !== undefined && !safe(value.tool)
    || value.observedPath !== undefined && !logicalPath(value.observedPath)
    || value.truncated !== undefined && typeof value.truncated !== "boolean") return null;
  if (value.kind.startsWith("subagent-") && !safe(value.subagentId)) return null;
  if (value.kind.startsWith("tool-") && !safe(value.tool)) return null;
  return Object.freeze({
    at: value.at, origin: value.origin, kind: value.kind, provider: value.provider,
    nodeId: value.nodeId, attempt: value.attempt,
    correlation: correlation(value.runId, value.nodeId, value.attempt, value.invocationId),
    ...(value.parentAgentId ? { parentAgentId: value.parentAgentId } : {}),
    ...(value.subagentId ? { subagentId: value.subagentId } : {}),
    ...(value.tool ? { tool: value.tool } : {}),
    ...(value.observedPath ? { observedPath: value.observedPath } : {}),
    ...(value.truncated !== undefined ? { truncated: value.truncated } : {}),
  });
}

function recordFor({ runId, graph, record, invocations }) {
  const { type, payload, at } = record.value;
  const node = (id) => graph.nodes.find((entry) => entry.id === id);
  const base = (nodeId, attempt, invocationId) => ({
    at,
    origin: "runner",
    nodeId,
    attempt,
    correlation: correlation(runId, nodeId, attempt, invocationId),
  });
  if (type === "external-claim-bound") {
    const current = node(payload.claim.nodeId);
    const mode = current?.execution === "managed" ? "managed" : current?.execution === "host" ? "host-reported" : "unavailable";
    invocations.set(payload.invocationId, { nodeId: payload.claim.nodeId, attempt: payload.claim.attempt, mode });
    return { ...base(payload.claim.nodeId, payload.claim.attempt, payload.invocationId), kind: "claimed", mode };
  }
  if (type === "invocation-started") {
    const current = node(payload.nodeId);
    invocations.set(payload.invocationId, { nodeId: payload.nodeId, attempt: payload.attempt, mode: "managed" });
    return { ...base(payload.nodeId, payload.attempt, payload.invocationId), kind: current?.kind === "check" ? "check-started" : "started", mode: "managed", ...(current?.kind === "check" ? { capability: current.capability } : {}) };
  }
  if (type === "external-claim-resolved") return { at, origin: "runner", kind: "paused", reason: "paused" };
  if (type === "external-report-accepted" || type === "invocation-result") {
    const invocation = invocations.get(payload.invocationId);
    if (!invocation) return null;
    const current = node(invocation.nodeId);
    return {
      ...base(invocation.nodeId, invocation.attempt, payload.invocationId),
      kind: current?.kind === "check" ? "check-finished" : type === "external-report-accepted" ? "host-result" : "result",
      mode: invocation.mode,
      outcome: payload.kind,
      ...(current?.kind === "check" ? { capability: current.capability } : {}),
    };
  }
  if (type === "edge-taken") return { at, origin: "runner", kind: "transition", from: payload.from, outcome: payload.on, to: payload.to };
  if (type === "state-changed") return { at, origin: "runner", kind: "lifecycle", state: payload.to };
  if (type === "terminal-node-committed") return { at, origin: "runner", kind: "terminal", state: payload.to };
  return null;
}

/**
 * A deliberately small observer-only activity feed.  It derives solely from
 * the immutable Run journal: no agent text, command arguments, output, or
 * host hook data is accepted here.  A future hook reader can append separately
 * normalized host-hook/agent-reported records without changing Run authority.
 */
export function projectRunActivity({ runId, graph, journal, optionalRecords = [] }) {
  const invocations = new Map();
  const runner = journal.map((record) => recordFor({ runId, graph, record, invocations })).filter(Boolean);
  const optional = Array.isArray(optionalRecords) ? optionalRecords
    .filter((entry) => entry?.runId === runId
      && invocations.get(entry.invocationId)?.nodeId === entry.nodeId
      && invocations.get(entry.invocationId)?.attempt === entry.attempt)
    .map(normalizeOptionalActivityRecord)
    .filter((entry) => entry?.correlation?.startsWith("ac1-sha256:")) : [];
  const records = [...runner, ...optional].sort((left, right) => left.at - right.at).slice(-MAX_ACTIVITY);
  return Object.freeze({ hooks: optional.length ? "available" : "unavailable", records: Object.freeze(records.map((entry) => Object.freeze(entry))) });
}
