import {
  AGENT_MONITOR_DATA_CONTRACT,
  AGENT_MONITOR_LIMITS,
  assertAgentMonitorSnapshot,
} from "./agent-monitor-data-contract.mjs";

export const AGENT_MONITOR_PROJECTION_VERSION = 12;
const visibleCategories = new Set(["command", "diff", "lifecycle", "message", "result", "tool"]);
const actionableCategories = new Set(["command", "diff", "tool"]);

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function validTime(value, fallback) {
  return Number.isFinite(Date.parse(value ?? "")) ? value : fallback;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--";
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function durations(events) {
  const times = events.map((event) => Date.parse(event.time)).filter(Number.isFinite).sort((left, right) => left - right);
  if (!times.length) return { elapsed: "--", pace: "--", timeLeft: "--" };
  const elapsed = times.at(-1) - times[0];
  const pace = times.length > 1 ? elapsed / (times.length - 1) : 0;
  return { elapsed: formatDuration(elapsed), pace: formatDuration(pace), timeLeft: "--" };
}

export function isVisibleAgentMonitorEvent(event) {
  if (!event || !visibleCategories.has(event.category)) return false;
  if (event.category === "result") return event.result === "failed";
  if (event.category !== "message") return true;
  const subtype = String(event.eventType ?? "").split("/").at(-1);
  return subtype === "agent_message" || subtype === "user_message";
}

function normalizeDisplayEvent(event) {
  const subtype = String(event?.eventType ?? "").split("/").at(-1);
  if (subtype === "user_message") return { ...event, detail: "New user instruction" };
  if (event?.category === "result" && event.result === "failed") {
    return { ...event, detail: "Tool call failed" };
  }
  return event;
}

function completedAction(event, completion) {
  const result = completion.result;
  const status = result === "complete" ? "done" : result === "failed" ? "failed"
    : result === "started" ? "running" : "finished";
  const detail = String(event.detail ?? "").replace(/\s+·\s+(?:done|failed|finished)$/u, "");
  return {
    ...event,
    detail: `${detail} · ${status}`,
    result,
    patch: completion.patch ?? event.patch ?? null,
  };
}

export function coalesceAgentMonitorEvents(events) {
  const coalesced = [];
  const calls = new Map();
  const seen = new Set();
  for (const event of events) {
    if (event?.id && seen.has(event.id)) continue;
    if (event?.id) seen.add(event.id);
    if (event?.callKey && actionableCategories.has(event.category)) {
      calls.set(event.callKey, coalesced.length);
      coalesced.push(event);
      continue;
    }
    const callIndex = event?.category === "result" && event.callKey ? calls.get(event.callKey) : undefined;
    if (callIndex !== undefined) {
      coalesced[callIndex] = completedAction(coalesced[callIndex], event);
      calls.delete(event.callKey);
      continue;
    }
    coalesced.push(event);
  }
  return coalesced;
}

function drift(events) {
  if (events.slice(0, 30).some((event) => event.risk === "destructive")) {
    return {
      level: "alert",
      label: "ALERT · destructive command",
      detail: "A destructive command was observed in the latest 30 monitorable events.",
    };
  }
  if (events.slice(0, 30).filter((event) => event.result === "failed").length >= 3) {
    return {
      level: "watch",
      label: "WATCH · repeated failures",
      detail: "At least three failures were observed in the latest 30 monitorable events.",
    };
  }
  const frequency = new Map();
  for (const event of events.slice(0, 40)) {
    if (!event.actionKey) continue;
    frequency.set(event.actionKey, (frequency.get(event.actionKey) ?? 0) + 1);
  }
  if (Math.max(0, ...frequency.values()) >= 5) {
    return {
      level: "watch",
      label: "WATCH · repeated action",
      detail: "The same command or patch was observed at least five times in the latest 40 monitorable events.",
    };
  }
  return {
    level: "clear",
    label: "Clear · no rule fired",
    detail: "No destructive, repeated-failure, or repeated-action rule fired.",
  };
}

function history(events, generatedAt) {
  const chronological = [...events].reverse();
  if (!chronological.length) return [];
  const total = chronological.length;
  const stride = Math.max(1, Math.ceil(total / 12));
  return chronological
    .map((event, index) => ({ event, index }))
    .filter(({ index }) => index === 0 || index === total - 1 || index % stride === 0)
    .map(({ event, index }) => {
      const done = index + 1;
      return {
        time: validTime(event.time, generatedAt),
        done,
        remaining: total - done,
        total,
        percent: Math.min(100, Math.round((done / total) * 100)),
      };
    });
}

function completedEvent(event, generatedAt) {
  const time = validTime(event.time, generatedAt);
  return {
    id: `L${event.line}`,
    key: event.id,
    line: event.line,
    time,
    completedAt: time,
    category: event.category,
    eventType: event.eventType,
    title: event.title,
    detail: event.detail,
    result: event.result,
    actionKey: event.actionKey ?? null,
    callKey: event.callKey ?? null,
    patch: event.patch ?? null,
    risk: event.risk ?? null,
    signature: event.signature,
  };
}

export function snapshotMonitorEvents(snapshot) {
  if (!Array.isArray(snapshot?.raw?.completed)) return null;
  const completed = numeric(snapshot?.monitor?.projectionVersion) >= 2
    ? snapshot.raw.completed
    : [...snapshot.raw.completed].reverse();
  return completed.map((item) => ({
    id: item.key,
    line: numeric(item.line),
    time: item.time ?? item.completedAt,
    category: item.category ?? "other",
    eventType: item.eventType ?? "unknown",
    title: item.title ?? "Event recorded",
    detail: item.detail ?? "Event recorded",
    result: item.result ?? "observed",
    actionKey: item.actionKey ?? null,
    callKey: item.callKey ?? null,
    patch: item.patch ?? null,
    risk: item.risk ?? null,
    signature: item.signature,
  })).map(normalizeDisplayEvent).filter(isVisibleAgentMonitorEvent);
}

export function buildAgentMonitorSnapshot({
  activityAt,
  events,
  file,
  generatedAt,
  identity,
  line,
  maxEvents = AGENT_MONITOR_LIMITS.maxEvents,
  newEvents = [],
  priorCounts = {},
  nowMs = Date.parse(generatedAt),
}) {
  const retained = events.map(normalizeDisplayEvent).filter(isVisibleAgentMonitorEvent).slice(0, maxEvents);
  const latest = retained[0];
  const driftState = drift(retained);
  const counts = {
    lines: line,
    diffs: numeric(priorCounts.diffs) + newEvents.filter((event) => event.category === "diff").length,
    reasoning: numeric(priorCounts.reasoning) + newEvents.filter((event) => event.category === "reasoning").length,
    commands: numeric(priorCounts.commands) + newEvents.filter((event) => event.category === "command").length,
    failures: numeric(priorCounts.failures) + newEvents.filter((event) => event.result === "failed").length,
  };
  const completed = retained.map((event) => completedEvent(event, generatedAt));
  const total = completed.length;
  const updatedAt = validTime(activityAt ?? latest?.time, generatedAt);
  const live = nowMs - Date.parse(updatedAt) < 90_000;
  const snapshot = {
    schemaVersion: 1,
    contract: AGENT_MONITOR_DATA_CONTRACT,
    identity,
    generatedAt,
    session: { id: identity.session, file },
    current: {
      title: latest?.title ?? "Waiting for session activity",
      value: latest ? `L${latest.line} · ${latest.result}` : "Waiting",
    },
    progress: {
      done: counts.lines,
      total: counts.lines,
      percent: counts.lines ? 100 : 0,
      title: `${counts.lines.toLocaleString()} session events observed`,
    },
    durations: durations(retained),
    raw: {
      generatedAt,
      repoKey: identity.logicalRepoKey,
      title: "Agent Monitor",
      repo: identity.worktreeKey,
      planLabel: identity.session,
      total,
      done: total,
      remaining: 0,
      percent: total ? 100 : 0,
      warnings: driftState.level === "clear" ? [] : [{
        severity: driftState.level === "alert" ? "error" : "warning",
        message: driftState.label,
      }],
      active: [],
      completed,
      history: history(retained, generatedAt),
    },
    monitor: {
      projectionVersion: AGENT_MONITOR_PROJECTION_VERSION,
      summary: {
        state: live ? "Live" : "Idle",
        category: latest?.category ?? "other",
        updatedAt,
        drift: driftState.label,
        driftLevel: driftState.level,
        driftDetail: driftState.detail,
        display: `${live ? "Live" : "Idle"} · ${line.toLocaleString()} events`,
      },
      counts,
      retained: total,
      truncated: counts.lines > total,
    },
  };
  return assertAgentMonitorSnapshot(snapshot);
}

export function agentMonitorSnapshotNeedsRefresh(snapshot, nowMs = Date.now()) {
  if (snapshot?.monitor?.projectionVersion !== AGENT_MONITOR_PROJECTION_VERSION) return true;
  if ((snapshot?.raw?.completed?.length ?? 0) > AGENT_MONITOR_LIMITS.maxEvents) return true;
  const updatedAt = Date.parse(snapshot?.monitor?.summary?.updatedAt ?? "");
  if (!Number.isFinite(updatedAt)) return true;
  const state = nowMs - updatedAt < 90_000 ? "Live" : "Idle";
  return snapshot.monitor.summary.state !== state;
}
