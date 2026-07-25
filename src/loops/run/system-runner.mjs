import { runTrustedCapability } from "../capabilities/runner.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { deriveCandidate } from "./candidate.mjs";
import { createRunRunner } from "./runner.mjs";

function fail(message) {
  throw Object.assign(new Error(`Loop system runner: ${message}`), { code: "ELOOP_SYSTEM_RUNNER" });
}

function summary(result) {
  if (result.timedOut) return "repository check timed out";
  if (result.truncated) return "repository check output limit";
  return `repository check ${result.outcome}`;
}

/** Advance trusted checks and graph-only nodes; agent execution always belongs to the host. */
export function createSystemRunRunner({ repoRoot, store, runId, authority,
  runCheck = runTrustedCapability }) {
  if (!store?.replay || !authority?.frozenRecipeBytes || typeof runCheck !== "function")
    fail("invalid system runner input");
  const graph = loadFrozenRecipe(authority.frozenRecipeBytes).ir;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const invoke = async ({ nodeId }) => {
    const node = nodes.get(nodeId);
    if (node?.kind !== "check") fail("host agent execution is not a system operation");
    const before = deriveCandidate({ repoRoot });
    const checked = await runCheck({
      repoRoot, capabilityId: node.capability, inputCandidate: before.id,
    });
    const after = deriveCandidate({ repoRoot });
    if (after.id !== before.id || checked?.result?.inputCandidate !== before.id)
      return Object.freeze({ kind: "error", summary: "candidate changed at evidence boundary",
        outputBytes: 0, candidateId: before.id });
    if (!["pass", "fail"].includes(checked?.result?.outcome))
      return Object.freeze({ kind: "error", summary: "trusted check returned an invalid outcome",
        outputBytes: 0, candidateId: before.id });
    return Object.freeze({
      kind: checked.result.timedOut ? "timeout" : checked.result.outcome,
      summary: summary(checked.result),
      outputBytes: Buffer.isBuffer(checked.evidence) ? checked.evidence.length : 0,
      candidateId: before.id,
    });
  };
  return createRunRunner({ store, runId, invoke });
}
