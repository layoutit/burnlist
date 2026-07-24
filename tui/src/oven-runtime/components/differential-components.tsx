import { fitText, palette } from "../../theme";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";
import { burnDonutCounts, progressDonutText, waffleMetricText } from "./progress-components";

type RecordValue = Record<string, JsonValue>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): readonly JsonValue[] => Array.isArray(value) ? value as JsonValue[] : [];
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "—";
const source = (node: TerminalNode, payload?: JsonValue) => resolveOvenPointer(payload, node.attributes.source);

/** JSON-safe model shared by the Differential KPI, chart, log, and field roots. */
export function differentialKpiModel(payload?: JsonValue) {
  const data = record(payload), catalog = record(data.scenarioCatalog), scenarios = list(catalog.scenarios), progress = list(data.progress), latest = record(progress.at(-1)), summary = record(data.summary);
  const total = Math.max(0, number(latest.frames)), done = Math.max(0, Math.min(total, number(latest.frame))), fields = record(summary.fields), frames = record(summary.frames), logs = list(data.log);
  const selected = text(catalog.selectedScenarioId), counts = burnDonutCounts(logs.map((entry) => record(entry)));
  return { selected, scenarioCount: scenarios.length, total, done, percent: total ? Math.round(done / total * 100) : 0, logs, counts, fields, frames };
}

export function TerminalDifferentialKpiStrip({ payload, width }: { node: TerminalNode; payload?: JsonValue; width: number }) {
  const model = differentialKpiModel(payload), compact = width < 56;
  const items = [
    `◎ Scenario ${model.selected}${model.scenarioCount > 1 ? ` (${model.scenarioCount})` : ""}`,
    `◒ Progress ${model.done}/${model.total} ${model.percent}%`,
    `◉ Results +${model.counts.improved} -${model.counts.worsened} ·${model.counts.unchanged} !${model.counts.reverted}`,
    `▦ Fields ${waffleMetricText(model.fields, compact ? 7 : 10)}`,
    `▤ Frames ${waffleMetricText(model.frames, compact ? 7 : 10)}`,
  ];
  if (compact) return <box width={width} height={6} flexDirection="column" overflow="hidden"><text fg={palette.foreground}>{fitText("Differential Testing", width)}</text>{items.map((item) => <text key={item} fg={palette.muted}>{fitText(item, width)}</text>)}</box>;
  return <box width={width} height={3} flexDirection="column" overflow="hidden"><text fg={palette.foreground}>{fitText("Differential Testing", width)}</text><box flexDirection="row" width={width} overflow="hidden">{items.map((item) => <box key={item} width={Math.max(8, Math.floor(width / items.length))} overflow="hidden"><text fg={palette.muted}>{fitText(item, Math.max(8, Math.floor(width / items.length)))}</text></box>)}</box></box>;
}

export function TerminalDifferentialChart({ node, payload, width }: { node: TerminalNode; payload?: JsonValue; width: number }) {
  const points = list(source(node, payload)), latest = record(points.at(-1)), total = Math.max(0, number(latest.frames)), done = Math.max(0, Math.min(total, number(latest.frame))), delta = number(latest.frameDelta);
  const label = node.kind === "frame-delta-chart" ? `Δ frame ${delta >= 0 ? "+" : ""}${delta}` : `Progress ${done}/${total}`;
  return <box width={width} height={2} flexDirection="column" overflow="hidden"><text>{fitText(label, width)}</text><text fg={delta < 0 ? palette.red : palette.green}>{fitText(node.kind === "frame-delta-chart" ? `${delta < 0 ? "▼" : "▲"} ${"▰".repeat(Math.min(Math.max(1, width - 4), Math.abs(delta) || 1))}` : progressDonutText(total ? done / total * 100 : 0, Math.max(3, width - 7)), width)}</text></box>;
}

export function TerminalDifferentialLogTable({ node, payload, width, height = 8 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const entries = list(source(node, payload)).slice(0, Math.max(1, height - 1));
  return <box width={width} height={height} flexDirection="column" overflow="hidden"><text fg={palette.dim}>{fitText("AGE  FRAME RESULT  DELTA DONE", width)}</text>{entries.length ? entries.map((entry, index) => { const row = record(entry), delta = number(row.frameDelta), frames = number(row.frames), frame = number(row.frame), marker = delta > 0 ? "▲" : delta < 0 ? "▼" : "·"; return <text key={`${text(row.timestamp)}-${index}`} fg={delta < 0 ? palette.red : delta > 0 ? palette.green : palette.muted}>{fitText(`${text(row.timestamp)} ${frame || "—"}/${frames || "—"} ${marker} ${Math.abs(delta) || "—"} ${frames ? `${Math.round(frame / frames * 100)}%` : "—"}`, width)}</text>; }) : <text fg={palette.dim}>{fitText("No Differential Testing log entries.", width)}</text>}</box>;
}

/** Field rows deliberately keep unavailable telemetry explicit instead of inventing a chart. */
export function TerminalHybridFieldList({ node, payload, width, height = 8, expanded = false, selectedId }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number; expanded?: boolean; selectedId?: string }) {
  const fields = list(resolveOvenPointer(payload, "/fields")).slice(0, Math.max(1, height)), telemetry = record(resolveOvenPointer(payload, "/telemetry"));
  const availability = typeof telemetry.status === "string" ? String(telemetry.status) : "absent";
  if (!fields.length) return <box width={width} height={height} overflow="hidden"><text fg={palette.dim}>{fitText(availability === "comparable" ? "No changed fields in this telemetry." : "No fields match the current view.", width)}</text></box>;
  const chosen = selectedId || text(record(fields[0]).id);
  return <box width={width} height={height} flexDirection="column" overflow="hidden">{fields.map((value) => { const field = record(value), id = text(field.id), failed = number(field.failedSampleCount) > 0, missing = number(field.missingSampleCount) > 0, blocked = text(field.trustStatus) === "blocked", selected = id === chosen; const state = missing || blocked ? "blocked" : failed ? "failed" : "pass"; const line = `${selected ? "›" : " "} ${text(field.label)} · ${state} ${number(field.failedSampleCount)}/${number(field.missingSampleCount)} · ${text(field.driftClass)}`; return <box key={id} height={selected && expanded ? 2 : 1} flexDirection="column" overflow="hidden"><text fg={missing || blocked ? palette.amber : failed ? palette.red : palette.green}>{fitText(line, width)}</text>{selected && expanded ? <text fg={palette.dim}>{fitText(`↳ ${text(record(field.semantics).meaning)} · telemetry ${availability}`, width)}</text> : null}</box>; })}</box>;
}
