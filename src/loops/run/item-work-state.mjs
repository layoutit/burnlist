const BLOCKED_STATES = new Set(["needs-human", "failed", "stopped", "budget-exhausted"]);
export const ITEM_WORK_STATES = Object.freeze(["PENDING", "ACTIVE", "WAITING", "BLOCKED", "COMPLETED"]);
export const RECENT_ACTIVITY_MS = 120_000;

const boundedPaths = (records) => [...new Set(records.flatMap((record) => [
  ...(record.observedPath ? [record.observedPath] : []),
  ...(record.observedPaths ?? []),
]))].slice(-16);

function observation(run, now) {
  const records = run?.activity?.records?.filter((record) =>
    record.origin === "host-hook" || record.origin === "agent-reported") ?? [];
  const last = records.at(-1) ?? null;
  const ageMilliseconds = last && Number.isSafeInteger(last.at)
    ? Math.max(0, now - last.at)
    : null;
  return Object.freeze({
    source: "bounded-correlated-hooks",
    authority: "observational",
    availability: run?.activity?.hooks ?? "unavailable",
    lastAt: last?.at ?? null,
    lastKind: last?.kind ?? null,
    ageMilliseconds,
    recent: ageMilliseconds !== null && ageMilliseconds <= RECENT_ACTIVITY_MS,
    codeChanges: Object.freeze(boundedPaths(records)),
  });
}

function projectedState(run) {
  if (BLOCKED_STATES.has(run.state)) {
    return { state: "BLOCKED", reason: `Canonical Run is ${run.state}.` };
  }
  if (run.state === "converged") {
    return { state: "WAITING", reason: "Canonical Run converged and is waiting for atomic Burnlist completion." };
  }
  if (run.state === "prepared") {
    return { state: "WAITING", reason: "Canonical Run is prepared and waiting for the next host task." };
  }
  if (run.state === "paused") {
    return { state: "WAITING", reason: "Canonical Run is paused." };
  }
  const node = run.graph?.nodes?.find((entry) => entry.id === run.currentNode);
  if (run.state === "running" && node?.kind === "agent" && run.hostTask !== "claimed") {
    return { state: "WAITING", reason: "Canonical agent node is waiting for a host claim." };
  }
  if (run.state === "running") {
    return { state: "ACTIVE", reason: run.hostTask === "claimed"
      ? "Canonical Run has a live host claim."
      : "Canonical Run is executing a deterministic node." };
  }
  return { state: "BLOCKED", reason: `Canonical Run state ${run.state || "unknown"} is unsupported.` };
}

export function projectItemWorkState({ run = null, now = Date.now(), diagnostic = null } = {}) {
  if (diagnostic) return Object.freeze({
    state: "BLOCKED",
    reason: "Canonical Run projection is unavailable.",
    run: null,
    progressing: false,
    observation: observation(null, now),
    provenance: Object.freeze({
      state: "canonical-run-projection",
      activity: "bounded-correlated-hooks-observational-only",
    }),
  });
  if (!run) return Object.freeze({
    state: "PENDING",
    reason: "No canonical Run or claim exists; checklist position does not imply execution.",
    run: null,
    progressing: false,
    observation: observation(null, now),
    provenance: Object.freeze({
      state: "canonical-burnlist-and-run-absence",
      activity: "unavailable",
    }),
  });
  const status = projectedState(run);
  const observed = observation(run, now);
  return Object.freeze({
    ...status,
    run: Object.freeze({
      runId: run.runId,
      state: run.state,
      node: run.currentNode,
      claim: run.hostTask ?? "unavailable",
    }),
    progressing: status.state === "ACTIVE" && observed.recent,
    observation: observed,
    provenance: Object.freeze({
      state: "canonical-run-and-claim",
      activity: "bounded-correlated-hooks-observational-only",
    }),
  });
}

export function completedItemWorkState() {
  return Object.freeze({
    state: "COMPLETED",
    reason: "Canonical Burnlist completed ledger records this item.",
    run: null,
    progressing: false,
    observation: observation(null, Date.now()),
    provenance: Object.freeze({
      state: "canonical-burnlist-completed-ledger",
      activity: "not-applicable",
    }),
  });
}
