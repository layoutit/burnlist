import { fitText, palette } from "./theme";
import { useTerminalChrome } from "./terminal-chrome";
import type { OvenPackageDetail, OvenSummary } from "./types";

function prose(markdown: string): string[] {
  return markdown.split(/\r?\n/u)
    .map((line) => line.trim().replace(/^#{1,6}\s+/u, "").replace(/^[-*]\s+/u, "• "))
    .filter((line) => line && !line.startsWith("```") && !line.startsWith("Input mode:") && line !== "Data Shape")
    .slice(1);
}

export function CatalogOvenDetail({ summary, detail, height }: {
  summary: OvenSummary | null;
  detail: OvenPackageDetail | null;
  height: number;
}) {
  const chrome = useTerminalChrome();
  const oven = detail ?? summary;
  if (!oven) return <box padding={2}><text fg={palette.dim}>Choose an Oven from the catalog.</text></box>;
  const components = detail?.ir.requirements?.components ?? detail?.ir.root.map((node) => node.kind) ?? [];
  const paragraphs = detail ? prose(detail.instructions).slice(0, Math.max(2, height - 14)) : [];
  return <box flexGrow={1} flexDirection="column" paddingLeft={3} paddingRight={3} paddingTop={2} gap={1}>
    <box height={3} flexDirection="row" alignItems="center" border={["bottom"]} borderColor={chrome.line}>
      <box flexGrow={1} flexDirection="column">
        <text fg={palette.foreground}>{oven.name}</text>
        <text fg={palette.dim}>{oven.id}</text>
      </box>
      <text fg={palette.green}>GENERIC</text>
    </box>
    <text fg={palette.soft}>{oven.description}</text>
    <box height={4} flexDirection="row" alignItems="center" border={["bottom"]} borderColor={chrome.faintLine}>
      <box flexGrow={1}><text fg={palette.dim}>CONTRACT</text><text fg={palette.blue}>{oven.contract}</text></box>
      <box width={18}><text fg={palette.dim}>VERSION</text><text fg={palette.soft}>{oven.version}</text></box>
      <box width={22}><text fg={palette.dim}>INPUT</text><text fg={palette.soft}>{oven.dataInput}</text></box>
    </box>
    <box height={3} flexDirection="column">
      <text fg={palette.dim}>DECLARED VIEW</text>
      <text fg={palette.muted}>{components.length ? fitText(components.join("  →  "), 100).trimEnd() : "No declared components"}</text>
    </box>
    {detail ? <box height={2} flexDirection="column">
      <text fg={palette.dim}>REVISION</text>
      <text fg={palette.muted}>{detail.ovenRevision}</text>
    </box> : null}
    <box paddingTop={1}><text fg={palette.foreground}>Instructions</text></box>
    {paragraphs.length ? paragraphs.map((line, index) => <text key={index} fg={palette.muted}>{fitText(line, 104).trimEnd()}</text>) : <text fg={palette.dim}>Loading Oven package…</text>}
  </box>;
}
