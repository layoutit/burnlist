import { projectCodexRecord } from "./agent-monitor-event.mjs";
import {
  projectAgyRecord,
  projectClaudeRecord,
  projectGrokRecord,
} from "./agent-monitor-provider-event.mjs";
import {
  coalesceAgentMonitorEvents,
  isVisibleAgentMonitorEvent,
} from "./agent-monitor-projection.mjs";
import { readAgentMonitorTail } from "./agent-monitor-replay.mjs";

const projectors = {
  agy: projectAgyRecord,
  claude: projectClaudeRecord,
  codex: projectCodexRecord,
  grok: projectGrokRecord,
};

export function projectAgentMonitorLines(source, firstLine, session, generatedAt, provider = "codex") {
  const project = projectors[provider];
  if (!project) throw new Error(`Unsupported Agent Monitor provider: ${provider}`);
  const lines = source.toString("utf8").split("\n");
  lines.pop();
  return lines.map((raw, index) => {
    let record;
    try { record = JSON.parse(raw); } catch { record = null; }
    return project(record, firstLine + index, session, raw, generatedAt);
  });
}

function replay(path, cursor, limit, maxFileBytes, session, generatedAt, provider) {
  const tail = readAgentMonitorTail(path, cursor.offset, limit, maxFileBytes);
  const parsed = projectAgentMonitorLines(
    tail.source,
    cursor.line - tail.lineCount + 1,
    session,
    generatedAt,
    provider,
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
  provider = "codex",
  session,
}) {
  const boundedInitial = Math.min(cursor.offset, initialLimit, maxFileBytes);
  const recent = replay(path, cursor, boundedInitial, maxFileBytes, session, generatedAt, provider);
  if (recent.events.length >= maxEvents || boundedInitial >= cursor.offset) return recent;
  return replay(path, cursor, Math.min(cursor.offset, maxFileBytes), maxFileBytes, session, generatedAt, provider);
}
