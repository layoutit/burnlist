import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { evaluateOvenBinding } from "../value-runtime";

export type StatusActivity = "idle" | "loading" | "queued" | "running" | "failed";
export type StatusSurfaceModel = Readonly<{ title: string; count?: string; note?: string; empty?: string; activity: StatusActivity; activityText: string }>;

const text = (value: unknown) => value === undefined || value === null ? "" : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
const activity = (value: unknown): StatusActivity => ["loading", "queued", "running", "failed"].includes(String(value)) ? value as StatusActivity : "idle";
const record = (value: unknown): Readonly<Record<string, JsonValue>> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, JsonValue>> : undefined;
const read = (node: TerminalNode, key: string, payload: JsonValue | undefined) => {
  const binding = node.bindings[key];
  if (binding) return evaluateOvenBinding(binding, payload);
  const value = node.attributes[key];
  return typeof value === "string" && value.startsWith("/") ? evaluateOvenBinding({ source: value }, payload) : value;
};

/** Safe model projection shared by the heading, refresh, note, and empty surfaces. */
export function statusSurfaceModel(node: TerminalNode, payload: JsonValue | undefined): StatusSurfaceModel {
  const source = read(node, "source", payload), sourceRecord = record(source);
  const phase = node.kind === "refresh-status" ? activity(sourceRecord?.status ?? source) : "idle";
  const labels: Record<StatusActivity, string> = { idle: "", loading: "Loading", queued: "Queued", running: "Updating", failed: "Update failed" };
  if (node.kind === "refresh-status") {
    const error = phase === "failed" ? text(sourceRecord?.error) : "";
    return { title: "", activity: phase, activityText: error ? `${labels[phase]} · ${error}` : labels[phase] };
  }
  if (node.kind === "domain-note") return { title: text(read(node, "isTarget", payload)) === "true" ? "Qualifying target" : "Diagnostic context", note: text(read(node, "rationale", payload) ?? read(node, "source", payload)), activity: phase, activityText: labels[phase] };
  if (node.kind === "differential-empty-state") return { title: text(record(payload)?.title) || text(read(node, "title", payload)) || "Differential Testing", empty: `No ${text(record(payload)?.title) || text(read(node, "title", payload)) || "Differential Testing"} scenarios`, activity: phase, activityText: labels[phase] };
  return { title: text(read(node, "title", payload) ?? read(node, "source", payload)), count: text(read(node, "count", payload)), activity: phase, activityText: labels[phase] };
}

export function statusActivityText(model: StatusSurfaceModel, width: number) {
  // Always reserve this cell range so a status transition cannot move siblings.
  return fitText(model.activityText ? `${model.activity === "failed" ? "!" : model.activity === "running" ? "↻" : "…"} ${model.activityText}` : "", Math.max(1, width)).padEnd(Math.max(1, width));
}

/** Fixed-height terminal-native heading/status/note/empty projection. */
export function TerminalStatusSurface({ node, payload, width, height = 2 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const model = statusSurfaceModel(node, payload), lineWidth = Math.max(1, Math.floor(width)), rows = Math.max(1, Math.floor(height));
  const tone = model.activity === "failed" ? palette.red : model.activity === "idle" ? palette.dim : model.activity === "running" ? palette.blue : palette.amber;
  if (node.kind === "refresh-status") return <box width={lineWidth} height={rows} overflow="hidden"><text fg={tone}>{statusActivityText(model, lineWidth)}</text></box>;
  if (node.kind === "domain-note") return <box width={lineWidth} height={rows} flexDirection="column" overflow="hidden"><text fg={palette.blue}>{fitText(`› ${model.title}`, lineWidth)}</text>{rows > 1 ? <text fg={palette.muted}>{fitText(model.note || "", lineWidth)}</text> : null}</box>;
  if (node.kind === "differential-empty-state") return <box width={lineWidth} height={rows} flexDirection="column" overflow="hidden"><text fg={palette.foreground}>{fitText(model.title, lineWidth)}</text>{rows > 1 ? <text fg={palette.dim}>{fitText(`○ ${model.empty}`, lineWidth)}</text> : null}</box>;
  const reserve = Math.min(14, Math.max(6, Math.floor(lineWidth / 3))), titleWidth = Math.max(1, lineWidth - reserve);
  return <box width={lineWidth} height={rows} flexDirection="column" overflow="hidden"><box height={1} flexDirection="row"><text fg={palette.foreground}>{fitText(`${model.title}${model.count ? ` (${model.count})` : ""}`, titleWidth)}</text><text fg={tone}>{statusActivityText(model, reserve)}</text></box>{rows > 1 ? <text fg={palette.muted}>{fitText(model.note || "", lineWidth)}</text> : null}</box>;
}
