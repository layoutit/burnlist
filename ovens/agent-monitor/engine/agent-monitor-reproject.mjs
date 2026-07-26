import { projectCodexRecord } from "./agent-monitor-event.mjs";
import {
  coalesceAgentMonitorEvents,
  isVisibleAgentMonitorEvent,
} from "./agent-monitor-projection.mjs";
import { readAgentMonitorTail } from "./agent-monitor-replay.mjs";

export function projectAgentMonitorLines(source, firstLine, session, generatedAt) {
  const lines = source.toString("utf8").split("\n");
  lines.pop();
  return lines.map((raw, index) => {
    let record;
    try { record = JSON.parse(raw); } catch { record = null; }
    return projectCodexRecord(record, firstLine + index, session, raw, generatedAt);
  });
}

function replay(path, cursor, limit, maxFileBytes, session, generatedAt) {
  const tail = readAgentMonitorTail(path, cursor.offset, limit, maxFileBytes);
  const parsed = projectAgentMonitorLines(
    tail.source,
    cursor.line - tail.lineCount + 1,
    session,
    generatedAt,
  );
  return {
    activityAt: parsed.at(-1)?.time,
    events: coalesceAgentMonitorEvents(parsed).filter(isVisibleAgentMonitorEvent).reverse(),
  };
}

export function reprojectRecentAgentMonitorEvents({
  cursor,
  generatedAt,
  initialLimit,
  maxEvents,
  maxFileBytes,
  path,
  session,
}) {
  const boundedInitial = Math.min(cursor.offset, initialLimit, maxFileBytes);
  const recent = replay(path, cursor, boundedInitial, maxFileBytes, session, generatedAt);
  if (recent.events.length >= maxEvents || boundedInitial >= cursor.offset) return recent;
  return replay(path, cursor, Math.min(cursor.offset, maxFileBytes), maxFileBytes, session, generatedAt);
}
