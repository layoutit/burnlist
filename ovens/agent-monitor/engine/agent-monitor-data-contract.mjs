import { AGENT_MONITOR_PATCH_LIMITS } from "./agent-monitor-patch.mjs";

export const AGENT_MONITOR_OVEN_ID = "agent-monitor";
export const AGENT_MONITOR_DATA_CONTRACT = "burnlist-agent-monitor-data@1";
export const AGENT_MONITOR_FEED_CONTRACT = "burnlist-agent-monitor-feed@1";
export const AGENT_MONITOR_LIMITS = Object.freeze({
  maxEvents: 300,
  maxFeeds: 128,
  maxManifestBytes: 64 * 1024,
  maxSnapshotBytes: 8 * 1024 * 1024,
  maxSessionBytes: 160,
  maxConversationMessageChars: 12_000,
});

const keyPattern = /^[a-f0-9]{12}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const snapshotPattern = /^snapshot-([a-f0-9]{64})\.json$/u;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value);
  const missing = keys.filter((key) => !actual.includes(key));
  const unknown = actual.filter((key) => !keys.includes(key));
  if (missing.length || unknown.length) {
    throw new Error(`${label} keys are invalid (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"})`);
  }
  return value;
}

function string(value, label, maxLength = 400) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > maxLength
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be trimmed printable text no longer than ${maxLength} characters`);
  }
  return value;
}

function timestamp(value, label) {
  string(value, label, 40);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return value;
}

function optionalString(value, label, maxLength = 400) {
  if (value !== undefined && value !== null) string(value, label, maxLength);
}

function optionalConversationText(value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !value.trim() || value !== value.trim()
      || value.length > AGENT_MONITOR_LIMITS.maxConversationMessageChars
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be bounded printable conversation text`);
  }
}

function assertPatch(value, index) {
  if (value === undefined || value === null) return;
  const label = `Agent Monitor completed[${index}].patch`;
  exact(value, ["lines", "truncated"], label);
  if (!Array.isArray(value.lines) || value.lines.length < 1
      || value.lines.length > AGENT_MONITOR_PATCH_LIMITS.maxLines) {
    throw new Error(`${label}.lines must contain at most ${AGENT_MONITOR_PATCH_LIMITS.maxLines} lines`);
  }
  if (typeof value.truncated !== "boolean") throw new Error(`${label}.truncated must be boolean`);
  let bytes = 0;
  for (const [lineIndex, line] of value.lines.entries()) {
    if (typeof line !== "string" || line.length > AGENT_MONITOR_PATCH_LIMITS.maxLineChars
        || /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(line)) {
      throw new Error(`${label}.lines[${lineIndex}] must be one bounded printable line`);
    }
    bytes += Buffer.byteLength(line, "utf8") + 1;
  }
  if (bytes > AGENT_MONITOR_PATCH_LIMITS.maxBytes) {
    throw new Error(`${label}.lines exceeds ${AGENT_MONITOR_PATCH_LIMITS.maxBytes} bytes`);
  }
}

export function assertAgentMonitorIdentity(value) {
  exact(value, ["logicalRepoKey", "worktreeKey", "session"], "Agent Monitor identity");
  if (!keyPattern.test(value.logicalRepoKey) || !keyPattern.test(value.worktreeKey)) {
    throw new Error("Agent Monitor repository and worktree keys must be lowercase 12-character hexadecimal values");
  }
  string(value.session, "Agent Monitor session", AGENT_MONITOR_LIMITS.maxSessionBytes);
  return value;
}

function assertCompletedItem(value, index) {
  object(value, `Agent Monitor completed[${index}]`);
  string(value.id, `Agent Monitor completed[${index}].id`, 48);
  string(value.key, `Agent Monitor completed[${index}].key`, 240);
  integer(value.line, `Agent Monitor completed[${index}].line`, 1);
  timestamp(value.completedAt, `Agent Monitor completed[${index}].completedAt`);
  string(value.title, `Agent Monitor completed[${index}].title`, 200);
  string(value.detail, `Agent Monitor completed[${index}].detail`, 400);
  string(value.result, `Agent Monitor completed[${index}].result`, 40);
  optionalString(value.actionKey, `Agent Monitor completed[${index}].actionKey`, 64);
  optionalString(value.callKey, `Agent Monitor completed[${index}].callKey`, 64);
  optionalConversationText(value.message, `Agent Monitor completed[${index}].message`);
  assertPatch(value.patch, index);
  optionalString(value.phase, `Agent Monitor completed[${index}].phase`, 40);
  if (value.risk !== undefined && value.risk !== null && value.risk !== "destructive") {
    throw new Error(`Agent Monitor completed[${index}].risk is invalid`);
  }
  if (!digestPattern.test(value.signature ?? "")) throw new Error(`Agent Monitor completed[${index}].signature is invalid`);
}

