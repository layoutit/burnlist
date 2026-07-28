type AgentMonitorActivityEvent = {
  category?: unknown;
  eventType?: unknown;
  result?: unknown;
  time?: unknown;
};

type ActivityCategory = "command" | "diff" | "lifecycle" | "message" | "result" | "tool";
type ActivityCounts = Record<ActivityCategory, number>;

export type AgentMonitorActivityBin = {
  counts: ActivityCounts;
  end: number;
  failures: number;
  start: number;
  total: number;
  userMessages: number;
  workTotal: number;
};

export type AgentMonitorActivity = {
  bins: AgentMonitorActivityBin[];
  durationLabel: string;
  endLabel: string;
  maxWork: number;
  startLabel: string;
  total: number;
};

const workCategories: ActivityCategory[] = ["command", "diff", "tool"];

export const activityCategories: ReadonlyArray<{ key: ActivityCategory; label: string }> = [
  { key: "command", label: "Command" },
  { key: "diff", label: "Diff" },
  { key: "tool", label: "Tool" },
  { key: "message", label: "User message" },
  { key: "result", label: "Failure" },
  { key: "lifecycle", label: "Lifecycle" },
];

const WIDTH = 720;
const HEIGHT = 176;
const PLOT = { left: 32, right: 708, top: 28, bottom: 140 };

function counts(): ActivityCounts {
  return { command: 0, diff: 0, lifecycle: 0, message: 0, result: 0, tool: 0 };
}

function category(value: unknown): ActivityCategory | null {
  return typeof value === "string" && activityCategories.some(({ key }) => key === value)
    ? value as ActivityCategory
    : null;
}

function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function duration(milliseconds: number): string {
  if (milliseconds < 60_000) return "<1m";
  if (milliseconds < 3_600_000) return `${Math.ceil(milliseconds / 60_000)}m`;
  if (milliseconds < 86_400_000) return `${Math.ceil(milliseconds / 3_600_000)}h`;
  return `${Math.ceil(milliseconds / 86_400_000)}d`;
}

export function buildAgentMonitorActivity(
  events: AgentMonitorActivityEvent[] | undefined,
  requestedBinCount = 12,
): AgentMonitorActivity {
  const binCount = Math.min(24, Math.max(1, Math.floor(requestedBinCount) || 12));
  const points = (Array.isArray(events) ? events : [])
    .map((event) => ({
      category: category(event?.category),
      failed: event?.result === "failed",
      time: Date.parse(String(event?.time ?? "")),
      userMessage: String(event?.eventType ?? "").split("/").at(-1) === "user_message",
    }))
    .filter((point): point is { category: ActivityCategory; failed: boolean; time: number; userMessage: boolean } =>
      point.category !== null && Number.isFinite(point.time))
    .sort((left, right) => left.time - right.time);

  if (!points.length) {
    return { bins: [], durationLabel: "", endLabel: "", maxWork: 0, startLabel: "", total: 0 };
  }

  const firstTime = points[0].time;
  const lastTime = points.at(-1)?.time ?? firstTime;
  const domainStart = firstTime === lastTime ? firstTime - 60_000 : firstTime;
  const span = lastTime - domainStart;
  const binWidth = span / binCount;
  const bins = Array.from({ length: binCount }, (_, index): AgentMonitorActivityBin => ({
    counts: counts(),
    failures: 0,
    start: domainStart + (binWidth * index),
    end: domainStart + (binWidth * (index + 1)),
    total: 0,
    userMessages: 0,
    workTotal: 0,
  }));

  for (const point of points) {
    const index = Math.min(binCount - 1, Math.floor(((point.time - domainStart) / span) * binCount));
    bins[index].counts[point.category] += 1;
    bins[index].total += 1;
    if (workCategories.includes(point.category)) bins[index].workTotal += 1;
    if (point.failed) bins[index].failures += 1;
    if (point.category === "message" && point.userMessage) bins[index].userMessages += 1;
  }

  return {
    bins,
    durationLabel: duration(lastTime - firstTime),
    endLabel: clock(lastTime),
    maxWork: Math.max(...bins.map((bin) => bin.workTotal)),
    startLabel: clock(firstTime),
    total: points.length,
  };
}

