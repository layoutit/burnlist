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

function selectedItem(data: Record<string, JsonValue>) {
  const active = rows(data.active).map(record), completed = rows(data.completed).map(record), selected = text(data.selectedItemId);
  return [...active, ...completed].find((item) => text(item.id) === selected) ?? active[0] ?? completed[0] ?? {};
}

function loopLabel(item: Record<string, JsonValue>, run: Record<string, JsonValue>) {
  const selector = text(run.loopId || record(item.loop).selector);
  if (selector.endsWith(":review")) return "Review Loop";
  if (selector.endsWith(":gate")) return "Gate Loop";
  if (selector.endsWith(":branch")) return "Branch Loop";
  return selector === "—" ? "Direct work" : selector;
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
  const layout = graphLines(run, active, width), assigned = loopLabel(active, run);
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <box height={1} flexDirection="row">
      <text fg={palette.foreground}>{fitText(active.id ? `${text(active.id)} · ${text(active.title)}` : "No active item", Math.max(1, width - state.length - 3))}</text>
      <text fg={state === "BLOCKED" ? palette.red : state === "ACTIVE" ? palette.green : palette.amber}>{`  ${state}`}</text>
    </box>
    <text fg={palette.muted}>{fitText(`ASSIGNED LOOP · ${assigned}`, width)}</text>
    <text fg={palette.dim}>{fitText(text(record(run.latestResult).summary || (active.id ? `Current step: ${text(run.currentNode || "ready")}` : "Burnlist complete")), width)}</text>
    {layout.lines.slice(0, Math.max(1, height - 3)).map((line, row) =>
      <text key={row} fg={layout.current && row >= layout.current.y && row <= layout.current.y + 2 ? palette.blue : palette.muted}>{fitText(line, width)}</text>)}
  </box>;
}