function assertLoopContext(value) {
  if (value === null || value === undefined) return;
  exact(value, ["runId", "itemRef", "nodeId", "attempt", "role", "mode", "authority", "model", "effort"], "Agent Monitor Loop context");
  string(value.runId, "Agent Monitor Loop runId", 100);
  string(value.itemRef, "Agent Monitor Loop itemRef", 200);
  string(value.nodeId, "Agent Monitor Loop nodeId", 64);
  integer(value.attempt, "Agent Monitor Loop attempt", 1);
  for (const name of ["role", "mode", "authority", "model", "effort"]) {
    optionalString(value[name], `Agent Monitor Loop ${name}`, 128);
  }
}

function assertThreadMetadata(value, label) {
  exact(value, ["provider", "threadSource", "topLevel", "turnOpen", "caughtUp"], label);
  if (!["codex", "claude", "agy", "grok"].includes(value.provider)) {
    throw new Error(`${label}.provider is invalid`);
  }
  if (!["user", "subagent", "other"].includes(value.threadSource)) {
    throw new Error(`${label}.threadSource is invalid`);
  }
  if (typeof value.topLevel !== "boolean" || typeof value.caughtUp !== "boolean") {
    throw new Error(`${label}.topLevel and caughtUp must be boolean`);
  }
  if (value.provider === "codex") {
    if (typeof value.turnOpen !== "boolean") throw new Error(`${label}.turnOpen must be boolean for Codex`);
  } else if (value.turnOpen !== null) {
    throw new Error(`${label}.turnOpen must be null outside Codex`);
  }
  if (value.topLevel && (value.provider !== "codex" || value.threadSource !== "user")) {
    throw new Error(`${label}.topLevel must identify a user-owned Codex task`);
  }
  return value;
}

export function assertAgentMonitorSnapshot(value) {
  exact(value, [
    "schemaVersion", "contract", "identity", "generatedAt", "session",
    "current", "progress", "durations", "raw", "monitor",
  ], "Agent Monitor snapshot");
  if (value.schemaVersion !== 1 || value.contract !== AGENT_MONITOR_DATA_CONTRACT) {
    throw new Error(`Agent Monitor snapshot must use ${AGENT_MONITOR_DATA_CONTRACT}`);
  }
  const identity = assertAgentMonitorIdentity(value.identity);
  timestamp(value.generatedAt, "Agent Monitor generatedAt");
  exact(value.session, ["id", "file"], "Agent Monitor session metadata");
  if (value.session.id !== identity.session) throw new Error("Agent Monitor session metadata does not match its identity");
  string(value.session.file, "Agent Monitor session file", 240);
  object(value.current, "Agent Monitor current");
  object(value.progress, "Agent Monitor progress");
  object(value.durations, "Agent Monitor durations");
  const raw = object(value.raw, "Agent Monitor raw");
  if (!Array.isArray(raw.active) || raw.active.length !== 0) throw new Error("Agent Monitor raw.active must be empty");
  if (!Array.isArray(raw.completed) || raw.completed.length > AGENT_MONITOR_LIMITS.maxEvents) {
    throw new Error(`Agent Monitor completed is limited to ${AGENT_MONITOR_LIMITS.maxEvents} entries`);
  }
  raw.completed.forEach(assertCompletedItem);
  const unique = new Set(raw.completed.map((item) => item.key));
  if (unique.size !== raw.completed.length) {
    const duplicate = raw.completed.find((item, index) =>
      raw.completed.findIndex((candidate) => candidate.key === item.key) !== index);
    throw new Error(`Agent Monitor completed keys must be unique${duplicate ? ` (${duplicate.key})` : ""}`);
  }
  if (raw.total !== raw.completed.length || raw.done !== raw.total || raw.remaining !== 0) {
    throw new Error("Agent Monitor retained totals must equal the completed closure");
  }
  const monitor = object(value.monitor, "Agent Monitor monitor");
  assertLoopContext(monitor.loop);
  if (monitor.thread !== undefined) {
    assertThreadMetadata(monitor.thread, "Agent Monitor thread metadata");
  }
  if (monitor.projectionVersion !== undefined) integer(monitor.projectionVersion, "Agent Monitor projectionVersion", 1);
  const summary = object(monitor.summary, "Agent Monitor summary");
  if (!["Live", "Idle"].includes(summary.state)) throw new Error("Agent Monitor summary.state is invalid");
  optionalString(summary.category, "Agent Monitor summary.category", 40);
  timestamp(summary.updatedAt, "Agent Monitor summary.updatedAt");
  string(summary.drift, "Agent Monitor summary.drift", 200);
  if (summary.driftLevel !== undefined && !["clear", "watch", "alert"].includes(summary.driftLevel)) {
    throw new Error("Agent Monitor summary.driftLevel is invalid");
  }
  optionalString(summary.driftDetail, "Agent Monitor summary.driftDetail", 400);
  optionalString(summary.display, "Agent Monitor summary.display", 200);
  const counts = object(monitor.counts, "Agent Monitor counts");
  integer(counts.lines, "Agent Monitor counts.lines");
  for (const name of ["diffs", "reasoning", "commands", "failures"]) integer(counts[name], `Agent Monitor counts.${name}`);
  if (monitor.retained !== raw.completed.length || monitor.truncated !== (counts.lines > raw.completed.length)) {
    throw new Error("Agent Monitor retention metadata is inconsistent");
  }
  return value;
}

