import { BrandMark } from "./brand-mark";
import { GlyphFire } from "./glyph-fire";
import { useTerminalDimensions } from "@opentui/react";
import { compactTime, fitText, progressLabel } from "./theme";
import { useTerminalPalette } from "./terminal-accessibility";
import { useTerminalChrome } from "./terminal-chrome";
import type { BurnlistSummary, ProgressSnapshot } from "./types";

export function BrandHeader({ center, subtitle, compact = false, activity }: {
  center?: string | null;
  subtitle: string;
  compact?: boolean;
  activity?: { message: string; tone: "error" | "info" } | null;
}) {
  const palette = useTerminalPalette();
  const chrome = useTerminalChrome();
  const { width } = useTerminalDimensions();
  const right = activity?.tone === "info" ? "✦ Refreshing" : activity?.message ?? (center ? subtitle : "");
  const innerWidth = Math.max(0, width - 4);
  const leftWidth = Math.min(12, innerWidth);
  const rightWidth = right && width >= 42 ? Math.min(24, Math.max(10, Math.floor(width * 0.22))) : 0;
  const centerWidth = Math.max(0, innerWidth - leftWidth - rightWidth);
  return <box height={1} flexShrink={0} flexDirection="row" alignItems="center" backgroundColor={chrome.header} paddingLeft={2} paddingRight={2}>
    <box width={leftWidth} flexShrink={0} flexDirection="row"><BrandMark /><text fg={palette.soft}>{fitText("Burnlist", Math.max(0, leftWidth - 3))}</text></box>
    {centerWidth ? <box width={centerWidth} flexShrink={0}><text fg={palette.muted}>{fitText(center ?? subtitle, centerWidth)}</text></box> : null}
    {rightWidth ? <box width={rightWidth} flexShrink={0} justifyContent="flex-end">
      <text fg={activity?.tone === "error" ? palette.red : palette.dim}>{fitText(right, rightWidth).trimStart()}</text>
    </box> : null}
  </box>;
}

function progressBar(percent: number | null, width: number): string {
  if (percent === null) return "─".repeat(width);
  const done = Math.max(0, Math.min(width, Math.round(width * percent / 100)));
  return `${"━".repeat(done)}${"─".repeat(width - done)}`;
}

export function DetailSummary({ burnlist, progress, fireWidth, fireHeight, fps, compact, width }: {
  burnlist: BurnlistSummary | null;
  progress: ProgressSnapshot | null;
  fireWidth: number;
  fireHeight: number;
  fps: number;
  compact: boolean;
  width: number;
}) {
  const palette = useTerminalPalette();
  if (!burnlist) return <box padding={2}><text fg={palette.dim}>Choose a Burnlist</text></box>;
  const percent = progress?.percent ?? burnlist.percent;
  const done = progress?.done ?? burnlist.done;
  const total = progress?.total ?? burnlist.total;
  const goal = progress?.goal?.sections.find((section) => section.title.toLowerCase() === "goal")?.body
    ?? progress?.goal?.sections[0]?.body
    ?? "";
  const showFire = !compact || width >= 44;
  const actualFireWidth = showFire ? compact ? Math.min(9, fireWidth) : fireWidth : 0;
  const actualFireHeight = compact ? Math.min(5, fireHeight) : fireHeight;
  const textWidth = compact ? Math.max(8, width - actualFireWidth - (showFire ? 4 : 2)) : width - 4;
  return <box flexDirection={compact ? "row" : "column"} paddingLeft={compact ? 2 : 2} paddingRight={compact ? 1 : 2} gap={showFire ? 1 : 0} overflow="hidden">
    <box width={compact ? textWidth : undefined} flexGrow={compact ? 0 : 1} flexShrink={0} minWidth={0} flexDirection="column" overflow="hidden">
      <text fg={palette.dim}>{fitText(`${burnlist.repo}  /  ${burnlist.id}`, textWidth).trimEnd()}</text>
      <text fg={palette.foreground}>{fitText(burnlist.title, textWidth).trimEnd()}</text>
      <text fg={burnlist.statusLabel === "Blocked" ? palette.red : burnlist.status === "active" ? palette.green : palette.muted}>{fitText(`${burnlist.statusLabel}  ${burnlist.ovenName}`, textWidth).trimEnd()}</text>
      <text fg={palette.muted}>{fitText(progressLabel(done, total, percent, burnlist.progressLabel), textWidth).trimEnd()}</text>
      <text fg={percent === null ? palette.dim : palette.green}>{progressBar(percent, Math.max(1, Math.min(textWidth, compact ? 18 : 28)))}</text>
      {!compact && goal ? <text fg={palette.muted}>{fitText(goal, 34).trimEnd()}</text> : null}
      {!compact ? <text fg={palette.dim}>{`Updated ${compactTime(burnlist.updatedAt)}`}</text> : null}
    </box>
    {showFire ? <box width={actualFireWidth} height={actualFireHeight} flexShrink={0} alignItems="center" justifyContent="center" overflow="hidden">
      <GlyphFire width={actualFireWidth} height={actualFireHeight} fps={fps} />
    </box> : null}
  </box>;
}
