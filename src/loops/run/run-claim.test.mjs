import assert from "node:assert/strict";
import test from "node:test";
import { createHostClaim, createHostClaimAbandonment, createHostClaimDocument, createOwnerClaim, hostClaimExpired,
  HOST_CLAIM_ABANDONMENT_REASONS, parseHostClaim, validateHostClaim, validateHostClaimAbandonment } from "./run-claim.mjs";

const identity = {
  runId: "run:01j0abcdefghjkmnpqrstvwxyz", nodeId: "implement", attempt: 1,
  assignmentId: `as1-sha256:${"a".repeat(64)}`, inputCandidate: `cm1-sha256:${"b".repeat(64)}`,
  executionDigest: `sha256:${"c".repeat(64)}`,
};

test("host claim derives the compatible owner identity and has a caller-provided expiry", () => {
  const claim = createHostClaim({ ...identity, expiresAt: 100 });
  assert.equal(claim.claimId, createOwnerClaim(identity).claimId);
  assert.deepEqual(validateHostClaim(claim), claim);
  assert.equal(hostClaimExpired(claim, 99), false);
  assert.equal(hostClaimExpired(claim, 100), true);
  assert.throws(() => hostClaimExpired(claim, -1), /invalid host claim clock/u);
  const document = createHostClaimDocument({ ...identity, expiresAt: 100 });
  assert.equal(parseHostClaim(document.bytes).digest, document.digest);
  assert.throws(() => parseHostClaim(Buffer.concat([document.bytes, Buffer.from(" ")])), /canonical/u);
});

test("host claims fail closed for fabricated identity, unknown fields, and invalid expiry", () => {
  const claim = createHostClaim({ ...identity, expiresAt: 100 });
  assert.throws(() => createHostClaim({ ...identity, claimId: `cl1-sha256:${"c".repeat(64)}`, expiresAt: 100 }), /fabricated/u);
  assert.throws(() => validateHostClaim({ ...claim, extra: true }), /invalid host claim/u);
  assert.throws(() => createHostClaim({ ...identity, expiresAt: 1.5 }), /invalid host claim/u);
  assert.throws(() => createHostClaim({ ...identity, executionDigest: `sha256:${"z".repeat(64)}`, expiresAt: 100 }), /invalid host claim/u);
});

test("host abandonment is identity-bound and has closed reasons", () => {
  const abandonment = createHostClaimAbandonment({ ...identity, expiresAt: 100, reason: "host-lost" });
  assert.deepEqual(validateHostClaimAbandonment(abandonment), abandonment);
  assert.deepEqual(HOST_CLAIM_ABANDONMENT_REASONS, ["host-cancelled", "host-lost", "expired"]);
  assert.throws(() => createHostClaimAbandonment({ ...identity, expiresAt: 100, reason: "retry" }), /abandonment reason/u);
  assert.throws(() => validateHostClaimAbandonment({ ...abandonment, reason: "expired", destination: "burn" }), /invalid host claim/u);
});
