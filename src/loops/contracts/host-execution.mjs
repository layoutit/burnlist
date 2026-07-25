import { bindingsMatch, exact, fail, identity, parseBoundedObject } from "./contract.mjs";
import { rawSha256 } from "../dsl/hash.mjs";
import { validateAgentResult, validateDispatchAuthority, validateInvocationInput } from "./agent-result.mjs";

const KEYS = ["schema", "runId", "nodeId", "attempt", "claimId", "assignmentId", "invocationId", "recipeRevision", "policyRevision", "inputCandidate", "issuedAt", "expiresAt", "invocationInput", "dispatchAuthority"];
const REPORT_KEYS = ["schema", "result", "telemetry"];
const TELEMETRY_KEYS = ["schema", "provenance", "executor", "displayName", "provider", "model", "effort", "startedAt", "completedAt", "inputTokens", "outputTokens"];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_ENVELOPE_BYTES = 400_000;
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

function base64(value, label, maximum) {
  if (typeof value !== "string" || !BASE64.test(value)) fail(`invalid ${label}`);
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== value) fail(`invalid ${label}`);
  return bytes;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) fail(`invalid ${label}`);
  return value;
}

function canonical(value) {
  return Buffer.from(`${JSON.stringify({
    schema: value.schema, runId: value.runId, nodeId: value.nodeId, attempt: value.attempt, claimId: value.claimId,
    assignmentId: value.assignmentId, invocationId: value.invocationId, recipeRevision: value.recipeRevision,
    policyRevision: value.policyRevision, inputCandidate: value.inputCandidate, issuedAt: value.issuedAt,
    expiresAt: value.expiresAt, invocationInput: value.invocationInput, dispatchAuthority: value.dispatchAuthority,
  })}\n`, "utf8");
}

/**
 * Canonical, controller-issued transport for one already-prepared agent claim.
 * It deliberately contains neither an edge/destination nor a reported outcome:
 * hosts execute the exact input, while Burnlist remains the transition authority.
 */
export function createHostExecutionEnvelope(value) {
  if (!exact(value, KEYS) || value.schema !== "burnlist-loop-host-execution@1") fail("invalid host execution envelope");
  identity(value, "host execution envelope");
  const issuedAt = timestamp(value.issuedAt, "issuedAt");
  const expiresAt = timestamp(value.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_MS) fail("invalid host execution expiry");
  const inputBytes = base64(value.invocationInput, "invocation input", 262_144);
  const authorityBytes = base64(value.dispatchAuthority, "dispatch authority", 16_384);
  const authority = validateDispatchAuthority(authorityBytes);
  const input = validateInvocationInput(inputBytes, authorityBytes);
  if (!bindingsMatch(value, input.value) || !bindingsMatch(value, authority.value)) fail("host execution envelope binding mismatch");
  const bytes = canonical(value);
  if (bytes.length > MAX_ENVELOPE_BYTES) fail("host execution envelope exceeds bounds");
  return Object.freeze({ value: Object.freeze({ ...value }), bytes, digest: rawSha256(bytes), input, authority });
}

/** Strictly parses a bounded canonical envelope before a host may use its inputs. */
export function validateHostExecutionEnvelope(bytes) {
  const raw = Buffer.from(bytes);
  const value = parseBoundedObject(raw, { maximumBytes: MAX_ENVELOPE_BYTES, maximumDepth: 1, label: "host execution envelope" });
  const built = createHostExecutionEnvelope(value);
  if (!built.bytes.equals(raw)) fail("host execution envelope is not canonical");
  return built;
}

export const HOST_EXECUTION_ENVELOPE_SCHEMA = "burnlist-loop-host-execution@1";

export function hostExecutionExpired(envelope, now) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) fail("invalid host execution clock");
  const value = envelope?.value ?? envelope;
  return now >= createHostExecutionEnvelope(value).value.expiresAt;
}

function optionalText(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 256 || /[\0\r\n]/u.test(value)) fail(`invalid ${label}`);
  return value;
}

function optionalCount(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail(`invalid ${label}`);
  return value;
}

export function validateHostTelemetry(value) {
  if (value === null) return null;
  if (!exact(value, TELEMETRY_KEYS) || value.schema !== "burnlist-loop-host-telemetry@1"
    || value.provenance !== "host-reported") fail("invalid host telemetry");
  const telemetry = {
    schema: value.schema, provenance: value.provenance, executor: optionalText(value.executor, "executor"),
    displayName: optionalText(value.displayName, "displayName"), provider: optionalText(value.provider, "provider"),
    model: optionalText(value.model, "model"), effort: optionalText(value.effort, "effort"),
    startedAt: optionalCount(value.startedAt, "startedAt"), completedAt: optionalCount(value.completedAt, "completedAt"),
    inputTokens: optionalCount(value.inputTokens, "inputTokens"), outputTokens: optionalCount(value.outputTokens, "outputTokens"),
  };
  if (telemetry.executor === null || (telemetry.startedAt === null) !== (telemetry.completedAt === null)
    || telemetry.startedAt !== null && telemetry.completedAt < telemetry.startedAt) fail("invalid host telemetry timing");
  return Object.freeze(telemetry);
}

function reportBytes(value) {
  return Buffer.from(`${JSON.stringify({ schema: value.schema, result: value.result, telemetry: value.telemetry })}\n`, "utf8");
}

/** A host reports evidence and an allowed outcome; it never reports an edge destination. */
export function createHostExecutionReport(value, { envelope, mode, openFindings = new Map() } = {}) {
  if (!exact(value, REPORT_KEYS) || value.schema !== "burnlist-loop-host-report@1" || !envelope?.value) fail("invalid host execution report");
  const result = validateAgentResult(value.result, { mode, openFindings });
  if (!bindingsMatch(result, envelope.value)) fail("host execution report binding mismatch");
  const telemetry = validateHostTelemetry(value.telemetry);
  const report = Object.freeze({ schema: value.schema, result, telemetry });
  const bytes = reportBytes(report);
  if (bytes.length > 262_144) fail("host execution report exceeds bounds");
  return Object.freeze({ value: report, bytes, digest: rawSha256(bytes) });
}

export function validateHostExecutionReport(bytes, options) {
  const raw = Buffer.from(bytes);
  const value = parseBoundedObject(raw, { maximumBytes: 262_144, maximumDepth: 5, label: "host execution report" });
  const built = createHostExecutionReport(value, options);
  if (!built.bytes.equals(raw)) fail("host execution report is not canonical");
  return built;
}

export const HOST_EXECUTION_REPORT_SCHEMA = "burnlist-loop-host-report@1";
