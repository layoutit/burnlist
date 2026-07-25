import { createNormalizedInvocation } from "../adapters/normalized-invocation.mjs";
import { createHostExecutionReport, validateHostExecutionEnvelope } from "../contracts/host-execution.mjs";
import { boundPolicyRevision, loadBoundPolicy } from "./run-artifacts.mjs";
import { createRunRunner } from "./runner.mjs";
import { deriveCandidate } from "./candidate.mjs";
import { ownerClaimId } from "./run-claim.mjs";
import { prepareHostClaim } from "./host-execution.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";

const fail = (message) => {
  throw Object.assign(new Error(`Loop Run binder: ${message}`), { code: "ELOOP_RUN_BINDING" });
};

export function createBoundNormalizedInvocationImpl({ repoRoot, replay, contextFor, candidateForBoundary = null,
  startAgent, runCheck, agentTimeoutMs = 0 }) {
  if (typeof repoRoot !== "string" || !replay?.projection?.assignmentId || !replay?.frozenRecipe?.ir
    || typeof replay.itemText !== "string" || !replay.itemText
    || !Buffer.isBuffer(replay.policyBytes) || typeof contextFor !== "function") fail("invalid production invocation input");
  const policy = loadBoundPolicy(replay.policyBytes).policy;
  const route = (name) => policy.routes.find((entry) => entry.route === name);
  const implementation = route("implementation.standard"), review = route("review.strong");
  if (!implementation || !review) fail("frozen Stage One routes are unavailable");
  const nodes = new Map(replay.frozenRecipe.ir.nodes.map((node) => [node.id, node]));
  return createNormalizedInvocation({ repoRoot, nodes,
    routes: { implementation: { profile: implementation.profile }, review: { profile: review.profile } },
    bindingFor(invocation, node) {
      const context = contextFor(invocation, node), instruction = replay.frozenRecipe.instructions
        .find((item) => item.id === node.instructions);
      if (!context || node.kind === "agent" && !instruction) fail("frozen invocation context is unavailable");
      return { claimId: context.claimId, assignmentId: replay.projection.assignmentId,
        recipeRevision: replay.frozenRecipe.revisions.executable, policyRevision: boundPolicyRevision(policy),
        inputCandidate: context.inputCandidate, instructionBytes: instruction
          ? Buffer.from(instruction.base64, "base64").toString("utf8") : "Run the frozen trusted capability.\n",
        itemText: replay.itemText, candidateContext: context.candidateContext,
        reviewerEvidence: context.reviewerEvidence ?? [] };
    }, candidateForBoundary, startAgent, runCheck, agentTimeoutMs });
}

