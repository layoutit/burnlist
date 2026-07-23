import type { ReactNode } from "react";
import { fitText, palette } from "./theme";
import { useTerminalChrome } from "./terminal-chrome";

export function TableCell({ children, width, grow = 0, color = palette.muted }: {
  children: string;
  width?: number;
  grow?: number;
  color?: string;
}) {
  return <box width={width} flexGrow={grow} flexShrink={width ? 0 : 1} paddingLeft={1}>
    <text fg={color}>{fitText(children, width ? width - 1 : Math.max(1, children.length))}</text>
  </box>;
}

export function TableLine({ children, selected = false, header = false }: {
  children: ReactNode;
  selected?: boolean;
  header?: boolean;
}) {
  const chrome = useTerminalChrome();
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

export function TableGroup({ name, count, noun }: { name: string; count: number; noun: string }) {
  const chrome = useTerminalChrome();
  return <box height={1} paddingLeft={3} backgroundColor={chrome.background} flexDirection="row">
    <text fg={palette.blue}>{name}</text>
    <text fg={palette.dim}>{`  ·  ${count} ${noun}${count === 1 ? "" : "s"}`}</text>
  </box>;
}
