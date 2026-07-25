import { prefixed, rawSha256 } from "../dsl/hash.mjs";
import { parseBoundedObject } from "../contracts/contract.mjs";
import { RUN_ID, fail } from "./run-codec.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ASSIGNMENT = /^as1-sha256:[a-f0-9]{64}$/u;
const CANDIDATE = /^cm1-sha256:[a-f0-9]{64}$/u;
const CLAIM = /^cl1-sha256:[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HOST_CLAIM_KEYS = ["schema", "runId", "claimId", "nodeId", "attempt", "assignmentId", "inputCandidate", "executionDigest", "expiresAt"];
const ABANDONMENT_KEYS = [...HOST_CLAIM_KEYS, "reason"];
const ABANDONMENT_REASONS = new Set(["host-cancelled", "host-lost", "expired"]);
const MAX_EXPIRES_AT = 8_640_000_000_000_000;
const MAX_CLAIM_BYTES = 16_384;

export const HOST_CLAIM_SCHEMA = "burnlist-loop-host-claim@1";
export const HOST_CLAIM_ABANDONMENT_SCHEMA = "burnlist-loop-host-claim-abandonment@1";
export const HOST_CLAIM_MAX_BYTES = MAX_CLAIM_BYTES;
export const HOST_CLAIM_ABANDONMENT_REASONS = Object.freeze(["host-cancelled", "host-lost", "expired"]);
export const HOST_CLAIM_MAX_EXPIRES_AT_MILLISECONDS = MAX_EXPIRES_AT;

function exact(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
    && keys.every((key, index) => Object.keys(value)[index] === key);
}

function validExpiry(value) { return Number.isSafeInteger(value) && value >= 0 && value <= MAX_EXPIRES_AT; }

function claimFields(value, schema, keys) {
  if (!exact(value, keys) || value.schema !== schema || !RUN_ID.test(value.runId) || !CLAIM.test(value.claimId)
    || !SLUG.test(value.nodeId) || !Number.isInteger(value.attempt) || value.attempt < 1 || value.attempt > 100
    || !ASSIGNMENT.test(value.assignmentId) || !CANDIDATE.test(value.inputCandidate) || !DIGEST.test(value.executionDigest)
    || !validExpiry(value.expiresAt)
    || value.claimId !== ownerClaimId(value)) fail("invalid host claim");
  return value;
}

export function ownerClaimId({ runId, nodeId, attempt, assignmentId, inputCandidate }) {
  if (!RUN_ID.test(runId) || !SLUG.test(nodeId) || !Number.isInteger(attempt) || attempt < 1 || attempt > 100
    || !ASSIGNMENT.test(assignmentId) || !CANDIDATE.test(inputCandidate)) fail("invalid owner claim identity");
  return prefixed("cl1-sha256:", "claim-v1", [Buffer.from(runId), Buffer.from(nodeId), Buffer.from(String(attempt)), Buffer.from(assignmentId), Buffer.from(inputCandidate)]);
}

export function createOwnerClaim(value) {
  const claimId = ownerClaimId(value);
  if (value.claimId !== undefined && value.claimId !== claimId) fail("fabricated owner claim id");
  return Object.freeze({ schema: "burnlist-loop-owner-claim@1", runId: value.runId, claimId, nodeId: value.nodeId,
    attempt: value.attempt, assignmentId: value.assignmentId, inputCandidate: value.inputCandidate });
}

/** A host-issued lease. `expiresAt` is supplied by the controller; this module never reads a clock. */
export function createHostClaim(value) {
  const claimId = ownerClaimId(value);
  if (value.claimId !== undefined && value.claimId !== claimId) fail("fabricated host claim id");
  const claim = { schema: HOST_CLAIM_SCHEMA, runId: value.runId, claimId, nodeId: value.nodeId,
    attempt: value.attempt, assignmentId: value.assignmentId, inputCandidate: value.inputCandidate,
    executionDigest: value.executionDigest, expiresAt: value.expiresAt };
  return Object.freeze(claimFields(claim, HOST_CLAIM_SCHEMA, HOST_CLAIM_KEYS));
}

export function validateHostClaim(value) {
  const claim = claimFields(value, HOST_CLAIM_SCHEMA, HOST_CLAIM_KEYS);
  return Object.freeze({ schema: claim.schema, runId: claim.runId, claimId: claim.claimId, nodeId: claim.nodeId,
    attempt: claim.attempt, assignmentId: claim.assignmentId, inputCandidate: claim.inputCandidate,
    executionDigest: claim.executionDigest, expiresAt: claim.expiresAt });
}

export function hostClaimExpired(value, now) {
  if (!validExpiry(now)) fail("invalid host claim clock");
  return now >= validateHostClaim(value).expiresAt;
}

export function createHostClaimAbandonment(value) {
  const claim = createHostClaim(value);
  const abandonment = { ...claim, schema: HOST_CLAIM_ABANDONMENT_SCHEMA, reason: value.reason };
  return validateHostClaimAbandonment(abandonment);
}

export function validateHostClaimAbandonment(value) {
  const abandonment = claimFields(value, HOST_CLAIM_ABANDONMENT_SCHEMA, ABANDONMENT_KEYS);
  if (!ABANDONMENT_REASONS.has(abandonment.reason)) fail("invalid host claim abandonment reason");
  return Object.freeze({ schema: abandonment.schema, runId: abandonment.runId, claimId: abandonment.claimId,
    nodeId: abandonment.nodeId, attempt: abandonment.attempt, assignmentId: abandonment.assignmentId,
    inputCandidate: abandonment.inputCandidate, executionDigest: abandonment.executionDigest,
    expiresAt: abandonment.expiresAt, reason: abandonment.reason });
}

function canonical(value) {
  const claim = validateHostClaim(value);
  return Buffer.from(`${JSON.stringify(claim)}\n`, "utf8");
}

export function createHostClaimDocument(value) {
  const claim = createHostClaim(value), bytes = canonical(claim);
  if (bytes.length > MAX_CLAIM_BYTES) fail("host claim exceeds bounds");
  return Object.freeze({ value: claim, bytes, digest: rawSha256(bytes) });
}

export function parseHostClaim(bytes) {
  const raw = Buffer.from(bytes);
  const value = parseBoundedObject(raw, { maximumBytes: MAX_CLAIM_BYTES, maximumDepth: 1, label: "host claim" });
  const built = createHostClaimDocument(value);
  if (!built.bytes.equals(raw)) fail("host claim is not canonical");
  return built;
}
