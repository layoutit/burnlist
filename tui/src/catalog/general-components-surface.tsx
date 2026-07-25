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

function CompactRow({ marker = " ", label, value = "", tone, width }: { marker?: string; label: string; value?: string; tone?: string; width: number }) {
  return <box flexDirection="column" overflow="hidden">
    <text fg={tone}>{fitText(`${marker} ${label}`, width)}</text>
    <text>{fitText(`  ${value}`, width)}</text>
  </box>;
}

function Overview({ width }: { width: number }) {
  const palette = useTerminalPalette();
  const { overview } = generalComponentsFixture.labels;
  const [runBurn, openOven, unavailable] = generalComponentsFixture.buttons;
  if (width < 48) return <box flexDirection="column" overflow="hidden">
    <text fg={palette.foreground}>Typography · heading / body / metadata</text>
    <text fg={palette.muted}>Palette · foreground / muted / blue / status</text>
    <text><span fg={palette.blue}>active</span> · <span fg={palette.green}>ready</span> · <span fg={palette.red}>blocked</span></text>
    <text><span fg={palette.blue}>{runBurn}</span> · {openOven} · {unavailable}</text>
    <text fg={palette.foreground}>Card · {overview.cardTitle}</text>
    <text fg={palette.muted}>{fitText(overview.cardDescription, width)}</text>
    {generalComponentsFixture.progress.map((value) => <text key={value}>{String(value).padStart(3)}% {"━".repeat(Math.round(value / 10))}{"·".repeat(10 - Math.round(value / 10))}</text>)}
    <text fg={palette.dim}>Table · project / burnlist / status</text>
    {generalComponentsFixture.table.slice(0, 2).map((row) => <text key={row[1]}>{fitText(`${row[0]} · ${row[2]} · ${row[3]}`, width)}</text>)}
  </box>;
  const colors = [palette.foreground, palette.muted, palette.blue, palette.green, palette.amber, palette.red];
  return <box flexDirection="column" gap={1} overflow="hidden">
    <text fg={palette.foreground}>Typography  HEADING  Body copy  metadata</text>
    <box height={1} flexDirection="row">{generalComponentsFixture.palette.map((name, index) => <text key={name} fg={colors[index]}>■ {name}  </text>)}</box>
    <text><span fg={palette.blue}>[active]</span> <span fg={palette.green}>[ready]</span> <span fg={palette.red}>[blocked]</span>  badges</text>
    <text><span fg={palette.blue}>[ {runBurn} ]</span>  [ {openOven} ]  <span fg={palette.dim}>[ {unavailable} ]</span></text>
    <box border={["top", "bottom"]} borderColor={palette.dim} flexDirection="column" paddingLeft={1}>
      <text fg={palette.foreground}>Card · {overview.cardTitle}</text>
      <text fg={palette.muted}>{fitText(overview.cardDescription, Math.max(1, width - 4))}</text>
    </box>
    {generalComponentsFixture.progress.map((value) => <text key={value}>{String(value).padStart(3)}% {"━".repeat(Math.round(value / 10))}{"·".repeat(10 - Math.round(value / 10))}</text>)}
    <text fg={palette.dim}>PROJECT       BURNLIST          STATUS   PROGRESS</text>
    {generalComponentsFixture.table.map((row) => <text key={row[1]}>{fitText(row.join("  "), width)}</text>)}
  </box>;
}

