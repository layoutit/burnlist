import type {
  ChecklistItem,
  ChecklistItemWork,
  ChecklistProgressData,
  CompletedItem,
  HistoryPoint,
} from "./types";

export type EventRow = CompletedItem & { ordinal: number; percent: number };
export type EventDetailField = { label: string; values: string[] };

export type ChecklistOvenPayload = {
  raw: ChecklistProgressData;
  items: Array<ChecklistProgressData["active"][number] & { loopRun: ChecklistProgressData["loopRun"] }>;
  current: { value: string; title: string };
  progress: { done: number; total: number; percent: number; title: string };
  durations: { elapsed: string; pace: string; timeLeft: string };
  ledger: Array<{ key: string; age: string; event: string; result: "Done"; delta: "+1"; donePercent: number }>;
  history: HistoryPoint[];
  events: Array<EventRow & { key: string; age: string; fields: EventDetailField[] }>;
};

const EVENT_DETAIL_LABELS = new Set(["Completed", "Changed", "Proof", "Outcome", "Follow-up"]);
const BLOCKED_RUN_STATES = new Set(["needs-human", "failed", "stopped", "budget-exhausted"]);
const RECENT_ACTIVITY_MS = 120_000;

function pendingWork(): ChecklistItemWork {
  return {
    state: "PENDING",
    reason: "No canonical Run or claim exists; checklist position does not imply execution.",
    run: null,
    progressing: false,
    observation: {
      source: "bounded-correlated-hooks",
      authority: "observational",
      availability: "unavailable",
      lastAt: null,
      lastKind: null,
      ageMilliseconds: null,
      recent: false,
      codeChanges: [],
    },
    provenance: { state: "canonical-burnlist-and-run-absence", activity: "unavailable" },
  };
}

export function effectiveItemWork(data: ChecklistProgressData, item: ChecklistItem): ChecklistItemWork {
  if (item.work) return item.work;
  const run = data.loopRun?.itemRef.endsWith(`#${item.id}`) ? data.loopRun : null;
  if (!run) return pendingWork();
  if (data.loopProjectionDiagnostic || run.diagnostic) return {
    ...pendingWork(),
    state: "BLOCKED",
    reason: "Canonical Run projection is unavailable.",
    provenance: {
      state: "canonical-run-projection",
      activity: "bounded-correlated-hooks-observational-only",
    },
  };
  const now = Date.parse(data.generatedAt);
  const records = run.activity?.records.filter((record) =>
    record.origin === "host-hook" || record.origin === "agent-reported") ?? [];
  const last = records.at(-1) ?? null;
  const ageMilliseconds = last && Number.isSafeInteger(last.at) && Number.isFinite(now)
    ? Math.max(0, now - last.at)
    : null;
  const observation = {
    source: "bounded-correlated-hooks" as const,
    authority: "observational" as const,
    availability: run.activity?.hooks ?? "unavailable",
    lastAt: last?.at ?? null,
    lastKind: last?.kind ?? null,
    ageMilliseconds,
    recent: ageMilliseconds !== null && ageMilliseconds <= RECENT_ACTIVITY_MS,
    codeChanges: [...new Set(records.flatMap((record) => [
      ...(record.observedPath ? [record.observedPath] : []),
      ...(record.observedPaths ?? []),
    ]))].slice(-16),
  };
  const node = run.graph.nodes.find((entry) => entry.id === run.currentNode);
  const projected = BLOCKED_RUN_STATES.has(run.state)
    ? { state: "BLOCKED" as const, reason: `Canonical Run is ${run.state}.` }
    : run.state === "converged"
      ? { state: "WAITING" as const, reason: "Canonical Run converged and is waiting for atomic Burnlist completion." }
      : run.state === "prepared"
        ? { state: "WAITING" as const, reason: "Canonical Run is prepared and waiting for the next host task." }
        : run.state === "paused"
          ? { state: "WAITING" as const, reason: "Canonical Run is paused." }
          : run.state === "running" && node?.kind === "agent" && run.hostTask !== "claimed"
            ? { state: "WAITING" as const, reason: "Canonical agent node is waiting for a host claim." }
            : run.state === "running"
              ? {
                  state: "ACTIVE" as const,
                  reason: run.hostTask === "claimed"
                    ? "Canonical Run has a live host claim."
                    : "Canonical Run is executing a deterministic node.",
                }
              : { state: "BLOCKED" as const, reason: `Canonical Run state ${run.state || "unknown"} is unsupported.` };
  return {
    ...projected,
    run: {
      runId: run.runId,
      state: run.state,
      node: run.currentNode,
      claim: run.hostTask ?? "unavailable",
    },
    progressing: projected.state === "ACTIVE" && observation.recent,
    observation,
    provenance: {
      state: "canonical-run-and-claim",
      activity: "bounded-correlated-hooks-observational-only",
    },
  };
}

