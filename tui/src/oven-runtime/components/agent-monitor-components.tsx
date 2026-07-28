import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import { TerminalSeriesChart, type TerminalChartPoint } from "../../terminal-line-chart";
import { TerminalList } from "./list-components";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";

type Props = Readonly<{
  node: TerminalNode;
  payload?: JsonValue;
  width: number;
  height?: number;
  controls?: Readonly<Record<string, string | boolean>>;
  selectedId?: string;
  pageIndex?: number;
  pageSize?: number;
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

/** Paged table counterpart for Agent Monitor's repeated event-card template. */
export function TerminalAgentMonitorEventCards({ node, payload, width, height = 8, controls = {}, selectedId, pageIndex = 0, pageSize = 25 }: Props) {
  const filterFrom = text(node.attributes.filterFrom);
  const filter = text(controls[filterFrom] ?? "all");
  const events = values(source(node, payload)).map(record).filter((event) => {
    if (!filter || filter === "all") return true;
    if (filter === "failed") return text(event.result) === "failed";
    return text(event.category) === filter;
  });
  const safeSize = Math.max(1, pageSize), pageCount = Math.max(1, Math.ceil(events.length / safeSize));
  const safePage = Math.max(0, Math.min(pageIndex, pageCount - 1));
  const page = events.slice(safePage * safeSize, (safePage + 1) * safeSize);
  const rows = page.map((event, index) => ({
    id: text(event.key) || `${text(event.line)}-${index}`,
    cells: {
      state: eventStatus(event),
      type: text(event.category).toUpperCase(),
      line: text(event.line),
      event: text(event.detail || event.title),
    },
    tone: text(event.result) === "failed" ? "bad" as const : text(event.result) === "started" ? "warn" as const : undefined,
  }));
  const current = rows.some((row) => row.id === selectedId) ? selectedId : rows[0]?.id;
  return <TerminalList model={{
    columns: [
      { id: "state", label: "STATE", width: 10 },
      { id: "type", label: "TYPE", width: 12 },
      { id: "line", label: "LINE", width: 8 },
      { id: "event", label: "EVENT", minWidth: 20 },
    ],
    rows,
    selectedId: current,
    width,
    height,
    emptyText: "No recent events in this filter.",
  }} />;
}
