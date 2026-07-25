import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { publishOvenEvent, readOvenEvents } from "../../events/oven-event-store.mjs";
import { resolveLoopHookContext } from "./hook-context.mjs";

export const LOOP_OBSERVATION_KIND = "loop-agent-observation";
const PROVIDERS = new Set(["codex", "claude"]);
const EVENT_KINDS = {
  SessionStart: "agent-started",
  SessionEnd: "agent-finished",
  Stop: "agent-finished",
  SubagentStart: "subagent-started",
  SubagentStop: "subagent-finished",
  PreToolUse: "tool-started",
  PostToolUse: "tool-finished",
  PostToolUseFailure: "tool-failed",
};
const safe = (value, maximum = 128) => typeof value === "string" && value.length > 0
  && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function eventName(payload) {
  const value = payload?.hook_event_name ?? payload?.hookEventName ?? payload?.event;
  return safe(value, 64) ? value : null;
}
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function logicalPath(root, value) {
  if (!safe(value, 1024)) return null;
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const fromRoot = relative(root, absolute);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) return null;
  const normalized = fromRoot.split(sep).join("/");
  return normalized.length <= 256 && !normalized.split("/").some((part) => !part || part === "." || part === "..")
    ? normalized : null;
}
function patchPaths(value) {
  if (typeof value !== "string" || value.length > 262_144) return [];
  return [...value.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gmu),
    ...value.matchAll(/^\*\*\* Move to:\s*(.+?)\s*$/gmu)].map((match) => match[1]);
}
function observedPaths(repoRoot, payload) {
  const input = object(payload.tool_input ?? payload.toolInput ?? payload.input);
  const raw = ["file_path", "notebook_path", "path", "target_path", "source_path",
    "destination_path"].flatMap((key) => safe(input[key], 1024) ? [input[key]] : []);
  raw.push(...patchPaths(input.command));
  return [...new Set(raw.map((value) => logicalPath(repoRoot, value)).filter(Boolean))].slice(0, 16);
}
function usage(payload) {
  const response = object(payload.tool_response ?? payload.toolResponse);
  const value = object(response.usage);
  return {
    inputTokens: count(value.input_tokens),
    outputTokens: count(value.output_tokens),
  };
}
function model(payload, context) {
  const response = object(payload.tool_response ?? payload.toolResponse);
  return safe(payload.model, 128) ? payload.model
    : safe(response.resolvedModel, 128) ? response.resolvedModel : context.model;
}
function effort(payload, context) {
  const value = payload?.effort?.level ?? payload?.effort;
  return safe(value, 32) ? value : context.effort;
}
function cursor(provider, payload, context, kind) {
  const identity = [
    provider, context.sessionKey, context.agentKey ?? "", eventName(payload) ?? "", kind,
    payload.tool_use_id ?? payload.toolUseId ?? "", payload.turn_id ?? payload.prompt_id ?? "",
    payload.source ?? payload.reason ?? "",
  ].join("\0");
  return `loop-observation-sha256-${hash(identity)}`;
}

/** Strict raw-payload adapter: retain facts only, never semantic outcomes. */
export function normalizeNativeLoopObservation({ repoRoot, provider, payload, now = Date.now() }) {
  if (!PROVIDERS.has(provider) || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const name = eventName(payload), kind = EVENT_KINDS[name];
  if (!kind) return null;
  const context = resolveLoopHookContext(repoRoot, { provider, payload, now });
  if (!context) return null;
  const tool = kind.startsWith("tool-") && safe(payload.tool_name ?? payload.toolName, 128)
    ? payload.tool_name ?? payload.toolName : null;
  if (kind.startsWith("tool-") && !tool) return null;
  const tokens = usage(payload);
  const occurredAt = new Date(now).toISOString();
  return {
    ovenId: "checklist",
    subjectId: context.itemRef,
    kind: LOOP_OBSERVATION_KIND,
    phase: kind,
    cursor: cursor(provider, payload, context, kind),
    occurredAt,
    payload: {
      schema: "burnlist-loop-observation@1",
      runId: context.runId, nodeId: context.nodeId, attempt: context.attempt,
      correlation: `ac1-sha256:${hash(`${context.runId}\0${context.nodeId}\0${context.attempt}\0${context.invocationId}`)}`,
      provider, kind, sessionKey: context.sessionKey, agentKey: context.agentKey,
      agentType: safe(payload.agent_type ?? payload.agentType, 128)
        ? payload.agent_type ?? payload.agentType : null,
      tool, observedPaths: observedPaths(resolve(repoRoot), payload),
      model: model(payload, context), effort: effort(payload, context),
      inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens,
      durationMilliseconds: count(payload.duration_ms),
    },
  };
}

export function publishNativeLoopObservation(input, {
  publish = publishOvenEvent,
} = {}) {
  const normalized = normalizeNativeLoopObservation(input);
  if (!normalized) return null;
  const result = publish(input.repoRoot, normalized);
  return result?.event ?? result;
}

export function readLoopObservationRecords(repoRoot, runId) {
  try {
    return readOvenEvents(repoRoot, { ovenIds: ["checklist"], limit: 1_000 })
      .filter((event) => event.kind === LOOP_OBSERVATION_KIND
        && event.payload?.runId === runId)
      .map((event) => ({
        at: Date.parse(event.occurredAt), origin: "host-hook",
        ...event.payload,
      }));
  } catch { return []; }
}
