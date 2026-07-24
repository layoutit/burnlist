import { prefixed } from "../dsl/hash.mjs";
import { canonicalPayload } from "./run-codec.mjs";
import { clockAnomalyTransitionPayload, stateTransitionPayload } from "./lifecycle.mjs";

const OPERATION = /^op1-sha256:[a-f0-9]{64}$/u;
const CLAIM = /^cl1-sha256:[a-f0-9]{64}$/u;
const STEP_TYPES = new Set(["edge-traversed", "owner-claim-released", "graph-outcome",
  "system-outcome", "run-state-transition", "clock-anomaly-transition"]);
const NODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const INVOCATION = /^iv1-sha256:[a-f0-9]{64}$/u;
const TERMINAL = new Set(["converged", "needs-human", "failed", "stopped", "budget-exhausted"]);
const STATE = new Set(["running", "paused", "converged-pending-completion", "completion-needs-human", ...TERMINAL]);
const SYSTEM = new Set(["error", "timeout", "cancelled", "lost", "exhausted"]);
const OUTCOME = new Set(["pass", "fail", "reject", "approve", "complete", "escalate",
  ...SYSTEM, "clock-monotonic-regression", "clock-wall-regression"]);
const exact = (value, keys) => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function fail(message) {
  throw Object.assign(new Error(`Loop operation: ${message}`), { code: "ELOOP_OPERATION" });
}
function step(value) {
  if (!exact(value, ["type", "payload"]) || !STEP_TYPES.has(value.type)) fail("invalid operation step");
  const { type, payload } = value;
  if (type === "run-state-transition") stateTransitionPayload(payload);
  else if (type === "clock-anomaly-transition") clockAnomalyTransitionPayload(payload);
  else if (type === "owner-claim-released") {
    if (!exact(payload, ["schema", "runId", "claimId"]) || payload.schema !== "burnlist-loop-owner-claim-release@1" || !CLAIM.test(payload.claimId)) fail("invalid operation release");
  } else if (type === "edge-traversed") {
    if (!exact(payload, ["schema", "from", "on", "to", "visit", "claimId", "invocationId"]) || payload.schema !== "burnlist-loop-edge-traversed@1"
      || !NODE.test(payload.from) || !NODE.test(payload.to) || !["pass", "fail", "reject", "approve", "complete", "escalate"].includes(payload.on)
      || !Number.isSafeInteger(payload.visit) || payload.visit < 1 || payload.visit > 100 || !(payload.claimId === null || CLAIM.test(payload.claimId))
      || !(payload.invocationId === null || INVOCATION.test(payload.invocationId))) fail("invalid operation edge");
  } else if (type === "graph-outcome") {
    if (!exact(payload, ["schema", "nodeId", "state"]) || payload.schema !== "burnlist-loop-graph-outcome@1" || !NODE.test(payload.nodeId) || !TERMINAL.has(payload.state)) fail("invalid operation graph outcome");
  } else if (!exact(payload, ["schema", "outcome", "nodeId", "state", "reason"])
    || payload.schema !== "burnlist-loop-system-outcome@1" || !SYSTEM.has(payload.outcome) || !NODE.test(payload.nodeId)
    || !TERMINAL.has(payload.state) || typeof payload.reason !== "string" || !payload.reason || payload.reason.length > 512 || /[\0\r\n]/u.test(payload.reason)) fail("invalid operation system outcome");
  return Object.freeze({ type, payload: canonicalPayload(payload) });
}

export function operationIntent({ runId, journalDigest, claimId, nodeId, outcome, targetState, steps }) {
  if (typeof runId !== "string" || typeof journalDigest !== "string" || !(claimId === null || CLAIM.test(claimId))
    || !NODE.test(nodeId) || !OUTCOME.has(outcome) || !STATE.has(targetState)
    || !Array.isArray(steps) || steps.length < 1 || steps.length > 5) fail("invalid operation plan");
  const checked = steps.map(step), plan = { claimId, nodeId, outcome, targetState, steps: checked };
  const operationId = prefixed("op1-sha256:", "run-operation-v1",
    [Buffer.from(runId), Buffer.from(journalDigest), Buffer.from(JSON.stringify(canonicalPayload(plan)))]);
  return Object.freeze({ schema: "burnlist-loop-operation-intent@1", operationId, ...plan, steps: Object.freeze(checked) });
}

export function validateOperationIntent(value) {
  if (!exact(value, ["schema", "operationId", "claimId", "nodeId", "outcome", "targetState", "steps"])
    || value.schema !== "burnlist-loop-operation-intent@1" || !OPERATION.test(value.operationId)) fail("invalid operation intent");
  operationIntent({ runId: "validation", journalDigest: "validation", claimId: value.claimId,
    nodeId: value.nodeId, outcome: value.outcome, targetState: value.targetState, steps: value.steps });
  return Object.freeze({ ...value, steps: Object.freeze(value.steps.map((step) => Object.freeze(step))) });
}

export function operationCompletedPayload(operationId) {
  if (!OPERATION.test(operationId)) fail("invalid completed operation");
  return Object.freeze({ schema: "burnlist-loop-operation-completed@1", operationId });
}

export function foldOperation(records) {
  let pending = null; const runId = records[0]?.value?.payload?.runId;
  for (const record of records) {
    const { type, payload } = record.value;
    if (type === "operation-intent") {
      if (pending) fail("operation intent overlaps pending operation");
      const intent = validateOperationIntent(payload);
      const expected = operationIntent({ runId, journalDigest: record.value.prevDigest, claimId: intent.claimId,
        nodeId: intent.nodeId, outcome: intent.outcome, targetState: intent.targetState, steps: intent.steps });
      if (expected.operationId !== intent.operationId) fail("operation id is not journal-derived");
      pending = { intent, cursor: 0 };
      continue;
    }
    if (!pending) {
      if (type === "operation-completed") fail("operation completion has no intent");
      continue;
    }
    if (pending.cursor < pending.intent.steps.length) {
      const expected = pending.intent.steps[pending.cursor];
      if (type !== expected.type || JSON.stringify(payload) !== JSON.stringify(expected.payload)) fail("operation prefix differs from intent");
      pending.cursor += 1; continue;
    }
    if (!exact(payload, ["schema", "operationId"]) || type !== "operation-completed"
      || payload.schema !== "burnlist-loop-operation-completed@1"
      || payload.operationId !== pending.intent.operationId) fail("completed operation prefix lacks exact marker");
    pending = null;
  }
  return pending && Object.freeze({ intent: pending.intent, cursor: pending.cursor });
}
