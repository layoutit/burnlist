import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
const rows = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "—";
const raw = (node: TerminalNode, payload?: JsonValue) => record(resolveOvenPointer(payload, node.attributes.source));
const completed = (data: Record<string, JsonValue>) => rows(data.completed);

export function TerminalChecklistLedger({ node, payload, width, height = 5 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const data = raw(node, payload), all = completed(data), entries = all.slice(-Math.max(1, height - 1)).reverse(), total = Math.max(1, Number(data.total) || all.length);
  return <box width={width} height={height} flexDirection="column" overflow="hidden"><text fg={palette.dim}>{fitText("AGE  EVENT  RESULT  DONE", width)}</text>{entries.length ? entries.map((entry, index) => { const item = record(entry), age = Math.max(0, Math.round((Date.parse(text(data.generatedAt)) - Date.parse(text(item.completedAt))) / 60000)), ordinal = all.length - index; return <text key={`${text(item.id)}-${index}`} fg={palette.green}>{fitText(`${age}m ${text(item.id)} Done ${Math.round(ordinal / total * 100)}%`, width)}</text>; }) : <text fg={palette.dim}>No completed events</text>}</box>;
}

export function TerminalChecklistBurnPanel({ node, payload, width, height = 3 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const data = raw(node, payload), total = Number(data.total) || 0, done = Number(data.done) || 0, percent = Number(data.percent) || 0;
  return <box width={width} height={height} flexDirection="column" overflow="hidden"><text>{fitText(`Completion ${done}/${total} (${percent}%)`, width)}</text><text fg={palette.green}>{fitText(`${"●".repeat(Math.round(Math.max(0, Math.min(100, percent)) / 100 * Math.max(1, width - 4)))} ${percent}%`, width)}</text></box>;
}

export function TerminalChecklistEventCards({ node, payload, width, height = 5, expanded = false }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number; expanded?: boolean }) {
  const palette = useTerminalPalette();
  const entries = completed(raw(node, payload)).slice(-Math.max(1, expanded ? height - 1 : height));
  return <box width={width} height={height} flexDirection="column" overflow="hidden">{entries.length ? entries.map((entry, index) => { const item = record(entry), detail = text(item.detail); return <box key={`${text(item.id)}-${index}`} height={expanded && index === entries.length - 1 ? 2 : 1} flexDirection="column" overflow="hidden"><text fg={index === entries.length - 1 ? palette.foreground : palette.muted}>{fitText(`${index === entries.length - 1 ? "› " : "  "}${text(item.id)} · ${text(item.title)} · done`, width)}</text>{expanded && index === entries.length - 1 ? <text fg={palette.dim}>{fitText(detail.includes("Outcome:") ? detail : `Outcome: ${detail}`, width)}</text> : null}</box>; }) : <text fg={palette.dim}>No completed events yet.</text>}</box>;
}