export function assertAgentMonitorCursor(value) {
  exact(value, ["file", "dev", "ino", "offset", "line"], "Agent Monitor cursor");
  string(value.file, "Agent Monitor cursor.file", 240);
  integer(value.dev, "Agent Monitor cursor.dev");
  integer(value.ino, "Agent Monitor cursor.ino");
  integer(value.offset, "Agent Monitor cursor.offset");
  integer(value.line, "Agent Monitor cursor.line");
  return value;
}

function assertManifestSummary(value) {
  const legacyKeys = ["state", "current", "lines", "failures"];
  const currentKeys = [...legacyKeys, "updatedAt"];
  const metadataKeys = [
    ...currentKeys, "provider", "threadSource", "topLevel", "turnOpen", "caughtUp",
  ];
  exact(
    value,
    value.provider === undefined
      ? (value.updatedAt === undefined ? legacyKeys : currentKeys)
      : metadataKeys,
    "Agent Monitor manifest summary",
  );
  if (!["Live", "Idle"].includes(value.state)) throw new Error("Agent Monitor manifest summary.state is invalid");
  string(value.current, "Agent Monitor manifest summary.current", 200);
  integer(value.lines, "Agent Monitor manifest summary.lines");
  integer(value.failures, "Agent Monitor manifest summary.failures");
  if (value.updatedAt !== undefined) timestamp(value.updatedAt, "Agent Monitor manifest summary.updatedAt");
  if (value.provider !== undefined) {
    assertThreadMetadata({
      provider: value.provider,
      threadSource: value.threadSource,
      topLevel: value.topLevel,
      turnOpen: value.turnOpen,
      caughtUp: value.caughtUp,
    }, "Agent Monitor manifest thread metadata");
  }
  return value;
}

export function assertAgentMonitorManifest(value) {
  const legacyKeys = ["contract", "identity", "updatedAt", "snapshot", "bytes", "digest"];
  const currentKeys = [...legacyKeys, "cursor", "summary"];
  exact(value, value.cursor === undefined && value.summary === undefined ? legacyKeys : currentKeys, "Agent Monitor manifest");
  if (value.contract !== AGENT_MONITOR_FEED_CONTRACT) {
    throw new Error(`Agent Monitor manifest must use ${AGENT_MONITOR_FEED_CONTRACT}`);
  }
  assertAgentMonitorIdentity(value.identity);
  timestamp(value.updatedAt, "Agent Monitor manifest updatedAt");
  const match = snapshotPattern.exec(value.snapshot ?? "");
  if (!match || match[1] !== value.digest || !digestPattern.test(value.digest)) {
    throw new Error("Agent Monitor manifest snapshot and digest do not match");
  }
  integer(value.bytes, "Agent Monitor manifest bytes", 1);
  if (value.bytes > AGENT_MONITOR_LIMITS.maxSnapshotBytes) throw new Error("Agent Monitor snapshot exceeds its byte limit");
  if (value.cursor !== undefined) assertAgentMonitorCursor(value.cursor);
  if (value.summary !== undefined) assertManifestSummary(value.summary);
  return value;
}