function Forms({ interacted, width }: { interacted: boolean; width: number }) {
  const palette = useTerminalPalette();
  const { forms } = generalComponentsFixture.labels;
  const { values } = generalComponentsFixture;
  const state = generalComponentsFixture.states[interacted ? "interacted" : "forms"];
  if (width < 48) return <box flexDirection="column" overflow="hidden">
    <text fg={palette.foreground}>Field · form composition</text>
    <CompactRow marker={state.includeCompleted ? "☑" : "☐"} label={forms.includeCompleted} value="Checkbox" tone={palette.blue} width={width} />
    <CompactRow marker="›" label={forms.ovenName} value={`${values.ovenName}${interacted ? "█" : ""}`} tone={palette.foreground} width={width} />
    <CompactRow marker="⌄" label={forms.lifecycle} value={state.lifecycle} tone={palette.green} width={width} />
    <CompactRow marker="¶" label={forms.objective} value={values.objectivePlaceholder} tone={palette.muted} width={width} />
    <CompactRow marker="!" label={forms.repositoryPath} value={forms.repositoryPathError} tone={palette.red} width={width} />
    <text><span fg={palette.blue}>{state.selectedTab}</span> · {generalComponentsFixture.tabs.join(" · ")}</text>
    <text>View · {values.viewModes.join(" / ")} · selected {state.selectedView}</text>
  </box>;
  return <box flexDirection="column" gap={1} overflow="hidden">
    <text fg={palette.foreground}>Field · form composition</text>
    <Row marker={state.includeCompleted ? "☑" : "☐"} label={forms.includeCompleted} value="Checkbox" tone={palette.blue} />
    <Row marker="›" label={forms.ovenName} value={`${values.ovenName}${interacted ? "█" : ""}`} tone={palette.foreground} />
    <Row marker="⌄" label={forms.lifecycle} value={`[${state.lifecycle}]`} tone={palette.green} />
    <Row marker="¶" label={forms.objective} value={values.objectivePlaceholder} tone={palette.muted} />
    <Row marker="!" label={forms.repositoryPath} value={forms.repositoryPathError} tone={palette.red} />
    <text><span fg={palette.blue}>[{state.selectedTab}]</span>  {generalComponentsFixture.tabs.join("  ")}   tabs</text>
    <text>View: {values.viewModes.join("  ")} · selected <span fg={palette.blue}>[{state.selectedView}]</span></text>
    <text>Evidence: <span fg={palette.green}>[Exact]</span> <span fg={palette.green}>[Visual]</span> [Performance]</text>
    <text fg={palette.dim}>catalog actions are listed in the shared footer · disabled controls stay inert</text>
  </box>;
}

function Feedback({ width }: { width: number }) {
  const palette = useTerminalPalette();
  const { feedback } = generalComponentsFixture.labels;
  if (width < 48) return <box flexDirection="column" overflow="hidden">
    <CompactRow marker="i" label="Information" value="Dashboard refreshes automatically." tone={palette.blue} width={width} />
    <CompactRow marker="✓" label={feedback.verificationPassed} value={feedback.evidenceAvailable} tone={palette.green} width={width} />
    <CompactRow marker="!" label={feedback.evidenceStale} value={feedback.refreshArtifacts} tone={palette.amber} width={width} />
    <CompactRow marker="×" label="Run failed" value="Canonical state is unreadable." tone={palette.red} width={width} />
    <text fg={palette.foreground}>○ {feedback.emptyTitle}</text>
    <text fg={palette.muted}>{fitText(feedback.emptyDetail, width)}</text>
    <text fg={palette.red}>⚠ Dashboard error · {feedback.dashboardError}</text>
    <text fg={palette.dim}>◌ {feedback.loadingSummary} · spinner + skeleton</text>
  </box>;
  return <box flexDirection="column" gap={1} overflow="hidden">
    <Row marker="i" label="Information" value="Dashboard refreshes automatically." tone={palette.blue} />
    <Row marker="✓" label={feedback.verificationPassed} value={feedback.evidenceAvailable} tone={palette.green} />
    <Row marker="!" label={feedback.evidenceStale} value={feedback.refreshArtifacts} tone={palette.amber} />
    <Row marker="×" label="Run failed" value="Canonical state is unreadable." tone={palette.red} />
    <box border={["top", "bottom"]} borderColor={palette.dim} paddingLeft={1} flexDirection="column">
      <text fg={palette.foreground}>○ {feedback.emptyTitle}</text>
      <text fg={palette.muted}>{fitText(feedback.emptyDetail, Math.max(1, width - 4))}</text>
    </box>
    <text fg={palette.red}>⚠ Dashboard error · {feedback.dashboardError}</text>
    <text fg={palette.dim}>◌ {feedback.loadingSummary}  ▒▒▒▒▒▒▒▒  spinner + skeleton</text>
    <text>ⓘ {feedback.canonicalStateDetail}  tooltip</text>
    <text fg={palette.blue}>[ {generalComponentsFixture.actionLabels.copy} ]  copy action · [ Copied ✓ ] confirmation</text>
  </box>;
}

export function GeneralComponentsSurface({ checkpoint, width }: { checkpoint: GeneralComponentsCheckpoint; width: number }) {
  const chrome = useTerminalChrome();
  return <box width={width} height="100%" flexDirection="column" overflow="hidden" backgroundColor={chrome.background}>
    <box height={2} flexShrink={0} border={["bottom"]} borderColor={chrome.line} alignItems="center">
      <text>GENERAL COMPONENTS · {checkpoint.toUpperCase()}</text>
    </box>
    <box flexGrow={1} minHeight={0} paddingTop={1} flexDirection="column" overflow="hidden">
      {checkpoint === "overview" ? <Overview width={width} /> : checkpoint === "feedback" ? <Feedback width={width} /> : <Forms interacted={checkpoint === "interacted"} width={width} />}
    </box>
  </box>;
}
