import { ARTIFACT, RAW_DIGEST, fail, validateRunId } from "./run-codec.mjs";
import { validateClockSample } from "./budgets.mjs";
import { clockAnomalyTransitionPayload, legacyTransitionPayload, stateTransitionPayload } from "./lifecycle.mjs";
import { validateOperationIntent } from "./operation.mjs";

const CLAIM = /^cl1-sha256:[a-f0-9]{64}$/u;
const INVOCATION = /^iv1-sha256:[a-f0-9]{64}$/u;
const OPERATION = /^op1-sha256:[a-f0-9]{64}$/u;
const NODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const OUTCOMES = new Set(["pass", "fail", "reject", "approve", "complete", "escalate"]);
const SYSTEM_OUTCOMES = new Set(["error", "timeout", "cancelled", "lost", "exhausted"]);
const TERMINALS = new Set(["converged", "needs-human", "failed", "stopped", "budget-exhausted"]);
const TYPES = new Set(["run-created", "owner-claim-acquired", "owner-claim-released", "run-state-transition",
  "state-transition", "clock-anomaly-transition", "clock-sampled", "node-entered", "spawn-intent", "output-captured",
  "output-limit-exceeded", "edge-traversed", "graph-outcome", "system-outcome", "operation-intent", "operation-completed"]);

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function exact(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function digest(value, prefix) { return new RegExp(`^${prefix}:[a-f0-9]{64}$`, "u").test(value); }
function noControls(value, maximum = 512) {
  return typeof value === "string" && Buffer.byteLength(value) > 0 && Buffer.byteLength(value) <= maximum && !/[\0\r\n]/u.test(value);
}
function claim(value) {
  if (!exact(value, ["schema", "runId", "claimId", "nodeId", "attempt", "assignmentId", "inputCandidate"])
    || value.schema !== "burnlist-loop-owner-claim@1" || !validateRunId(value.runId) || !CLAIM.test(value.claimId)
    || !NODE.test(value.nodeId) || !integer(value.attempt, 1, 100) || !digest(value.assignmentId, "as1-sha256")
    || !digest(value.inputCandidate, "cm1-sha256")) fail("invalid owner claim record");
}
function created(value) {
  if (!exact(value, ["schema", "runId", "assignmentId", "itemRef", "itemRevision", "recipeRevision", "policyRevision",
    "recipeArtifact", "policyArtifact", "instructionArtifacts", "clock", "state"])
    || value.schema !== "burnlist-loop-run-created@1" || !validateRunId(value.runId) || !digest(value.assignmentId, "as1-sha256")
    || !/^item:[0-9]{6}-[0-9]{3}#[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.itemRef)
    || !digest(value.itemRevision, "id1-sha256") || !digest(value.recipeRevision, "er1-sha256")
    || !digest(value.policyRevision, "bp1-sha256") || !ARTIFACT.test(value.recipeArtifact) || !ARTIFACT.test(value.policyArtifact)
    || !Array.isArray(value.instructionArtifacts) || value.instructionArtifacts.length !== 2
    || value.instructionArtifacts.some((item) => !ARTIFACT.test(item)) || value.state !== "prepared") fail("invalid Run creation record");
  validateClockSample(value.clock);
}
function output(value) {
  if (!exact(value, ["schema", "claimId", "invocationId", "byteLength", "digest", "artifact"])
    || value.schema !== "burnlist-loop-output-captured@1" || !CLAIM.test(value.claimId) || !INVOCATION.test(value.invocationId)
    || !integer(value.byteLength, 1, 16_384) || !RAW_DIGEST.test(value.digest) || !ARTIFACT.test(value.artifact)) fail("invalid output capture record");
}
function spawn(value) {
  if (!exact(value, ["schema", "nodeId", "attempt", "claimId", "invocationId", "launchAuthorityDigest"])
    || value.schema !== "burnlist-loop-spawn-intent@1" || !NODE.test(value.nodeId) || !integer(value.attempt, 1, 100)
    || !CLAIM.test(value.claimId) || !INVOCATION.test(value.invocationId) || !RAW_DIGEST.test(value.launchAuthorityDigest)) fail("invalid spawn intent record");
}
function edge(value) {
  if (!exact(value, ["schema", "from", "on", "to", "visit", "claimId", "invocationId"])
    || value.schema !== "burnlist-loop-edge-traversed@1" || !NODE.test(value.from) || !NODE.test(value.to)
    || !OUTCOMES.has(value.on) || !integer(value.visit, 1, 100)
    || !(value.claimId === null || CLAIM.test(value.claimId)) || !(value.invocationId === null || INVOCATION.test(value.invocationId))) fail("invalid edge traversal record");
}

/** Validates the closed Stage 1 journal union before any record can be hashed or replayed. */
export function validateJournalEvent(type, payload, artifacts) {
  if (!TYPES.has(type)) fail("unknown journal record type");
  if (!Array.isArray(artifacts)) fail("invalid journal artifact list");
  if (type === "run-created") created(payload);
  else if (type === "owner-claim-acquired") claim(payload);
  else if (type === "owner-claim-released") {
    if (!exact(payload, ["schema", "runId", "claimId"]) || payload.schema !== "burnlist-loop-owner-claim-release@1"
      || !validateRunId(payload.runId) || !CLAIM.test(payload.claimId)) fail("invalid owner claim release record");
  } else if (type === "run-state-transition") stateTransitionPayload(payload);
  else if (type === "state-transition") legacyTransitionPayload(payload);
  else if (type === "clock-anomaly-transition") clockAnomalyTransitionPayload(payload);
  else if (type === "clock-sampled") validateClockSample(payload);
  else if (type === "node-entered") {
    if (!exact(payload, ["schema", "nodeId", "attempt", "claimId"]) || payload.schema !== "burnlist-loop-node-entered@1"
      || !NODE.test(payload.nodeId) || !integer(payload.attempt, 1, 100) || !CLAIM.test(payload.claimId)) fail("invalid node entry record");
  } else if (type === "spawn-intent") spawn(payload);
  else if (type === "output-captured") output(payload);
  else if (type === "output-limit-exceeded") {
    if (!exact(payload, ["schema", "claimId", "invocationId", "reason"])
      || payload.schema !== "burnlist-loop-output-limit-exceeded@1" || !CLAIM.test(payload.claimId)
      || !INVOCATION.test(payload.invocationId) || !["output-bytes", "deadline"].includes(payload.reason)) fail("invalid output-limit record");
  } else if (type === "edge-traversed") edge(payload);
  else if (type === "graph-outcome") {
    if (!exact(payload, ["schema", "nodeId", "state"]) || payload.schema !== "burnlist-loop-graph-outcome@1"
      || !NODE.test(payload.nodeId) || !TERMINALS.has(payload.state)) fail("invalid graph outcome record");
  } else if (type === "system-outcome") {
    if (!exact(payload, ["schema", "outcome", "nodeId", "state", "reason"])
      || payload.schema !== "burnlist-loop-system-outcome@1" || !SYSTEM_OUTCOMES.has(payload.outcome)
      || !NODE.test(payload.nodeId) || !TERMINALS.has(payload.state) || !noControls(payload.reason)) fail("invalid system outcome record");
  } else if (type === "operation-intent") validateOperationIntent(payload);
  else if (type === "operation-completed") {
    if (!exact(payload, ["schema", "operationId"]) || payload.schema !== "burnlist-loop-operation-completed@1" || !OPERATION.test(payload.operationId)) fail("invalid operation completion record");
  }
  if (type === "run-created" ? artifacts.length !== 4 : type === "output-captured" ? artifacts.length !== 1 : artifacts.length !== 0)
    fail("journal record has an invalid artifact set");
  if (type === "output-captured") {
    const artifact = artifacts[0];
    if (artifact.digest !== payload.artifact || artifact.revision !== payload.digest || artifact.byteLength !== payload.byteLength
      || artifact.schema !== "burnlist-loop-output-chunk@1" || artifact.mediaType !== "application/octet-stream") fail("output artifact record binding is invalid");
  }
}
