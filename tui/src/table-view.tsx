import type { ReactNode } from "react";
import { fitText } from "./theme";
import { sanitizeTerminalText } from "./terminal-text";
import { useTerminalPalette } from "./terminal-accessibility";
import { useTerminalChrome } from "./terminal-chrome";

export function TableCell({ children, width, grow = 0, color }: {
  children: string;
  width?: number;
  grow?: number;
  color?: string;
}) {
  const palette = useTerminalPalette();
  return <box width={width} flexGrow={grow} flexShrink={width ? 0 : 1} paddingLeft={1}>
    <text fg={color ?? palette.muted}>{fitText(children, width ? width - 1 : Math.max(1, children.length))}</text>
  </box>;
}

export function TableLine({ children, selected = false, header = false }: {
  children: ReactNode;
  selected?: boolean;
  header?: boolean;
}) {
  const chrome = useTerminalChrome();
  const palette = useTerminalPalette();
  return <box
    height={1}
    flexDirection="row"
    paddingLeft={1}
    backgroundColor={header ? chrome.header : selected ? chrome.surface : chrome.background}
  >
    <box width={1}><text fg={selected ? palette.blue : "transparent"}>{selected ? "▎" : " "}</text></box>
    {children}
  </box>;
}

export function TableGroup({ name, count, noun, width }: { name: string; count: number; noun: string; width: number }) {
  const chrome = useTerminalChrome();
  const palette = useTerminalPalette();
  const suffix = `  ·  ${count} ${noun}${count === 1 ? "" : "s"}`;
  return <box height={1} paddingLeft={3} backgroundColor={chrome.background} flexDirection="row">
    <text fg={palette.blue}>{fitText(sanitizeTerminalText(name), Math.max(1, width - 3 - suffix.length)).trimEnd()}</text>
    <text fg={palette.dim}>{suffix}</text>
  </box>;
}
