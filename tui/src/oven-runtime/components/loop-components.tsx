import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
const rows = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "—";
const source = (node: TerminalNode, payload?: JsonValue) => record(resolveOvenPointer(payload, node.attributes.source));

function graphLine(run: Record<string, JsonValue>, width: number) {
  const graph = record(run.graph), nodes = rows(graph.nodes).map(record), current = text(run.currentNode);
  const symbols = nodes.map((node) => {
    const id = text(node.id), kind = text(node.kind);
    const symbol = id === "start" ? "S" : kind === "terminal" ? "B" : kind === "check" ? "C" : kind === "gate" ? "G" : "A";
    return id === current ? `[${symbol}]` : symbol;
  });
  return fitText(symbols.length ? symbols.join(" ─ ") : "No Loop topology", width);
}

export function TerminalLoopGraph({ node, payload, width, height = 3 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette(), run = source(node, payload);
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <text fg={palette.muted}>{fitText(text(node.attributes.title || run.loopId || "Loop"), width)}</text>
    <text fg={palette.blue}>{graphLine(run, width)}</text>
  </box>;
}

export function TerminalLoopProgress({ node, payload, width, height = 6 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette(), data = source(node, payload), active = record(rows(data.active)[0]), run = record(data.loopRun);
  const state = text(record(active.work).state || run.state || (active.id ? "PENDING" : "COMPLETED"));
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <text fg={palette.foreground}>{fitText(active.id ? `${text(active.id)} · ${text(active.title)}` : "No active item", width)}</text>
    <text fg={state === "BLOCKED" ? palette.red : state === "ACTIVE" ? palette.green : palette.amber}>{fitText(`${state} · ${text(run.currentNode || "ready")}`, width)}</text>
    <text fg={palette.blue}>{graphLine(run, width)}</text>
    <text fg={palette.dim}>{fitText(text(record(run.latestResult).summary || "Awaiting canonical Loop activity"), width)}</text>
  </box>;
}
