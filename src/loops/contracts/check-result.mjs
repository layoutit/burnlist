import { bindingsMatch, DIGESTS, exact, fail, identity, parseResultBytes } from "./contract.mjs";
import { parseAgentResult } from "./agent-result.mjs";

const KEYS = ["schema", "runId", "nodeId", "attempt", "claimId", "assignmentId", "invocationId", "recipeRevision", "policyRevision", "inputCandidate", "capabilityRevision", "outcome", "exitCode", "evidenceDigest", "truncated"];

export function validateCheckResult(value) {
  if (!exact(value, KEYS) || value.schema !== "check-result@1") fail("invalid check result");
  identity(value, "check result");
  if (!DIGESTS.capability.test(value.capabilityRevision) || !["pass", "fail"].includes(value.outcome)
    || !Number.isInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255
    || !DIGESTS.raw.test(value.evidenceDigest) || typeof value.truncated !== "boolean") fail("invalid check result");
  if (value.outcome === "pass" && (value.exitCode !== 0 || value.truncated)) fail("invalid passing check result");
  if (value.outcome === "fail" && value.exitCode === 0 && !value.truncated) fail("invalid failing check result");
  return Object.freeze({ ...value });
}

export function parseCheckResult(bytes) { return validateCheckResult(parseResultBytes(bytes)); }

/**
 * Pure claim-final authority. The durable runner persists dispatch authority and
 * invokes this only after quiescence. It never writes a Run or candidate.
 */
export function createClaimFinalAuthority({ expected, type, mode, openFindings = new Map() }) {
  if (!expected || !["agent", "check"].includes(type)) fail("invalid claim authority");
  identity(expected, "claim authority");
  let phase = "open"; let finalBytes = null; let final = null; let fault = null;
  const decode = (bytes) => type === "agent" ? parseAgentResult(bytes, { mode, openFindings }) : parseCheckResult(bytes);
  function accept(raw, { sourceClaimId = expected.claimId, sourceInvocationId = expected.invocationId } = {}) {
    const bytes = Buffer.from(raw);
    if (phase.startsWith("sealed-")) return Object.freeze({ disposition: "audit-only", reason: "claim-sealed" });
    if (sourceClaimId !== expected.claimId || sourceInvocationId !== expected.invocationId)
      return Object.freeze({ disposition: "audit-only", reason: "replaced-or-late-claim" });
    if (phase.startsWith("exited-")) return Object.freeze({ disposition: "audit-only", reason: "process-exited" });
    if (phase === "fault" || phase === "exited-fault") return Object.freeze({ disposition: "audit-only", reason: "claim-faulted" });
    let value;
    try { value = decode(bytes); } catch (error) {
      fault = error; final = null; finalBytes = null; phase = "fault";
      return Object.freeze({ disposition: "failure-pending-quiescence", reason: "malformed-current-result", error });
    }
    if (!bindingsMatch(value, expected)) return Object.freeze({ disposition: "audit-only", reason: "binding-mismatch" });
    if (type === "check" && value.capabilityRevision !== expected.capabilityRevision) return Object.freeze({ disposition: "audit-only", reason: "capability-mismatch" });
    if (!finalBytes) {
      finalBytes = Buffer.from(bytes); final = value; phase = "candidate";
      return Object.freeze({ disposition: "buffered", result: value });
    }
    if (finalBytes.equals(bytes)) return Object.freeze({ disposition: "idempotent-audit", result: final });
    return Object.freeze({ disposition: "audit-only", reason: "conflicting-duplicate-final" });
  }
  function exit() {
    if (phase.startsWith("sealed-")) return Object.freeze({ disposition: "audit-only", reason: "claim-sealed" });
    if (phase.startsWith("exited-")) return Object.freeze({ disposition: "idempotent-audit", reason: "exit-already-recorded" });
    phase = phase === "candidate" ? "exited-candidate" : phase === "fault" ? "exited-fault" : "exited-open";
    return Object.freeze({ disposition: "exit-recorded" });
  }
  function seal({ quiescent }) {
    if (quiescent !== true) fail("claim cannot seal without proven quiescence");
    if (phase === "sealed-success") return Object.freeze({ disposition: "idempotent-audit", reason: "claim-sealed", result: final });
    if (phase === "sealed-error") return Object.freeze({ disposition: "idempotent-audit", reason: "claim-sealed-error" });
    if (!phase.startsWith("exited-")) fail("claim cannot seal before process exit");
    if (phase === "exited-candidate") { phase = "sealed-success"; return Object.freeze({ disposition: "transition", result: final }); }
    const reason = phase === "exited-fault" ? "malformed-current-result" : "exit-without-valid-final";
    phase = "sealed-error"; return Object.freeze({ disposition: "error-after-quiescence", reason, error: fault });
  }
  return Object.freeze({ accept, exit, seal, get state() { return phase; }, get final() { return phase === "sealed-success" ? final : null; } });
}