export function createProductionRunRunnerImpl({ repoRoot, store, runId, authority, contextFor,
  startAgent, runCheck, agentTimeoutMs = 0, binding }) {
  if (authority?.schema === "burnlist-loop-m12-run-authority@1") authority = binding.unseal(authority);
  if (!store?.replay || !authority?.assignmentId || !Buffer.isBuffer(authority.frozenRecipeBytes)
    || !Buffer.isBuffer(authority.policyBytes)) fail("invalid production runner authority");
  const frozenRecipe = loadFrozenRecipe(authority.frozenRecipeBytes);
  const replay = { projection: { assignmentId: authority.assignmentId }, frozenRecipe,
    policyBytes: authority.policyBytes, itemText: authority.itemText };
  const liveContext = (invocation, node) => {
    const execution = store.replay(runId).execution;
    const candidate = execution.candidate ?? deriveCandidate({ repoRoot });
    const check = frozenRecipe.ir.nodes.filter((item) => item.kind === "check")
      .map((item) => execution.evidence[item.id])
      .find((item) => item?.kind === "pass" && item.candidateId === candidate.id && item.cycle === execution.cycle);
    const reviewerEvidence = node.mode === "review"
      ? check?.kind === "pass" && check.candidateId === candidate.id && execution.latest.check?.candidateId === candidate.id
        ? [`trusted-check candidate=${candidate.id} summary=${execution.latest.check.summary}`] : []
      : [];
    return { claimId: ownerClaimId({ runId: invocation.runId, nodeId: invocation.nodeId, attempt: invocation.attempt,
      assignmentId: authority.assignmentId, inputCandidate: candidate.id }), inputCandidate: candidate.id,
      candidateContext: candidate.context, reviewerEvidence };
  };
  const dispatch = createBoundNormalizedInvocationImpl({ repoRoot, replay, contextFor: contextFor ?? liveContext,
    candidateForBoundary: () => deriveCandidate({ repoRoot }), startAgent, runCheck, agentTimeoutMs });
  const launchReplay = () => ({ ...replay, projection: { ...replay.projection,
    itemRef: authority.itemRef, itemRevision: authority.itemRevision },
  boundPolicy: loadBoundPolicy(authority.policyBytes).policy });
  const invoke = async (invocation) => {
    const captured = binding.capture({ repoRoot, replay: launchReplay() });
    binding.recheck(captured); const held = binding.hold(captured);
    try { binding.recheck(captured); return await dispatch(invocation); }
    finally { binding.release(held); }
  };
  const preparedReplay = () => ({ ...store.replay(runId), frozenRecipe, policyBytes: authority.policyBytes,
    itemText: authority.itemText, projection: { ...store.replay(runId).projection, assignmentId: authority.assignmentId,
      itemRef: authority.itemRef, itemRevision: authority.itemRevision } });
  let managedPauseRequested = false;
  const executePreparedAgent = async ({ lease }) => {
    let held = null;
    try {
      const captured = binding.capture({ repoRoot, replay: launchReplay() });
      binding.recheck(captured); held = binding.hold(captured); binding.recheck(captured);
      const prepared = prepareHostClaim({ repoRoot, replay: preparedReplay(), authority: binding.seal(runId, authority) });
      const bound = store.bindExternalClaim(runId, lease, prepared);
      const result = await dispatch.invokePrepared(bound.envelope);
      const envelope = validateHostExecutionEnvelope(bound.envelope);
      if (managedPauseRequested && result.kind === "cancelled") {
        managedPauseRequested = false;
        store.resolveExternalClaim(runId, lease, { claimId: envelope.value.claimId, invocationId: envelope.value.invocationId, reason: "paused" });
        return { released: false };
      }
      if (!["complete", "approve", "reject", "escalate"].includes(result.kind)) {
        const kind = result.kind === "cancelled" ? "cancelled" : result.kind === "timeout" ? "timeout" : result.kind === "lost" ? "lost" : "error";
        store.terminalize(runId, lease, kind, result.summary);
        return;
      }
      const report = createHostExecutionReport({ schema: "burnlist-loop-host-report@1", result: {
        schema: "agent-result@1", runId: envelope.value.runId, nodeId: envelope.value.nodeId, attempt: envelope.value.attempt,
        claimId: envelope.value.claimId, assignmentId: envelope.value.assignmentId, invocationId: envelope.value.invocationId,
        recipeRevision: envelope.value.recipeRevision, policyRevision: envelope.value.policyRevision,
        inputCandidate: envelope.value.inputCandidate, outcome: result.kind,
        findings: result.findings ?? [], resolvedFindingIds: result.resolvedFindingIds ?? [],
      }, telemetry: result.telemetry ?? null }, {
        envelope, mode: preparedReplay().execution.node.mode,
        openFindings: preparedReplay().execution.node.mode === "review"
          ? preparedReplay().execution.openFindings : new Map(),
      });
      store.acceptExternalReport(runId, lease, report.bytes, () => deriveCandidate({ repoRoot }));
      return { released: true };
    } catch (error) {
      const current = store.replay(runId);
      if (!current.execution.terminal && current.execution.lease)
        store.terminalize(runId, lease, "error", String(error?.message ?? "managed claim failed"));
      else throw error;
    } finally { if (held) binding.release(held); }
  };
  Object.defineProperty(executePreparedAgent, "cancel", { value: () => {
    managedPauseRequested = true; return dispatch.cancel?.() === true;
  }, enumerable: false });
  let preparedClaimsAvailable = false;
  try { store.readAuthority?.(runId); preparedClaimsAvailable = true; } catch { /* legacy in-memory fixture */ }
  return createRunRunner({ store, runId, invoke, executePreparedAgent: preparedClaimsAvailable ? executePreparedAgent : null, bindCandidate() {
    const candidate = deriveCandidate({ repoRoot }); return { candidateId: candidate.id, candidateContext: candidate.context };
  } });
}
