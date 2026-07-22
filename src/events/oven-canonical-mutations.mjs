import { createHash } from "node:crypto";
import { publishOvenEvent } from "./oven-event-store.mjs";

export const OVEN_BINDING_CHANGED_KIND = "binding-changed";
export const OVEN_DEFINITION_CHANGED_KIND = "definition-changed";
export const OVEN_LIFECYCLE_CHANGED_KIND = "lifecycle-changed";
export const OVEN_CANONICAL_MUTATION_PHASE = "complete";

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function mutationCursor(prefix, identity) {
  return `${prefix}-sha256-${createHash("sha256").update(canonicalValue(identity)).digest("hex")}`;
}

export function ovenBindingChangedInput({ ovenId, action, path, occurredAt }) {
  return {
    ovenId,
    subjectId: ovenId,
    kind: OVEN_BINDING_CHANGED_KIND,
    phase: OVEN_CANONICAL_MUTATION_PHASE,
    cursor: mutationCursor("binding", { action, ovenId, path, occurredAt }),
    occurredAt,
    payload: { action },
  };
}

export function ovenDefinitionChangedInput({ ovenId, action, revision, generation, occurredAt }) {
  return {
    ovenId,
    subjectId: ovenId,
    kind: OVEN_DEFINITION_CHANGED_KIND,
    phase: OVEN_CANONICAL_MUTATION_PHASE,
    cursor: mutationCursor("definition", { action, ovenId, revision, generation }),
    occurredAt,
    payload: { action, revision },
  };
}

export function ovenLifecycleChangedInput({ burnlistId, from, to, occurredAt }) {
  return {
    ovenId: "checklist",
    subjectId: burnlistId,
    kind: OVEN_LIFECYCLE_CHANGED_KIND,
    phase: OVEN_CANONICAL_MUTATION_PHASE,
    cursor: mutationCursor("lifecycle", { burnlistId, from, to }),
    occurredAt,
    payload: { from, to },
  };
}

export function publishCanonicalMutation(repoRoot, input, {
  publishEvent = publishOvenEvent,
  onError = () => {},
} = {}) {
  if (typeof publishEvent !== "function" || typeof onError !== "function") {
    throw new Error("Canonical mutation event hooks must be functions.");
  }
  try {
    const event = publishEvent(repoRoot, input);
    if (event && typeof event.then === "function") {
      void Promise.resolve(event).catch(() => {});
      throw new Error("Canonical mutation event publisher must complete synchronously.");
    }
    return event;
  } catch (error) {
    try { onError(error, input); } catch {}
    return null;
  }
}
