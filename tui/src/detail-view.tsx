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
  if (compact) {
    return <box height={1} flexDirection="row" alignItems="center" backgroundColor={chrome.header} paddingLeft={2} paddingRight={2}>
      <BrandMark />
      <text fg={palette.soft}>Burnlist</text>
      <box width={3} />
      <text fg={palette.dim}>{subtitle}</text>
      <box flexGrow={1} />
      {activity?.tone === "info" ? <LoadingStar label="Refreshing" /> : activity ? <text fg={palette.red}>{activity.message}</text> : null}
    </box>;
  }
  return <box height={3} flexDirection="row" alignItems="center" backgroundColor={chrome.header} paddingLeft={2} paddingRight={2}>
    <BrandMark />
    <box width={12} paddingLeft={1}><text fg={palette.soft}>Burnlist</text></box>
    <box flexGrow={1} alignItems="center"><text fg={palette.muted}>{center ? fitText(center, 48).trimEnd() : ""}</text></box>
    {activity?.tone === "info" ? <LoadingStar label="Refreshing" /> : <text fg={activity?.tone === "error" ? palette.red : palette.dim}>{activity?.message ?? subtitle}</text>}
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
    <box flexGrow={1} flexDirection="column">
      <text fg={palette.dim}>{`${burnlist.repo}  /  ${burnlist.id}`}</text>
      <text fg={palette.foreground}>{burnlist.title}</text>
      <box height={1} flexDirection="row" gap={2}>
        <text fg={burnlist.statusLabel === "Blocked" ? palette.red : burnlist.status === "active" ? palette.green : palette.muted}>{burnlist.statusLabel}</text>
        <text fg={palette.blue}>{burnlist.ovenName}</text>
      </box>
      <text fg={palette.muted}>{progressLabel(done, total, percent, burnlist.progressLabel)}</text>
      <text fg={percent === null ? palette.dim : palette.green}>{progressBar(percent, compact ? 18 : 28)}</text>
      {!compact && goal ? <text fg={palette.muted}>{fitText(goal, 34).trimEnd()}</text> : null}
      {!compact ? <text fg={palette.dim}>{`Updated ${compactTime(burnlist.updatedAt)}`}</text> : null}
    </box>
    <box width={actualFireWidth} height={actualFireHeight} alignItems="center" justifyContent="center">
      <GlyphFire width={actualFireWidth} height={actualFireHeight} fps={fps} />
    </box>
  </box>;
}
