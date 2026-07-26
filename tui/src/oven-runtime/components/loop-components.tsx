import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";
import { layoutAsciiGraph, type AsciiGraph } from "../../../../dashboard/src/components/LoopGraph/ascii-layout";
import type { LoopRunProjection } from "../../../../dashboard/src/lib/types";
// @ts-expect-error Production wrapper keeps the web layout implementation out of the OpenTUI JSX type graph.
import { layoutCompactLoop } from "./web-loop-layout.mjs";

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

function loopLabel(item: Record<string, JsonValue>, run: Record<string, JsonValue>) {
  const selector = text(run.loopId || record(item.loop).selector);
  if (selector.endsWith(":review")) return "Review Loop";
  if (selector.endsWith(":gate")) return "Gate Loop";
  if (selector.endsWith(":branch")) return "Branch Loop";
  return selector === "—" ? "Direct work" : selector;
}

function itemTopologyProjection(run: LoopRunProjection): LoopRunProjection {
  const exceptional = new Set(run.graph.nodes
    .filter((node) => node.kind === "terminal" && node.terminalState !== "converged")
    .map((node) => node.id));
  const nodes = run.graph.nodes.filter((node) => !exceptional.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = run.graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const hasStart = nodes.some((node) => node.id === "start");
  return {
    ...run,
    graph: {
      ...run.graph,
      entry: hasStart ? run.graph.entry ?? "start" : "start",
      nodes: hasStart ? nodes : [{ id: "start", kind: "terminal" }, ...nodes],
      edges: hasStart ? edges : [{ from: "start", on: "begin", to: run.graph.entry ?? nodes[0]?.id ?? "burn" }, ...edges],
    },
  };
}

export function compactTopology(run: Record<string, JsonValue>, item: Record<string, JsonValue>, width: number) {
  const model = graphModel(run, item);
  if (!Array.isArray(model.graph.nodes) || !model.graph.nodes.length) return null;
  const sourceRun = { ...run, graph: model.graph, currentNode: model.current } as unknown as LoopRunProjection;
  const topology = itemTopologyProjection(sourceRun);
  const symbols = {
    start: "S",
    ...Object.fromEntries(topology.graph.nodes
      .filter((node) => node.kind === "terminal" && node.terminalState === "converged")
      .map((node) => [node.id, "B"])),
  };
  const layout = layoutCompactLoop(topology, {
    availableCharacters: width,
    showLabels: true,
    symbols,
  });
  return { ...layout, currentNode: topology.currentNode };
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
  const completed = rows(data.completed).map(record).some((item) => text(item.id) === text(active.id));
  const state = text(record(active.work).state || run.state || (completed || !active.id ? "COMPLETED" : "PENDING"));
  const layout = compactTopology(run, active, width);
  const assigned = loopLabel(active, run);
  const stateColor = state === "BLOCKED" ? palette.red : state === "ACTIVE" ? palette.green : palette.amber;
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <box height={1} flexDirection="row">
      <text fg={palette.dim}>ITEM  </text>
      <text fg={palette.foreground}>{fitText(active.id ? `${text(active.id)} · ${text(active.title)}` : "No active item", Math.max(1, width - state.length - 8))}</text>
      <text fg={stateColor}>{`  ${state}`}</text>
    </box>
    <text fg={palette.muted}>{fitText(text(record(run.latestResult).summary || (active.id ? `Current step: ${text(run.currentNode || "ready")}` : "Burnlist complete")), width)}</text>
    <text fg={palette.foreground}>{fitText(`ASSIGNED LOOP  ${assigned}`, width)}</text>
    {layout ? layout.lines.slice(0, Math.max(1, height - 3)).map((line: string, row: number) => {
      const fitted = fitText(line, width);
      const current = layout.positions.get(layout.currentNode);
      if (!current || current.y !== row || current.x >= fitted.length) {
        return <text key={row} fg={palette.muted}>{fitted}</text>;
      }
      return <text key={row} fg={palette.muted}>
        {fitted.slice(0, current.x)}
        <span fg={palette.blue}>{fitted[current.x]}</span>
        {fitted.slice(current.x + 1)}
      </text>;
    })
      : <text fg={palette.muted}>This item uses direct work; no Loop is assigned.</text>}
  </box>;
}
