import { publishCanonicalMutation } from "../../events/oven-canonical-mutations.mjs";

export const LOOP_PROJECTION_CHANGED_KIND = "loop-projection-changed";
export const LOOP_PROJECTION_CHANGED_PHASE = "complete";

/** Observational only: the journal commit has already completed when this runs. */
export function loopProjectionChangedInput({ projection, revision, occurredAt = new Date().toISOString() }) {
  if (typeof projection?.itemRef !== "string" || typeof revision !== "string") {
    throw new Error("Loop projection event requires a committed Run projection.");
  }
  return {
    ovenId: "checklist",
    subjectId: projection.itemRef,
    kind: LOOP_PROJECTION_CHANGED_KIND,
    phase: LOOP_PROJECTION_CHANGED_PHASE,
    cursor: revision,
    occurredAt,
    payload: { revision },
  };
}

export function publishLoopProjectionInvalidation(repoRoot, replay, options) {
  return publishCanonicalMutation(repoRoot, loopProjectionChangedInput({
    projection: replay?.projection,
    revision: replay?.revision,
  }), options);
}