function ActivityBars({ activity }: { activity: AgentMonitorActivity }) {
  const plotWidth = PLOT.right - PLOT.left;
  const plotHeight = PLOT.bottom - PLOT.top;
  const slotWidth = plotWidth / activity.bins.length;
  const barWidth = Math.min(34, slotWidth * 0.66);
  const scaleMax = Math.max(1, activity.maxWork);

  return <svg
    aria-label={`Agent work rhythm from ${activity.startLabel} to ${activity.endLabel}`}
    className="agent-monitor-activity-chart"
    role="img"
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
  >
    <title>Agent work rhythm over time with user messages and failures</title>
    {[PLOT.top, PLOT.top + (plotHeight / 2), PLOT.bottom].map((y) =>
      <line className="agent-monitor-activity-grid" key={y} x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} />,
    )}
    <text className="agent-monitor-activity-axis" x="0" y={PLOT.top + 4}>{activity.maxWork}</text>
    {activity.bins.map((bin, index) => {
      const x = PLOT.left + (slotWidth * index) + ((slotWidth - barWidth) / 2);
      const center = x + (barWidth / 2);
      let y = PLOT.bottom;
      return <g key={bin.start}>
        <title>{`${bin.workTotal} work events, ${bin.userMessages} user messages, ${bin.failures} failures in bucket ${index + 1}`}</title>
        {workCategories.map((key) => {
          const height = (bin.counts[key] / scaleMax) * plotHeight;
          y -= height;
          return height > 0
            ? <rect
                className="agent-monitor-activity-mark"
                data-category={key}
                height={height}
                key={key}
                width={barWidth}
                x={x}
                y={y}
              />
            : null;
        })}
        {bin.failures > 0 && <circle
          className="agent-monitor-activity-signal"
          cx={center}
          cy="9"
          data-signal="failure"
          r={Math.min(5, 3 + (bin.failures * 0.5))}
        />}
        {bin.userMessages > 0 && <rect
          className="agent-monitor-activity-signal"
          data-signal="message"
          height="6"
          transform={`rotate(45 ${center} 20)`}
          width="6"
          x={center - 3}
          y="17"
        />}
        {bin.counts.lifecycle > 0 && <line
          className="agent-monitor-activity-signal"
          data-signal="lifecycle"
          x1={center}
          x2={center}
          y1={PLOT.bottom + 2}
          y2={PLOT.bottom + 8}
        />}
      </g>;
    })}
    <text className="agent-monitor-activity-axis" x={PLOT.left} y="164">{activity.startLabel}</text>
    <text className="agent-monitor-activity-axis" textAnchor="end" x={PLOT.right} y="164">{activity.endLabel}</text>
  </svg>;
}

export function AgentMonitorActivityChart({ events }: { events?: AgentMonitorActivityEvent[] }) {
  const activity = buildAgentMonitorActivity(events);
  return <section aria-labelledby="agent-monitor-activity-title" className="agent-monitor-activity">
    <header className="agent-monitor-activity-heading">
      <div>
        <h2 id="agent-monitor-activity-title">Work rhythm over time</h2>
        {activity.total > 0 && <p>{activity.total} retained events · {activity.durationLabel}</p>}
      </div>
      <ul aria-label="Event categories" className="agent-monitor-activity-legend">
        {activityCategories.map(({ key, label }) =>
          <li data-category={key} key={key}><span aria-hidden="true" />{label}</li>,
        )}
      </ul>
    </header>
    {activity.total > 0
      ? <ActivityBars activity={activity} />
      : <p className="agent-monitor-activity-empty">No timestamped monitor events yet.</p>}
  </section>;
}
