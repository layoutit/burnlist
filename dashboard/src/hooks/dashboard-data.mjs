export const dashboardProjectEvents = Object.freeze([
  Object.freeze({ ovenId: "*", kind: "data-published", phase: "complete" }),
  Object.freeze({ ovenId: "*", kind: "binding-changed", phase: "complete" }),
  Object.freeze({ ovenId: "*", kind: "definition-changed", phase: "complete" }),
  Object.freeze({ ovenId: "checklist", kind: "item-burned", phase: "completed" }),
  Object.freeze({ ovenId: "checklist", kind: "lifecycle-changed", phase: "complete" }),
  Object.freeze({ ovenId: "checklist", kind: "loop-projection-changed", phase: "complete" }),
]);
export const dashboardProgressEvents = Object.freeze([
  Object.freeze({ ovenId: "checklist", kind: "data-published", phase: "complete" }),
  Object.freeze({ ovenId: "checklist", kind: "item-burned", phase: "completed" }),
  Object.freeze({ ovenId: "checklist", kind: "lifecycle-changed", phase: "complete" }),
  Object.freeze({ ovenId: "checklist", kind: "loop-projection-changed", phase: "complete" }),
]);

function selectedQuery(selected) {
  return new URLSearchParams(Object.entries(selected ?? {}).filter(([, value]) => value !== undefined)).toString();
}

export function receiveProjects(response, json) {
  if (!response.ok) throw new Error("Could not load Burnlists.");
  if (!json || typeof json !== "object" || !Array.isArray(json.projects)) {
    throw new Error("Burnlist project data is invalid.");
  }
  return json.projects;
}

export function receiveProgress(response, json) {
  if (!response.ok) {
    throw new Error(json && typeof json === "object" && typeof json.error === "string"
      ? json.error
      : "Could not load progress.");
  }
  if (!json || typeof json !== "object") throw new Error("Burnlist progress data is invalid.");
  return json;
}

export function dashboardProjectsSnapshotConfig(enabled) {
  return {
    transport: "snapshot",
    enabled,
    repoKey: null,
    ovenId: "checklist",
    subjectId: null,
    query: "projection=projects",
    makeUrl: () => "/api/projects",
    receive: receiveProjects,
    fallbackError: "Could not load Burnlists.",
    initialData: [],
    events: dashboardProjectEvents,
    deps: [enabled],
  };
}

export function dashboardProgressSnapshotConfig(enabled, selected) {
  const query = selectedQuery(selected);
  return {
    transport: "snapshot",
    enabled: enabled && Boolean(selected),
    repoKey: selected?.repoKey ?? null,
    ovenId: "checklist",
    // Loop invalidations are keyed by an itemRef; progress is the owning Burnlist projection.
    subjectId: null,
    query,
    makeUrl: () => `/api/progress?${query}`,
    receive: receiveProgress,
    fallbackError: "Could not load progress.",
    initialData: null,
    events: dashboardProgressEvents,
    deps: [enabled, query],
  };
}

export function receiveLoopProjection(response, json) {
  if (!response.ok) throw new Error(json?.error ?? "Could not load Loop projection.");
  if (!json || typeof json !== "object" || !("loopRun" in json)) throw new Error("Loop projection data is invalid.");
  return json.loopRun;
}

export function dashboardLoopProjectionSnapshotConfig(enabled, selected) {
  const query = selectedQuery(selected);
  const subjectId = selected?.id && selected?.item ? `item:${selected.id}#${selected.item}` : null;
  return {
    transport: "snapshot", enabled: enabled && Boolean(selected), repoKey: selected?.repoKey ?? null,
    ovenId: "checklist", subjectId, query: `loop/${query}`,
    makeUrl: () => `/api/loop-projection?${query}`, receive: receiveLoopProjection,
    fallbackError: "Could not load Loop projection.", initialData: null,
    events: [Object.freeze({ ovenId: "checklist", kind: "loop-projection-changed", phase: "complete" })], deps: [enabled, query],
  };
}
