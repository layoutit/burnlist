import { randomBytes } from "node:crypto";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { prefixed, rawSha256 } from "../dsl/hash.mjs";
import { createDispatchAuthority, createInvocationInput } from "../contracts/agent-result.mjs";
import { createHostExecutionEnvelope } from "../contracts/host-execution.mjs";
import { boundPolicyRevision, loadBoundPolicy } from "./run-artifacts.mjs";
import { createHostClaim } from "./run-claim.mjs";
import { deriveCandidate } from "./candidate.mjs";

const fail = (message) => { throw Object.assign(new Error(`Host execution: ${message}`), { code: "EHOST_EXECUTION" }); };

export function prepareHostClaim({ repoRoot, replay, authority, now = Date.now(), random = randomBytes }) {
  const node = replay?.execution?.node;
  if (replay.execution.terminal || replay.execution.started || node?.kind !== "agent") fail("current node is not an unstarted agent");
  const frozen = loadFrozenRecipe(Buffer.from(authority.frozenRecipe, "base64"));
  const policy = loadBoundPolicy(Buffer.from(authority.policy, "base64"));
  const instruction = frozen.instructions.find((item) => item.id === node.instructions);
  if (!instruction) fail("frozen node instructions are unavailable");
  const candidate = deriveCandidate({ repoRoot }), attempt = replay.execution.attempt + 1;
  // A reviewer is evidence about the maker's folded candidate, not about a
  // convenient later workspace snapshot.  Refuse to dispatch it if anything
  // has changed since the candidate was bound.
  if (node.mode === "review" && (!replay.execution.candidate || replay.execution.candidate.id !== candidate.id))
    fail("candidate drift before review claim");
  const reviewerEvidence = node.mode === "review" ? (() => {
    const evidence = Object.entries(replay.execution.evidence ?? {})
      .filter(([nodeId, value]) => frozen.ir.nodes.find((item) => item.id === nodeId)?.kind === "check"
        && value?.kind === "pass" && value.candidateId === candidate.id && value.cycle === replay.execution.cycle)
      .sort(([left], [right]) => left.localeCompare(right));
    if (!evidence.length || replay.execution.latest.check?.candidateId !== candidate.id)
      fail("trusted check evidence is unavailable for review claim");
    return evidence.map(([nodeId, value]) => `artifact:${rawSha256(Buffer.from(JSON.stringify({
      schema: "burnlist-loop-review-evidence@1", nodeId, kind: value.kind, candidateId: value.candidateId, cycle: value.cycle,
    }), "utf8"))}`);
  })() : [];
  const invocationId = prefixed("iv1-sha256:", "host-invocation-v1", [random(32)]), issuedAt = now, expiresAt = issuedAt + 60 * 60 * 1000;
  const common = {
    runId: replay.runId, nodeId: node.id, attempt, assignmentId: authority.assignmentId, invocationId,
    recipeRevision: frozen.revisions.executable, policyRevision: boundPolicyRevision(policy.policy),
    inputCandidate: candidate.id,
  };
  const claimId = createHostClaim({ ...common, executionDigest: `sha256:${"0".repeat(64)}`, expiresAt }).claimId;
  const invocationInput = createInvocationInput({
    schema: "burnlist-loop-invocation-input@1", ...common, claimId, itemRevision: authority.itemRevision,
    ...(node.execution ? { execution: node.execution, intelligence: node.intelligence } : {}),
    mode: node.mode, role: node.role, authority: node.authority,
    legalOutcomes: node.mode === "task" ? ["complete"] : ["approve", "reject", "escalate"],
    requires: [...(node.requires ?? [])].sort(),
    openFindings: node.mode === "review"
      ? [...replay.execution.openFindings.values()].sort((left, right) => left.id.localeCompare(right.id))
      : [],
    instructionDigest: rawSha256(Buffer.from(instruction.base64, "base64")), instructionBytes: instruction.base64,
    itemText: Buffer.from(authority.itemText).toString("base64"),
    candidateContext: Buffer.from(candidate.context).toString("base64"), reviewerEvidence,
  });
  const dispatchAuthority = createDispatchAuthority({
    schema: "burnlist-loop-dispatch-authority@1", state: "prepared-before-dispatch", ...common, claimId,
    itemRevision: authority.itemRevision, inputSchema: invocationInput.value.schema,
    inputDigest: invocationInput.digest, inputByteLength: invocationInput.bytes.length,
  });
  const envelope = createHostExecutionEnvelope({
    schema: "burnlist-loop-host-execution@1", ...common, claimId, issuedAt, expiresAt,
    invocationInput: invocationInput.bytes.toString("base64"), dispatchAuthority: dispatchAuthority.bytes.toString("base64"),
  });
  const claim = createHostClaim({ ...common, claimId, executionDigest: envelope.digest, expiresAt });
  return Object.freeze({ claim, envelope: envelope.bytes });
}
