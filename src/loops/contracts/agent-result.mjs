import { rawSha256 } from "../dsl/hash.mjs";
import { bindingsMatch, DIGESTS, exact, fail, identity, parseBoundedObject, parseResultBytes, SLUG, sortedUnique } from "./contract.mjs";
import { nextOpenFindings, validateFindingSet } from "./finding.mjs";

const RESULT_KEYS = ["schema", "runId", "nodeId", "attempt", "claimId", "assignmentId", "invocationId", "recipeRevision", "policyRevision", "inputCandidate", "outcome", "findings", "resolvedFindingIds"];
const INPUT_KEYS = ["schema", "runId", "nodeId", "attempt", "claimId", "assignmentId", "invocationId", "recipeRevision", "policyRevision", "inputCandidate", "itemRevision", "instructionDigest", "instructionBytes", "candidateContext", "reviewerEvidence"];
const AUTHORITY_KEYS = ["schema", "state", "runId", "nodeId", "attempt", "claimId", "assignmentId", "invocationId", "recipeRevision", "policyRevision", "inputCandidate", "itemRevision", "inputSchema", "inputDigest", "inputByteLength"];
const OUTCOMES = Object.freeze({ task: new Set(["complete"]), review: new Set(["approve", "reject", "escalate"]) });
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function base64(value, label, maximum) {
  if (typeof value !== "string" || !BASE64.test(value)) fail(`invalid ${label}`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.length > maximum) fail(`invalid ${label}`);
  return bytes;
}
function canonicalEnvelope(value) {
  return Buffer.from(`${JSON.stringify({
    schema: value.schema, runId: value.runId, nodeId: value.nodeId, attempt: value.attempt, claimId: value.claimId,
    assignmentId: value.assignmentId, invocationId: value.invocationId, recipeRevision: value.recipeRevision,
    policyRevision: value.policyRevision, inputCandidate: value.inputCandidate, itemRevision: value.itemRevision,
    instructionDigest: value.instructionDigest, instructionBytes: value.instructionBytes, candidateContext: value.candidateContext,
    reviewerEvidence: value.reviewerEvidence,
  })}\n`, "utf8");
}

/** Builds the exact adapter stdin/prompt payload; this digest is persisted before dispatch by the runner. */
export function createInvocationInput(value) {
  if (!exact(value, INPUT_KEYS) || value.schema !== "burnlist-loop-invocation-input@1") fail("invalid invocation input");
  identity(value, "invocation input");
  if (!DIGESTS.item.test(value.itemRevision) || !DIGESTS.raw.test(value.instructionDigest)
    || !SLUG.test(value.nodeId) || !Array.isArray(value.reviewerEvidence) || value.reviewerEvidence.length > 50
    || !sortedUnique(value.reviewerEvidence) || !value.reviewerEvidence.every((ref) => DIGESTS.artifact.test(ref))) fail("invalid invocation evidence");
  const instruction = base64(value.instructionBytes, "instruction bytes", 65_536);
  const context = base64(value.candidateContext, "candidate context", 65_536);
  if (!instruction.length || !context.length) fail("empty invocation input");
  if (rawSha256(instruction) !== value.instructionDigest) fail("instruction digest does not match frozen bytes");
  const bytes = canonicalEnvelope(value);
  if (bytes.length > 262_144) fail("invocation input exceeds bounds");
  return Object.freeze({ value: Object.freeze({ ...value, reviewerEvidence: Object.freeze([...value.reviewerEvidence]) }), bytes, digest: rawSha256(bytes) });
}

function canonicalAuthority(value) {
  return Buffer.from(`${JSON.stringify({
    schema: value.schema, state: value.state, runId: value.runId, nodeId: value.nodeId, attempt: value.attempt,
    claimId: value.claimId, assignmentId: value.assignmentId, invocationId: value.invocationId,
    recipeRevision: value.recipeRevision, policyRevision: value.policyRevision, inputCandidate: value.inputCandidate,
    itemRevision: value.itemRevision, inputSchema: value.inputSchema, inputDigest: value.inputDigest,
    inputByteLength: value.inputByteLength,
  })}\n`);
}

/** Closed journal-ready proof that exact invocation bytes were prepared before dispatch. */
export function createDispatchAuthority(value) {
  if (!exact(value, AUTHORITY_KEYS) || value.schema !== "burnlist-loop-dispatch-authority@1" || value.state !== "prepared-before-dispatch"
    || value.inputSchema !== "burnlist-loop-invocation-input@1" || !DIGESTS.item.test(value.itemRevision)
    || !DIGESTS.raw.test(value.inputDigest) || !Number.isInteger(value.inputByteLength) || value.inputByteLength < 2 || value.inputByteLength > 262_144) fail("invalid dispatch authority");
  identity(value, "dispatch authority");
  const bytes = canonicalAuthority(value);
  return Object.freeze({ value: Object.freeze({ ...value }), bytes, digest: rawSha256(bytes) });
}

export function validateDispatchAuthority(bytes) {
  const raw = Buffer.from(bytes);
  const built = createDispatchAuthority(parseBoundedObject(raw, { maximumBytes: 16_384, maximumDepth: 1, label: "dispatch authority" }));
  if (!built.bytes.equals(raw)) fail("dispatch authority is not canonical");
  return built;
}

export function validateInvocationInput(bytes, authorityBytes) {
  const raw = Buffer.from(bytes);
  const authority = validateDispatchAuthority(authorityBytes);
  const value = parseBoundedObject(raw, { maximumBytes: 262_144, maximumDepth: 2, label: "invocation input" });
  const built = createInvocationInput(value);
  if (!built.bytes.equals(raw)) fail("invocation input is not canonical");
  if (!bindingsMatch(value, authority.value) || value.itemRevision !== authority.value.itemRevision
    || built.digest !== authority.value.inputDigest || built.bytes.length !== authority.value.inputByteLength) fail("invocation input does not match dispatch authority");
  return built;
}

export function validateAgentResult(value, { mode, openFindings = new Map() } = {}) {
  if (!exact(value, RESULT_KEYS) || value.schema !== "agent-result@1") fail("invalid agent result");
  identity(value, "agent result");
  if (!OUTCOMES[mode]?.has(value.outcome)) fail("agent outcome is not allowed for node mode");
  const findings = validateFindingSet(value.findings, value.resolvedFindingIds, openFindings);
  if (mode === "task" && (findings.findings.length || findings.resolvedFindingIds.length)) fail("task completion cannot carry findings");
  const next = nextOpenFindings(openFindings, findings);
  if (mode === "review" && value.outcome === "approve") {
    if (findings.findings.some((finding) => finding.severity === "blocker" || finding.severity === "major")
      || [...openFindings.values()].some((finding) => (finding.severity === "blocker" || finding.severity === "major") && !findings.resolvedFindingIds.includes(finding.id))
      || [...next.values()].some((finding) => finding.severity === "blocker" || finding.severity === "major")) fail("approval has unresolved blocking findings");
  }
  return Object.freeze({ ...value, findings: findings.findings, resolvedFindingIds: findings.resolvedFindingIds });
}

/** Parse then validate raw final bytes; bytes stay available for duplicate/retransmission identity. */
export function parseAgentResult(bytes, options) { return validateAgentResult(parseResultBytes(bytes), options); }
