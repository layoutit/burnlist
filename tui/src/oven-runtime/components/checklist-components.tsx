import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import "../../glyph-surface";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";
import { terminalKpiFrame } from "./kpi-frame";
import { terminalTableFrame, type TerminalListModel } from "./list-components";
import { progressGlyphFrame } from "./progress-glyph";

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
const rows = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "—";
const raw = (node: TerminalNode, payload?: JsonValue) => record(resolveOvenPointer(payload, node.attributes.source));
const completed = (data: Record<string, JsonValue>) => rows(data.completed);

export function TerminalChecklistWorkspace({ node, payload, width, height = 8 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const data = raw(node, payload), active = rows(data.active), done = completed(data), selected = text(data.selectedItemId);
  const entries = [...active.map((item) => ({ item: record(item), state: "ACTIVE" })), ...done.map((item) => ({ item: record(item), state: "DONE" }))];
  const model: TerminalListModel = {
    width,
    height,
    columns: [
      { id: "state", label: "STATE", minWidth: 7 },
      { id: "id", label: "ID", minWidth: 4 },
      { id: "item", label: "ITEM", minWidth: 12 },
    ],
    rows: entries.map(({ item, state }, index) => ({
      id: `${text(item.id)}-${index}`,
      cells: { state, id: text(item.id), item: text(item.title) },
      current: selected === text(item.id) || selected === "—" && index === 0,
      tone: state === "DONE" ? "good" : "warn",
    })),
    emptyText: "No items",
  };
  const frame = terminalTableFrame(model, palette);
  return <glyphSurface frame={frame} width={frame.cols} height={frame.rows} />;
}

export function TerminalChecklistCurrent({ node, payload, width, height = 3 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const data = raw(node, payload), item = record(rows(data.active)[0]), loop = record(item.loop), run = record(data.loopRun);
  const label = item.id ? `${text(item.id)} · ${text(item.title)}` : "No active item";
  const detail = item.id ? `Loop · ${text(loop.selector)} · ${text(run.currentNode || "ready")}` : "No assigned work";
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <text fg={palette.foreground}>{fitText(label, width)}</text>
    <text fg={palette.muted}>{fitText(detail, width)}</text>
  </box>;
}

export function TerminalChecklistLedger({ node, payload, width, height = 5 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const data = raw(node, payload), all = completed(data), entries = all.slice(-Math.max(1, height - 1)).reverse(), total = Math.max(1, Number(data.total) || all.length);
  const model: TerminalListModel = {
    width,
    height,
    columns: [
      { id: "age", label: "AGE", minWidth: 5 },
      { id: "event", label: "EVENT", minWidth: 8 },
      { id: "result", label: "RESULT", minWidth: 7 },
      { id: "done", label: "DONE", minWidth: 5 },
    ],
    rows: entries.map((entry, index) => {
      const item = record(entry), age = Math.max(0, Math.round((Date.parse(text(data.generatedAt)) - Date.parse(text(item.completedAt))) / 60000)), ordinal = all.length - index;
      return { id: `${text(item.id)}-${index}`, cells: { age: `${age}m`, event: text(item.id), result: "Done", done: `${Math.round(ordinal / total * 100)}%` }, tone: "good" };
    }),
    emptyText: "No completed events",
  };
  const frame = terminalTableFrame(model, palette);
  return <glyphSurface frame={frame} width={frame.cols} height={frame.rows} />;
}

export function TerminalChecklistBurnPanel({ node, payload, width, height = 3 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const data = raw(node, payload), total = Number(data.total) || 0, done = Number(data.done) || 0, percent = Number(data.percent) || 0;
  const frame = terminalKpiFrame({
    items: [{ heading: "Completion", value: `${done}/${total} (${percent}%)`, frame: progressGlyphFrame("progress-donut", percent, 4, palette, 2), tone: "good" }],
  }, width, height, palette);
  return <glyphSurface frame={frame} width={frame.cols} height={frame.rows} />;
}

export function TerminalChecklistEventCards({ node, payload, width, height = 5, expanded = false }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number; expanded?: boolean }) {
  const palette = useTerminalPalette();
  const entries = completed(raw(node, payload)).slice(-Math.max(1, expanded ? height - 1 : height));
  return <box width={width} height={height} flexDirection="column" overflow="hidden">{entries.length ? entries.map((entry, index) => { const item = record(entry), detail = text(item.detail); return <box key={`${text(item.id)}-${index}`} height={expanded && index === entries.length - 1 ? 2 : 1} flexDirection="column" overflow="hidden"><text fg={index === entries.length - 1 ? palette.foreground : palette.muted}>{fitText(`${index === entries.length - 1 ? "› " : "  "}${text(item.id)} · ${text(item.title)} · done`, width)}</text>{expanded && index === entries.length - 1 ? <text fg={palette.dim}>{fitText(detail.includes("Outcome:") ? detail : `Outcome: ${detail}`, width)}</text> : null}</box>; }) : <text fg={palette.dim}>No completed events yet.</text>}</box>;
}
