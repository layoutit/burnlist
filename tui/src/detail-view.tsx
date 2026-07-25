import { BrandMark } from "./brand-mark";
import { compactTime, fitText, progressLabel } from "./theme";
import { useTerminalLoadingGlyph } from "./loading-cadence";
import { useTerminalPalette } from "./terminal-accessibility";
import { useTerminalChrome } from "./terminal-chrome";
import { useCoalescedTerminalDimensions } from "./use-coalesced-terminal-dimensions";
import type { BurnlistSummary, ProgressSnapshot } from "./types";

export function BrandHeader({ center, subtitle, compact = false, activity }: {
  center?: string | null;
  subtitle: string;
  compact?: boolean;
  activity?: { message: string; tone: "error" | "info" } | null;
}) {
  const palette = useTerminalPalette();
  const chrome = useTerminalChrome();
  const { width } = useCoalescedTerminalDimensions();
  const loadingGlyph = useTerminalLoadingGlyph(activity?.tone === "info");
  const right = activity?.tone === "info" ? `${loadingGlyph} Refreshing` : activity?.message ?? (center ? subtitle : "");
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

export function DetailSummary({ burnlist, progress, compact, width }: {
  burnlist: BurnlistSummary | null;
  progress: ProgressSnapshot | null;
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
  const textWidth = Math.max(8, width - 4);
  return <box flexDirection="column" paddingLeft={2} paddingRight={2} overflow="hidden">
    <box width={compact ? textWidth : undefined} flexGrow={compact ? 0 : 1} flexShrink={0} minWidth={0} flexDirection="column" overflow="hidden">
      <text fg={palette.dim}>{fitText(`${burnlist.repo}  /  ${burnlist.id}`, textWidth).trimEnd()}</text>
      <text fg={palette.foreground}>{fitText(burnlist.title, textWidth).trimEnd()}</text>
      <text fg={burnlist.statusLabel === "Blocked" ? palette.red : burnlist.status === "active" ? palette.green : palette.muted}>{fitText(`${burnlist.statusLabel}  ${burnlist.ovenName}`, textWidth).trimEnd()}</text>
      <text fg={palette.muted}>{fitText(progressLabel(done, total, percent, burnlist.progressLabel), textWidth).trimEnd()}</text>
      <text fg={percent === null ? palette.dim : palette.green}>{progressBar(percent, Math.max(1, Math.min(textWidth, compact ? 18 : 28)))}</text>
      {!compact && goal ? <text fg={palette.muted}>{fitText(goal, 34).trimEnd()}</text> : null}
      {!compact ? <text fg={palette.dim}>{`Updated ${compactTime(burnlist.updatedAt)}`}</text> : null}
    </box>
  </box>;
}
