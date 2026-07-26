import { createTextAttributes } from "@opentui/core";
import { fitText, visibleWindow } from "./theme";
import { useTerminalPalette } from "./terminal-accessibility";
import { useTerminalChrome } from "./terminal-chrome";
import type { DetailItem } from "./types";

export function DetailItemList({ items, selected, width, height }: {
  items: DetailItem[];
  selected: number;
  width: number;
  height: number;
}) {
  const palette = useTerminalPalette();
  const chrome = useTerminalChrome();
  const bodyRows = Math.max(1, height - 3);
  const window = visibleWindow(items, selected, bodyRows);
  const longestId = items.reduce((longest, item) => Math.max(longest, (item.id || "—").length), 2);
  const idWidth = Math.max(3, Math.min(8, longestId));
  const stateWidth = width >= 40 ? 7 : 2;
  const titleWidth = Math.max(1, width - stateWidth - idWidth - 5);

  return <box width={width} height={height} flexDirection="column" overflow="hidden">
    <box height={1} paddingLeft={2} paddingRight={2} flexDirection="row">
      <text fg={palette.foreground} attributes={createTextAttributes({ bold: true })}>ITEMS</text>
      <text fg={palette.dim}>{` · ${items.length}`}</text>
      <text fg={palette.dim}>{` ${"-".repeat(Math.max(1, width - 12 - String(items.length).length))}`}</text>
    </box>
    <box height={1} paddingLeft={2} flexDirection="row">
      <text fg={palette.dim}>{fitText("STATE", stateWidth)}</text>
      <text fg={palette.dim}> </text>
      <text fg={palette.dim}>{fitText("ID", idWidth)}</text>
      <text fg={palette.dim}> </text>
      <text fg={palette.dim}>{fitText("ITEM", titleWidth)}</text>
    </box>
    {window.items.map((item, offset) => {
      const absolute = window.start + offset;
      const active = absolute === selected;
      const state = width >= 40 ? item.status : item.kind === "active" ? "●" : "✓";
      return <box
        key={item.key}
        height={1}
        paddingLeft={1}
        flexDirection="row"
        overflow="hidden"
        backgroundColor={active ? chrome.selected : undefined}
      >
        <text fg={active ? palette.foreground : item.kind === "active" ? palette.green : palette.muted}>{active ? ">" : " "}</text>
        <text fg={item.kind === "active" ? palette.green : palette.blue} attributes={active ? createTextAttributes({ bold: true, underline: true }) : undefined}>{fitText(state, stateWidth)}</text>
        <text> </text>
        <text fg={palette.muted} attributes={active ? createTextAttributes({ bold: true, underline: true }) : undefined}>{fitText(item.id || "—", idWidth)}</text>
        <text> </text>
        <text fg={active ? palette.foreground : palette.muted} attributes={active ? createTextAttributes({ bold: true, underline: true }) : undefined}>{fitText(`${item.latest ? "LATEST · " : ""}${item.title}`, titleWidth)}</text>
      </box>;
    })}
    {!items.length ? <box paddingLeft={2}><text fg={palette.dim}>No checklist items.</text></box> : null}
    <box height={1} paddingLeft={2}>
      <text fg={palette.dim}>{items.length ? `${Math.min(selected + 1, items.length)} / ${items.length}` : "0 items"}</text>
    </box>
  </box>;
}
