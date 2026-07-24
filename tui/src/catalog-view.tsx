import { fitText } from "./theme";
import { useTerminalPalette } from "./terminal-accessibility";
import { useTerminalChrome } from "./terminal-chrome";
import type { OvenPackageDetail, OvenSummary } from "./types";

function prose(markdown: string): string[] {
  return markdown.split(/\r?\n/u)
    .map((line) => line.trim().replace(/^#{1,6}\s+/u, "").replace(/^[-*]\s+/u, "• "))
    .filter((line) => line && !line.startsWith("```") && !line.startsWith("Input mode:") && line !== "Data Shape")
    .slice(1);
}

export function CatalogOvenDetail({ summary, detail, height, width }: {
  summary: OvenSummary | null;
  detail: OvenPackageDetail | null;
  height: number;
  width: number;
}) {
  const palette = useTerminalPalette();
  const chrome = useTerminalChrome();
  const oven = detail ?? summary;
  if (!oven) return <box padding={2}><text fg={palette.dim}>Choose an Oven from the catalog.</text></box>;
  const components = detail?.ir.requirements?.components ?? detail?.ir.root.map((node) => node.kind) ?? [];
  const paragraphs = detail ? prose(detail.instructions).slice(0, Math.max(2, height - 14)) : [];
  const contentWidth = Math.max(1, width - 6);
  const versionWidth = contentWidth >= 64 ? 18 : contentWidth >= 38 ? 12 : 0;
  const inputWidth = contentWidth >= 64 ? 22 : 0;
  const contractWidth = Math.max(1, contentWidth - versionWidth - inputWidth);
  return <box flexGrow={1} flexDirection="column" paddingLeft={3} paddingRight={3} paddingTop={2} gap={1}>
    <box height={3} flexDirection="row" alignItems="center" border={["bottom"]} borderColor={chrome.line}>
      <box flexGrow={1} flexDirection="column">
        <text fg={palette.foreground}>{fitText(oven.name, Math.max(1, contentWidth - 8)).trimEnd()}</text>
        <text fg={palette.dim}>{fitText(oven.id, Math.max(1, contentWidth - 8)).trimEnd()}</text>
      </box>
      <text fg={palette.green}>GENERIC</text>
    </box>
    <text fg={palette.soft}>{fitText(oven.description, contentWidth).trimEnd()}</text>
    <box height={4} flexDirection="row" alignItems="center" border={["bottom"]} borderColor={chrome.faintLine}>
      <box width={contractWidth} flexShrink={0}><text fg={palette.dim}>CONTRACT</text><text fg={palette.blue}>{fitText(oven.contract, contractWidth).trimEnd()}</text></box>
      {versionWidth ? <box width={versionWidth}><text fg={palette.dim}>VERSION</text><text fg={palette.soft}>{fitText(oven.version, versionWidth).trimEnd()}</text></box> : null}
      {inputWidth ? <box width={inputWidth}><text fg={palette.dim}>INPUT</text><text fg={palette.soft}>{fitText(oven.dataInput, inputWidth).trimEnd()}</text></box> : null}
    </box>
    <box height={3} flexDirection="column">
      <text fg={palette.dim}>DECLARED VIEW</text>
      <text fg={palette.muted}>{components.length ? fitText(components.join("  →  "), contentWidth).trimEnd() : "No declared components"}</text>
    </box>
    {detail ? <box height={2} flexDirection="column">
      <text fg={palette.dim}>REVISION</text>
      <text fg={palette.muted}>{fitText(detail.ovenRevision, contentWidth).trimEnd()}</text>
    </box> : null}
    <box paddingTop={1}><text fg={palette.foreground}>Instructions</text></box>
    {paragraphs.length ? paragraphs.map((line, index) => <text key={index} fg={palette.muted}>{fitText(line, contentWidth).trimEnd()}</text>) : <text fg={palette.dim}>Loading Oven package…</text>}
  </box>;
}
