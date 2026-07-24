import { fitText } from "../theme";
import { useTerminalPalette } from "../terminal-accessibility";
import { useTerminalChrome } from "../terminal-chrome";
import { generalComponentsFixture, type GeneralComponentsCheckpoint } from "./general-components-fixture";

function Row({ marker = " ", label, value = "", tone }: { marker?: string; label: string; value?: string; tone?: string }) {
  return <box height={1} flexDirection="row" overflow="hidden">
    <box width={3}><text fg={tone}>{marker}</text></box>
    <box width={18}><text fg={tone}>{fitText(label, 18)}</text></box>
    <box flexGrow={1} overflow="hidden"><text>{value}</text></box>
  </box>;
}

function Overview({ width }: { width: number }) {
  const palette = useTerminalPalette();
  const colors = [palette.foreground, palette.muted, palette.blue, palette.green, palette.amber, palette.red];
  return <box flexDirection="column" gap={1} overflow="hidden">
    <text fg={palette.foreground}>Typography  HEADING  Body copy  metadata</text>
    <box height={1} flexDirection="row">{generalComponentsFixture.palette.map((name, index) => <text key={name} fg={colors[index]}>■ {name}  </text>)}</box>
    <text><span fg={palette.blue}>[active]</span> <span fg={palette.green}>[ready]</span> <span fg={palette.red}>[blocked]</span>  badges</text>
    <text><span fg={palette.blue}>[ Run burn ]</span>  [ Open Oven ]  <span fg={palette.dim}>[ Unavailable ]</span></text>
    <box border={["top", "bottom"]} borderColor={palette.dim} flexDirection="column" paddingLeft={1}>
      <text fg={palette.foreground}>Card · Differential Testing</text>
      <text fg={palette.muted}>{fitText("Exact-first comparison against the bound native source.", Math.max(1, width - 4))}</text>
    </box>
    {generalComponentsFixture.progress.map((value) => <text key={value}>{String(value).padStart(3)}% {"━".repeat(Math.round(value / 10))}{"·".repeat(10 - Math.round(value / 10))}</text>)}
    <text fg={palette.dim}>PROJECT       BURNLIST          STATUS   PROGRESS</text>
    {generalComponentsFixture.table.map((row) => <text key={row[1]}>{fitText(row.join("  "), width)}</text>)}
  </box>;
}

function Forms({ interacted }: { interacted: boolean }) {
  const palette = useTerminalPalette();
  return <box flexDirection="column" gap={1} overflow="hidden">
    <text fg={palette.foreground}>Field · form composition</text>
    <Row marker={interacted ? "☑" : "☐"} label="Include complete" value="Checkbox" tone={palette.blue} />
    <Row marker="›" label="Oven name" value={interacted ? "Release readiness█" : "Release readiness"} tone={palette.foreground} />
    <Row marker="⌄" label="Lifecycle" value={interacted ? "[Complete]" : "[Active]"} tone={palette.green} />
    <Row marker="¶" label="Objective" value="Describe measurable outcome…" tone={palette.muted} />
    <Row marker="!" label="Repository path" value="/absolute/path required" tone={palette.red} />
    <text><span fg={palette.blue}>[{interacted ? "Complete" : "Active"}]</span>  Complete  Blocked   tabs</text>
    <text>View: List  <span fg={palette.blue}>[{interacted ? "Chart" : "Table"}]</span>  Chart   toggle group</text>
    <text>Evidence: <span fg={palette.green}>[Exact]</span> <span fg={palette.green}>[Visual]</span> [Performance]</text>
    <text fg={palette.dim}>tab:focus · enter:change · type:edit · disabled controls stay inert</text>
  </box>;
}

function Feedback({ width }: { width: number }) {
  const palette = useTerminalPalette();
  return <box flexDirection="column" gap={1} overflow="hidden">
    <Row marker="i" label="Information" value="Dashboard refreshes automatically." tone={palette.blue} />
    <Row marker="✓" label="Verification" value="Required evidence is available." tone={palette.green} />
    <Row marker="!" label="Evidence stale" value="Refresh retained artifacts." tone={palette.amber} />
    <Row marker="×" label="Run failed" value="Canonical state is unreadable." tone={palette.red} />
    <box border={["top", "bottom"]} borderColor={palette.dim} paddingLeft={1} flexDirection="column">
      <text fg={palette.foreground}>○ No Burnlists found</text>
      <text fg={palette.muted}>{fitText("Register a repository or adjust lifecycle filters.", Math.max(1, width - 4))}</text>
    </box>
    <text fg={palette.red}>⚠ Dashboard error · Could not read local state.</text>
    <text fg={palette.dim}>◌ Loading summary  ▒▒▒▒▒▒▒▒  spinner + skeleton</text>
    <text>ⓘ Canonical state is the source used by this view.  tooltip</text>
    <text fg={palette.blue}>[ Copy ]  copy action · [ Copied ✓ ] confirmation</text>
  </box>;
}

export function GeneralComponentsSurface({ checkpoint, width }: { checkpoint: GeneralComponentsCheckpoint; width: number }) {
  const chrome = useTerminalChrome();
  return <box width={width} height="100%" flexDirection="column" overflow="hidden" backgroundColor={chrome.background}>
    <box height={2} flexShrink={0} border={["bottom"]} borderColor={chrome.line} alignItems="center">
      <text>GENERAL COMPONENTS · {checkpoint.toUpperCase()}</text>
    </box>
    <box flexGrow={1} minHeight={0} paddingTop={1} flexDirection="column" overflow="hidden">
      {checkpoint === "overview" ? <Overview width={width} /> : checkpoint === "feedback" ? <Feedback width={width} /> : <Forms interacted={checkpoint === "interacted"} />}
    </box>
  </box>;
}

