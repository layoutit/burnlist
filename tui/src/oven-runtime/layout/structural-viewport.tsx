import type { TerminalNode } from "../terminal-contract";
import { layoutTerminalNodes, type LayoutCell } from "./layout-runtime";
import { fitTerminalText } from "../../terminal-text";
import { useTerminalPalette } from "../../terminal-accessibility";

export type StructuralViewportProps = Readonly<{ nodes: readonly TerminalNode[]; viewport: Readonly<{ width: number; height: number }>; focusedPath?: string; footer?: string }>;
const structural = new Set(["box", "grid", "stack", "panel"]);
const owned = new Set([...structural, "text", "icon"]);
function Cell({ cell }: { cell: LayoutCell }) {
  if (!owned.has(cell.kind)) return null;
  const text = cell.collapsed && cell.text ? `↳ ${cell.text}` : cell.text ?? "";
  // A structural border may only occupy a cell outside every leaf paint rect.
  // This compact viewport has no independently reserved border track, so it
  // deliberately leaves structural chrome unbordered rather than letting an
  // inherited box glyph overwrite ordinary text spaces.
  if (structural.has(cell.kind)) return <box position="absolute" left={cell.rect.x} top={cell.rect.y} width={cell.rect.width} height={cell.rect.height} overflow="hidden"><text>{fitTerminalText(text, cell.rect.width)}</text></box>;
  return <box position="absolute" left={cell.rect.x} top={cell.rect.y} width={cell.rect.width} height={cell.rect.height} overflow="hidden"><text>{fitTerminalText(text, cell.rect.width)}</text></box>;
}
/** Production OpenTUI surface for structural Oven IR; B17 mounts it in Oven chrome. */
export function StructuralOvenViewport({ nodes, viewport, focusedPath, footer = "q:back  esc:exit" }: StructuralViewportProps) {
  const palette = useTerminalPalette();
  const footerHeight = 2, bodyHeight = Math.max(1, viewport.height - footerHeight), result = layoutTerminalNodes(nodes, viewport, focusedPath, footerHeight);
  return <box width={viewport.width} height={viewport.height} position="relative" overflow="hidden">
    {result.cells.map((cell) => <Cell key={cell.path} cell={cell} />)}
    <box position="absolute" left={0} top={bodyHeight} width={viewport.width} height={footerHeight} overflow="hidden" border={["top"]} borderColor={palette.dim}><text>{fitTerminalText(footer, viewport.width)}</text></box>
  </box>;
}
