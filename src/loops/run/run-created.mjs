import { validateClockSample } from "./budgets.mjs";
import { validateRunId, fail } from "./run-codec.mjs";

const RECIPE = /^er1-sha256:[a-f0-9]{64}$/u;
const POLICY = /^bp1-sha256:[a-f0-9]{64}$/u;
const ASSIGNMENT = /^as1-sha256:[a-f0-9]{64}$/u;
const ITEM = /^item:[0-9]{6}-[0-9]{3}#[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const ITEM_DIGEST = /^id1-sha256:[a-f0-9]{64}$/u;

export function creationPayload({ runId, assignmentId, itemRef, itemRevision, recipeRevision, policyRevision, descriptors, clock }) {
  if (!validateRunId(runId) || !ASSIGNMENT.test(assignmentId) || !ITEM.test(itemRef) || !ITEM_DIGEST.test(itemRevision)
    || !RECIPE.test(recipeRevision) || !POLICY.test(policyRevision)) fail("invalid Run creation identity");
  return {
    schema: "burnlist-loop-run-created@1", runId, assignmentId, itemRef, itemRevision, recipeRevision, policyRevision,
    recipeArtifact: descriptors.find((item) => item.role === "recipe").digest,
    policyArtifact: descriptors.find((item) => item.role === "policy").digest,
    instructionArtifacts: descriptors.filter((item) => item.role.startsWith("instruction:")).map((item) => item.digest),
    clock: validateClockSample(clock), state: "prepared",
  };
}
