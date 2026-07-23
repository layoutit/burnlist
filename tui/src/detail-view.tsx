import { BrandMark } from "./brand-mark";
import { GlyphFire } from "./glyph-fire";
import { compactTime, fitText, palette, progressLabel } from "./theme";
import { useTerminalChrome } from "./terminal-chrome";
import { LoadingStar } from "./loading-star";
import type { BurnlistSummary, ProgressSnapshot } from "./types";

export function BrandHeader({ center, subtitle, compact = false, activity }: {
  center?: string | null;
  subtitle: string;
  compact?: boolean;
  activity?: { message: string; tone: "error" | "info" } | null;
}) {
  const chrome = useTerminalChrome();
  return <box height={1} flexShrink={0} flexDirection="row" alignItems="center" backgroundColor={chrome.header} paddingLeft={2} paddingRight={2}>
    <BrandMark />
    <text fg={palette.soft}>Burnlist</text>
    {center ? <><text fg={palette.dim}>  /  </text><text fg={palette.muted}>{fitText(center, 56).trimEnd()}</text></> : null}
    {!center ? <><box width={3} /><text fg={palette.dim}>{subtitle}</text></> : null}
    <box flexGrow={1} />
    {activity?.tone === "info" ? <LoadingStar label="Refreshing" /> : activity ? <text fg={palette.red}>{activity.message}</text> : center ? <text fg={palette.dim}>{subtitle}</text> : null}
  </box>;
}

function progressBar(percent: number | null, width: number): string {
  if (percent === null) return "─".repeat(width);
  const done = Math.max(0, Math.min(width, Math.round(width * percent / 100)));
  return `${"━".repeat(done)}${"─".repeat(width - done)}`;
}

export function DetailSummary({ burnlist, progress, fireWidth, fireHeight, fps, compact }: {
  burnlist: BurnlistSummary | null;
  progress: ProgressSnapshot | null;
  fireWidth: number;
  fireHeight: number;
  fps: number;
  compact: boolean;
}) {
  if (!burnlist) return <box padding={2}><text fg={palette.dim}>Choose a Burnlist</text></box>;
  const percent = progress?.percent ?? burnlist.percent;
  const done = progress?.done ?? burnlist.done;
  const total = progress?.total ?? burnlist.total;
  const goal = progress?.goal?.sections.find((section) => section.title.toLowerCase() === "goal")?.body
    ?? progress?.goal?.sections[0]?.body
    ?? "";
  const actualFireWidth = compact ? Math.min(9, fireWidth) : fireWidth;
  const actualFireHeight = compact ? Math.min(5, fireHeight) : fireHeight;
  return <box flexDirection={compact ? "row" : "column"} padding={compact ? 1 : 2} gap={compact ? 2 : 1}>
    <box width={compact ? 35 : undefined} flexGrow={compact ? 0 : 1} minWidth={0} flexDirection="column">
      <text fg={palette.dim}>{`${burnlist.repo}  /  ${burnlist.id}`}</text>
      <text fg={palette.foreground}>{compact ? fitText(burnlist.title, 34).trimEnd() : burnlist.title}</text>
      <box height={1} flexDirection="row" gap={2}>
        <text fg={burnlist.statusLabel === "Blocked" ? palette.red : burnlist.status === "active" ? palette.green : palette.muted}>{burnlist.statusLabel}</text>
        <text fg={palette.blue}>{burnlist.ovenName}</text>
      </box>
      <text fg={palette.muted}>{compact ? fitText(progressLabel(done, total, percent, burnlist.progressLabel), 34).trimEnd() : progressLabel(done, total, percent, burnlist.progressLabel)}</text>
      <text fg={percent === null ? palette.dim : palette.green}>{progressBar(percent, compact ? 18 : 28)}</text>
      {!compact && goal ? <text fg={palette.muted}>{fitText(goal, 34).trimEnd()}</text> : null}
      {!compact ? <text fg={palette.dim}>{`Updated ${compactTime(burnlist.updatedAt)}`}</text> : null}
    </box>
    <box width={actualFireWidth} height={actualFireHeight} alignItems="center" justifyContent="center">
      <GlyphFire width={actualFireWidth} height={actualFireHeight} fps={fps} />
    </box>
  </box>;
}
