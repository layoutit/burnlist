import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import { TerminalSeriesChart, type TerminalChartPoint } from "../../terminal-line-chart";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";

type Props = Readonly<{
  node: TerminalNode;
  payload?: JsonValue;
  width: number;
  height?: number;
  controls?: Readonly<Record<string, string | boolean>>;
}>;

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>>
    : {};
const values = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
const source = (node: TerminalNode, payload?: JsonValue) =>
  typeof node.attributes.source === "string"
    ? resolveOvenPointer(payload, node.attributes.source)
    : undefined;

function childText(node: TerminalNode, kind: string, payload?: JsonValue) {
  const child = node.children.find((entry) => entry.kind === kind);
  return child ? text(source(child, payload)) : "";
}

/** Compact terminal counterpart of the console Alert family. */
export function TerminalAlert({ node, payload, width, height = 2 }: Props) {
  const palette = useTerminalPalette();
  const variant = text(node.attributes.variant) || "default";
  const tone = variant === "destructive" ? palette.red
    : variant === "warning" ? palette.amber
      : variant === "success" ? palette.green
        : variant === "info" ? palette.blue
          : palette.foreground;
  const marker = variant === "destructive" ? "!" : variant === "warning" ? "▲" : variant === "success" ? "✓" : "•";
  const title = childText(node, "alert-title", payload);
  const description = childText(node, "alert-description", payload);
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <text fg={tone}>{fitText(`${marker} ${title}`, width)}</text>
    {height > 1 ? <text fg={palette.muted}>{fitText(description, width)}</text> : null}
  </box>;
}

const work = new Set(["command", "diff", "tool"]);

/** Time-ordered work rhythm using the same high-resolution terminal series primitive. */
export function TerminalAgentMonitorActivityChart({ node, payload, width, height = 5 }: Props) {
  const events = values(source(node, payload)).map(record);
  const points: TerminalChartPoint[] = events
    .filter((event) => Number.isFinite(Date.parse(text(event.completedAt ?? event.time))))
    .sort((left, right) => Date.parse(text(left.completedAt ?? left.time)) - Date.parse(text(right.completedAt ?? right.time)))
    .map((event, index) => ({
      label: text(event.completedAt ?? event.time) || String(index + 1),
      value: work.has(text(event.category)) ? 1 : 0,
      state: text(event.result) === "failed" ? "fail" : "pass",
    }));
  return <TerminalSeriesChart
    height={height}
    points={points}
    title={points.length ? `Work rhythm · ${points.length} retained events` : "No timestamped monitor events yet."}
    width={width}
  />;
}

function eventStatus(event: Readonly<Record<string, JsonValue>>) {
  const result = text(event.result);
  return result === "failed" ? "FAILED" : result === "started" ? "RUNNING" : "DONE";
}

/** Paged collection counterpart for Agent Monitor's repeated event-card template. */
export function TerminalAgentMonitorEventCards({ node, payload, width, height = 8, controls = {} }: Props) {
  const palette = useTerminalPalette();
  const filterFrom = text(node.attributes.filterFrom);
  const filter = text(controls[filterFrom] ?? "all");
  const events = values(source(node, payload)).map(record).filter((event) => {
    if (!filter || filter === "all") return true;
    if (filter === "failed") return text(event.result) === "failed";
    return text(event.category) === filter;
  });
  const visible = events.slice(-Math.max(1, height)).reverse();
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    {visible.length ? visible.map((event, index) => {
      const failed = text(event.result) === "failed";
      const heading = `${index ? "  " : "› "}${text(event.category).toUpperCase()} · ${text(event.line)} · ${eventStatus(event)}`;
      return <text key={text(event.key) || `${text(event.line)}-${index}`} fg={failed ? palette.red : index ? palette.muted : palette.foreground}>
        {fitText(`${heading} · ${text(event.title || event.detail)}`, width)}
      </text>;
    }) : <text fg={palette.dim}>No recent events in this filter.</text>}
  </box>;
}
