import { prefixed } from "../dsl/hash.mjs";
import { RUN_ID, fail } from "./run-codec.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ASSIGNMENT = /^as1-sha256:[a-f0-9]{64}$/u;
const CANDIDATE = /^cm1-sha256:[a-f0-9]{64}$/u;

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
