function normalizedQuery(value) {
  const query = String(value ?? "").replace(/^\?/u, "");
  const params = new URLSearchParams(query);
  params.sort();
  return params.toString();
}

export function optionalSnapshotText(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string or null.`);
  return value;
}

export function ovenSnapshotKey({ repoKey, ovenId, subjectId, query } = {}) {
  if (typeof ovenId !== "string" || !ovenId) throw new Error("Oven snapshot ovenId is required.");
  return JSON.stringify([
    optionalSnapshotText(repoKey, "Oven snapshot repoKey"),
    ovenId,
    optionalSnapshotText(subjectId, "Oven snapshot subjectId"),
    normalizedQuery(query),
  ]);
}

export function publicOvenSnapshotState(entry) {
  return Object.freeze({
    key: entry.key,
    data: entry.data,
    error: entry.error,
    loading: entry.loading,
    stale: entry.stale,
    generation: entry.generation,
    outcome: entry.outcome,
  });
}

export function normalizedEventSelectors(descriptor) {
  const selectors = descriptor.events ?? [
    { ovenId: descriptor.ovenId, kind: "data-published", phase: "complete" },
    { ovenId: descriptor.ovenId, kind: "binding-changed", phase: "complete" },
    { ovenId: descriptor.ovenId, kind: "definition-changed", phase: "complete" },
  ];
  if (!Array.isArray(selectors) || !selectors.length) {
    throw new Error("Oven snapshot events must be a non-empty array.");
  }
  return selectors.map((selector) => {
    if (!selector || typeof selector !== "object") throw new Error("Oven snapshot event selectors must be objects.");
    const ovenId = selector.ovenId ?? descriptor.ovenId;
    if (ovenId !== "*" && (typeof ovenId !== "string" || !ovenId)) {
      throw new Error("Oven snapshot event selector ovenId must be an Oven id or wildcard.");
    }
    if (typeof selector.kind !== "string" || !selector.kind || typeof selector.phase !== "string" || !selector.phase) {
      throw new Error("Oven snapshot event selectors require kind and phase.");
    }
    return Object.freeze({ ovenId, kind: selector.kind, phase: selector.phase });
  });
}

export function ovenSnapshotEventMatches(entry, event) {
  const ovenWide = event.kind === "data-published"
    || event.kind === "binding-changed"
    || event.kind === "definition-changed";
  return (entry.repoKey === null || entry.repoKey === event.repoKey)
    && (ovenWide || entry.subjectId === null || entry.subjectId === event.subjectId)
    && entry.events.some((selector) => (selector.ovenId === "*" || selector.ovenId === event.ovenId)
      && selector.kind === event.kind
      && selector.phase === event.phase);
}

export function ovenSnapshotResetMatches(entry, reset) {
  return (entry.repoKey === null || entry.repoKey === reset.repoKey)
    && (reset.ovenId === null || entry.events.some((selector) => (
      selector.ovenId === "*" || selector.ovenId === reset.ovenId
    )));
}
