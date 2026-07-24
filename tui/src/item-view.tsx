import { compactTime, fitText } from "./theme";
import { useTerminalPalette, type TerminalPalette } from "./terminal-accessibility";
import type { DetailItem } from "./types";

function ChecklistItem({ item, width, palette }: { item: DetailItem; width: number; palette: TerminalPalette }) {
  const fields = Object.entries(item.fields ?? {});
  return <box flexGrow={1} flexDirection="column" padding={1} gap={1}>
    <box height={2} flexDirection="row" alignItems="center">
      <box width={14}><text fg={item.kind === "active" ? palette.green : palette.blue}>{fitText(item.status, 14).trimEnd()}</text></box>
      <box flexGrow={1}><text fg={palette.foreground}>{fitText(item.id, Math.max(1, width - 8)).trimEnd()}</text></box>
      {item.latest ? <text fg={palette.amber}>LATEST</text> : null}
    </box>
    <text fg={palette.foreground}>{fitText(item.title, Math.max(1, width - 8)).trimEnd()}</text>
    {item.completedAt ? <text fg={palette.dim}>{fitText(`Completed ${compactTime(item.completedAt)} · ${item.completedAt}`, Math.max(1, width - 8)).trimEnd()}</text> : null}
    {fields.length ? <box paddingTop={1}><text fg={palette.dim}>ITEM FIELDS</text></box> : null}
    {fields.map(([label, value]) => <box key={label} flexDirection="column" paddingBottom={1}>
      <text fg={palette.blue}>{fitText(label.toUpperCase(), Math.max(1, width - 8)).trimEnd()}</text>
      <text fg={palette.muted}>{fitText(value, Math.max(24, width - 8)).trimEnd()}</text>
    </box>)}
    {item.detail ? <box flexDirection="column" paddingTop={1}>
      <text fg={palette.dim}>COMPLETION DETAIL</text>
      {item.detail.split(/\r?\n/u).filter(Boolean).slice(0, 8).map((line, index) => <text key={index} fg={palette.muted}>{fitText(line, Math.max(24, width - 8)).trimEnd()}</text>)}
    </box> : null}
    {!fields.length && !item.detail ? <text fg={palette.dim}>No additional item detail was recorded.</text> : null}
  </box>;
}

export function ItemDetail({ item, width }: {
  item: DetailItem | null;
  width: number;
}) {
  const palette = useTerminalPalette();
  if (!item) return <box padding={2}><text fg={palette.dim}>No item is selected.</text></box>;
  return <ChecklistItem item={item} width={width} palette={palette} />;
}
