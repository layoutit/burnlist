import type { JsonValue, TerminalNode } from "../terminal-contract";
import { evaluateOvenBinding } from "../value-runtime";
import { fitTerminalText } from "../../terminal-text";
import { useTerminalPalette } from "../../terminal-accessibility";

const value = (node: TerminalNode, key: string, payload?: JsonValue) => {
  const binding = node.bindings[key];
  return binding ? evaluateOvenBinding(binding, payload) : node.attributes[key];
};

/** Text-native media surface used by declarative ascii-block Oven nodes. */
export function TerminalAsciiBlock({ node, payload, width, height = 1 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const label = String(value(node, "label", payload) ?? "");
  const text = String(value(node, "text", payload) ?? "");
  const lines = text.split("\n").slice(0, Math.max(0, height - (label ? 1 : 0)));
  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    {label ? <text fg={palette.muted}>{fitTerminalText(label, width)}</text> : null}
    {lines.map((line, index) => <text key={index}>{fitTerminalText(line, width)}</text>)}
  </box>;
}
