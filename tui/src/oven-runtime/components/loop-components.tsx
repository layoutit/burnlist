import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";
import { layoutAsciiGraph, type AsciiGraph } from "../../../../dashboard/src/components/LoopGraph/ascii-layout";

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
const rows = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "—";
const source = (node: TerminalNode, payload?: JsonValue) => record(resolveOvenPointer(payload, node.attributes.source));

function graphModel(run: Record<string, JsonValue>, item: Record<string, JsonValue> = {}) {
  const assigned = record(item.loop), graph = record(run.graph);
  const candidate = rows(graph.nodes).length ? graph : record(assigned.graph);
  return {
    graph: candidate as unknown as AsciiGraph,
    current: text(run.currentNode || candidate.entry || ""),
  };
}

function graphLines(run: Record<string, JsonValue>, item: Record<string, JsonValue>, width: number) {
  const model = graphModel(run, item);
  if (!Array.isArray(model.graph.nodes) || !model.graph.nodes.length) return { lines: ["No Loop topology"], current: null };
  return layoutAsciiGraph(model.graph, model.current, width);
}

function graphWindow(layout: ReturnType<typeof graphLines>, rows: number) {
  if (layout.lines.length <= rows) return { lines: layout.lines, offset: 0 };
  const activeTop = layout.current?.y ?? 0;
  const offset = Math.max(0, Math.min(layout.lines.length - rows, activeTop - Math.floor((rows - 3) / 2)));
  return { lines: layout.lines.slice(offset, offset + rows), offset };
}

function selectedItem(data: Record<string, JsonValue>) {
  const active = rows(data.active).map(record), completed = rows(data.completed).map(record), selected = text(data.selectedItemId);
  return [...active, ...completed].find((item) => text(item.id) === selected) ?? active[0] ?? completed[0] ?? {};
}

export function TerminalLoopGraph({ node, payload, width, height = 3 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette(), run = source(node, payload), layout = graphLines(run, {}, width);
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <text fg={palette.muted}>{fitText(text(node.attributes.title || run.loopId || "Loop"), width)}</text>
    {layout.lines.slice(0, Math.max(1, height - 1)).map((line, row) =>
      <text key={row} fg={layout.current && row >= layout.current.y && row <= layout.current.y + 2 ? palette.blue : palette.muted}>{fitText(line, width)}</text>)}
  </box>;
}

export function TerminalLoopProgress({ node, payload, width, height = 18 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette(), data = source(node, payload), active = selectedItem(data), run = record(data.loopRun);
  const state = text(record(active.work).state || run.state || (active.id ? "PENDING" : "COMPLETED"));
  const layout = graphLines(run, active, width);
  const activeNode = text(run.currentNode || "ready");
  const rowsAvailable = Math.max(1, height - 2);
  const window = graphWindow(layout, rowsAvailable);
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <text fg={palette.blue}>{fitText(`ACTIVE: ${activeNode.toUpperCase()}`, width)}</text>
    <text fg={palette.dim}>{fitText(`MODE: ${text(record(run.execution).mode || "unavailable")} · ${state}`, width)}</text>
    {window.lines.map((line, row) => {
      const sourceRow = row + window.offset;
      const isCurrent = Boolean(layout.current && sourceRow >= layout.current.y && sourceRow <= layout.current.y + 2);
      return <text key={sourceRow} fg={isCurrent ? palette.blue : palette.muted}>{fitText(line, width)}</text>;
    })}
  </box>;
}