export function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--";
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function compactAge(value: string, now: string) {
  const delta = Math.max(0, Date.parse(now) - Date.parse(value));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function timing(data: ChecklistProgressData) {
  const points = data.history.filter((point) => Number.isFinite(Date.parse(point.time)));
  const completedTimes = data.completed.map((item) => Date.parse(item.completedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const start = points.length ? Date.parse(points[0].time) : completedTimes[0] ?? Date.parse(data.generatedAt);
  const lastCompletion = completedTimes.at(-1) ?? start;
  const end = data.remaining === 0 && completedTimes.length ? lastCompletion : Date.parse(data.generatedAt);
  const intervals = completedTimes.map((time, index) => time - (index ? completedTimes[index - 1] : start)).filter((value) => value >= 0);
  if (data.remaining > 0) intervals.push(Math.max(0, end - lastCompletion));
  const pace = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
  const currentAge = Math.max(0, end - lastCompletion);
  const timeLeft = data.remaining ? Math.max(pace, currentAge) + Math.max(0, data.remaining - 1) * pace : 0;
  return { elapsed: end - start, pace, timeLeft };
}

export function checklistEventDetailFields(detail: string): EventDetailField[] {
  const fields: EventDetailField[] = [];
  let current: EventDetailField | null = null;
  for (const rawLine of detail.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^([^:]+):(?:\s*(.*))?$/u);
    if (heading && EVENT_DETAIL_LABELS.has(heading[1])) {
      current = { label: heading[1], values: [] };
      fields.push(current);
      if (heading[2]) current.values.push(heading[2]);
      continue;
    }
    if (!current) {
      current = { label: "Detail", values: [] };
      fields.push(current);
    }
    current.values.push(line.replace(/^-\s+/u, ""));
  }
  return fields;
}

export function eventRows(data: ChecklistProgressData): EventRow[] {
  const total = Math.max(1, data.total);
  return [...data.completed]
    .sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt))
    .map((item, index) => ({ ...item, ordinal: index + 1, percent: Math.min(100, Math.round(((index + 1) / total) * 100)) }))
    .reverse();
}

export function progressHistory(data: ChecklistProgressData): HistoryPoint[] {
  const provided = data.history.filter((point) => Number.isFinite(Date.parse(point.time))).sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const monotonic = provided.every((point, index) => index === 0 || point.done >= provided[index - 1].done);
  if (provided.length && monotonic && provided.at(-1)?.done === data.done) return provided;
  const total = Math.max(1, data.total);
  const rebuilt = [...data.completed].sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt)).map((item, index) => ({ time: item.completedAt, done: index + 1, remaining: Math.max(0, total - index - 1), total, percent: Math.min(100, Math.round(((index + 1) / total) * 100)) }));
  if (data.remaining > 0 && (!rebuilt.length || Date.parse(data.generatedAt) > Date.parse(rebuilt.at(-1)!.time))) rebuilt.push({ time: data.generatedAt, done: data.done, remaining: data.remaining, total, percent: data.percent });
  return rebuilt;
}

export function adaptChecklist(data: ChecklistProgressData): ChecklistOvenPayload {
  const durations = timing(data);
  const rows = eventRows(data);
  const current = data.active.find((item) => effectiveItemWork(data, item).state === "ACTIVE")
    ?? data.active.find((item) => effectiveItemWork(data, item).state === "BLOCKED")
    ?? data.active.find((item) => effectiveItemWork(data, item).state === "WAITING")
    ?? data.active[0];
  const currentState = current ? effectiveItemWork(data, current).state : "PENDING";
  return {
    raw: data,
    items: data.active.map((item) => ({
      ...item,
      loopRun: data.loopRun?.itemRef.endsWith(`#${item.id}`) ? data.loopRun : null,
    })),
    current: { value: current ? `${current.id} · ${currentState}` : "Complete", title: current?.title ?? "No active task" },
    progress: { done: data.done, total: data.total, percent: data.percent, title: `${data.done} of ${data.total} tasks complete` },
    durations: { elapsed: formatDuration(durations.elapsed), pace: formatDuration(durations.pace), timeLeft: formatDuration(durations.timeLeft) },
    ledger: rows.slice(0, 8).map((item) => ({ key: `${item.id}/${item.completedAt}`, age: compactAge(item.completedAt, data.generatedAt), event: item.id, result: "Done", delta: "+1", donePercent: item.percent })),
    history: progressHistory(data),
    events: rows.map((item) => ({ ...item, key: `${item.id}/${item.completedAt}`, age: compactAge(item.completedAt, data.generatedAt), fields: item.detail ? checklistEventDetailFields(item.detail) : [] })),
  };
}
