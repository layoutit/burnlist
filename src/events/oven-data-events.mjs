import { normalizeOvenEvent } from "./oven-event-contract.mjs";
import { publishOvenEvent } from "./oven-event-store.mjs";

export const OVEN_DATA_PUBLISHED_KIND = "data-published";
export const OVEN_DATA_PUBLISHED_PHASE = "complete";

export function ovenDataPublishedInput(input, options = {}) {
  const normalized = normalizeOvenEvent({
    ...input,
    kind: OVEN_DATA_PUBLISHED_KIND,
    phase: OVEN_DATA_PUBLISHED_PHASE,
  }, options);
  return {
    ovenId: normalized.ovenId,
    subjectId: normalized.subjectId,
    kind: normalized.kind,
    phase: normalized.phase,
    cursor: normalized.cursor,
    occurredAt: normalized.occurredAt,
    payload: normalized.payload,
  };
}

export function publishOvenDataPublishedEvent(repoRoot, input, options = {}) {
  return publishOvenEvent(repoRoot, ovenDataPublishedInput(input, options));
}
