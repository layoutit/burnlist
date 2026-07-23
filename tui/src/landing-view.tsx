import type { BurnlistSummary, LandingSnapshot, OvenSummary } from "./types";
import { groupBurnlists } from "./landing-groups";
import { compactTime, fitText, palette, progressLabel, visibleWindow } from "./theme";
import { useTerminalChrome } from "./terminal-chrome";

interface ListProps<T> {
  entries: T[];
  selected: number;
  focused: boolean;
  maxRows: number;
  terminalWidth: number;
  empty: string;
}

function Cell({ children, width, grow = 0, color = palette.muted }: {
  children: string;
  width?: number;
  grow?: number;
  color?: string;
}) {
  return <box width={width} flexGrow={grow} flexShrink={width ? 0 : 1} paddingLeft={1}>
    <text fg={color}>{children}</text>
  </box>;
}

function BurnlistColumns({ width, header, entry }: { width: number; header?: boolean; entry?: BurnlistSummary }) {
  const wide = width >= 112;
  const medium = width >= 82;
  const ovenWidth = wide ? 20 : medium ? 18 : 0;
  const statusWidth = wide ? 12 : 0;
  const progressWidth = wide ? 18 : medium ? 16 : 13;
  const updatedWidth = wide ? 14 : 0;
  const fixed = ovenWidth + statusWidth + progressWidth + updatedWidth + 6;
  const titleWidth = Math.max(12, width - fixed);
  const tone = header ? palette.dim : palette.muted;
  return <box flexDirection="row" flexGrow={1}>
    <Cell grow={1} color={header ? tone : palette.foreground}>{fitText(header ? "BURNLIST" : entry?.title, titleWidth)}</Cell>
    {ovenWidth ? <Cell width={ovenWidth} color={header ? tone : palette.soft}>{fitText(header ? "OVEN" : entry?.ovenName, ovenWidth - 1)}</Cell> : null}
    {statusWidth ? <Cell width={statusWidth} color={header ? tone : entry?.statusLabel === "Blocked" ? palette.red : entry?.status === "active" ? palette.green : palette.muted}>{fitText(header ? "STATUS" : entry?.statusLabel, statusWidth - 1)}</Cell> : null}
    <Cell width={progressWidth} color={header ? tone : palette.muted}>{fitText(header ? "PROGRESS" : entry ? progressLabel(entry.done, entry.total, entry.percent, entry.progressLabel) : "", progressWidth - 1)}</Cell>
    {updatedWidth ? <Cell width={updatedWidth} color={tone}>{fitText(header ? "UPDATED" : compactTime(entry?.updatedAt ?? null), updatedWidth - 1)}</Cell> : null}
  </box>;
}

export function BurnlistList({ landing, selected, focused, maxRows, terminalWidth, empty }: Omit<ListProps<BurnlistSummary>, "entries"> & { landing: LandingSnapshot }) {
  const chrome = useTerminalChrome();
  const entries = groupBurnlists(landing).flatMap((group) => group.entries);
  let itemRows = maxRows;
  let window = visibleWindow(entries, selected, itemRows);
  for (let pass = 0; pass < 3; pass += 1) {
    const headingRows = groupBurnlists({ ...landing, burnlists: window.items }).length;
    itemRows = Math.max(1, maxRows - headingRows);
    window = visibleWindow(entries, selected, itemRows);
  }
  const groups = groupBurnlists({ ...landing, burnlists: window.items });
  if (!entries.length) return <box flexGrow={1} paddingLeft={2}><text fg={palette.dim}>{empty}</text></box>;
  return <box flexDirection="column" flexGrow={1}>
    <box height={1} backgroundColor={chrome.header} paddingLeft={2}>
      <box width={1} />
      <BurnlistColumns width={terminalWidth - 3} header />
    </box>
    {groups.map((group) => <box key={group.key} flexDirection="column">
      <box height={1} paddingLeft={3} backgroundColor={chrome.background} flexDirection="row">
        <text fg={palette.blue}>{group.label}</text>
        <text fg={palette.dim}>{`  ·  ${group.entries.length} ${group.entries.length === 1 ? "Burnlist" : "Burnlists"}`}</text>
      </box>
      {group.entries.map((entry) => {
        const index = entries.indexOf(entry);
        const active = focused && index === selected;
        return <box key={`${entry.repoKey ?? entry.repo}:${entry.id}:${entry.ovenId}`} height={1} flexDirection="row" paddingLeft={1} backgroundColor={active ? chrome.surface : chrome.background}>
          <box width={1}><text fg={active ? palette.blue : chrome.background}>{active ? "▎" : " "}</text></box>
          <BurnlistColumns width={terminalWidth - 3} entry={entry} />
        </box>;
      })}
    </box>)}
  </box>;
}

function OvenColumns({ width, header, entry }: { width: number; header?: boolean; entry?: OvenSummary }) {
  const wide = width >= 110;
  const medium = width >= 76;
  const nameWidth = wide ? 24 : medium ? 22 : 20;
  const scopeWidth = wide ? 18 : medium ? 16 : 0;
  const inputWidth = wide ? 19 : 0;
  const contractWidth = wide ? 34 : medium ? 30 : 0;
  const tone = header ? palette.dim : palette.muted;
  return <box flexDirection="row" flexGrow={1}>
    <Cell width={nameWidth} color={header ? tone : palette.foreground}>{fitText(header ? "OVEN" : entry?.name, nameWidth - 1)}</Cell>
    {scopeWidth ? <Cell width={scopeWidth} color={tone}>{fitText(header ? "SCOPE" : entry?.builtIn ? "Built-in" : "Project", scopeWidth - 1)}</Cell> : null}
    {contractWidth ? <Cell width={contractWidth} color={header ? tone : palette.soft}>{fitText(header ? "CONTRACT" : entry?.contract, contractWidth - 1)}</Cell> : null}
    {inputWidth ? <Cell width={inputWidth} color={tone}>{fitText(header ? "INPUT" : entry?.dataInput, inputWidth - 1)}</Cell> : null}
    <Cell grow={1} color={tone}>{fitText(header ? "DESCRIPTION" : entry?.description, Math.max(10, width - nameWidth - scopeWidth - contractWidth - inputWidth - 6))}</Cell>
  </box>;
}

export function OvenList({ entries, selected, focused, maxRows, terminalWidth, empty }: ListProps<OvenSummary>) {
  const chrome = useTerminalChrome();
  const window = visibleWindow(entries, selected, maxRows);
  if (!entries.length) return <box flexGrow={1} paddingLeft={2}><text fg={palette.dim}>{empty}</text></box>;
  return <box flexDirection="column" flexGrow={1}>
    <box height={2} border={["bottom"]} borderColor={chrome.line} paddingLeft={1}>
      <box width={1} />
      <OvenColumns width={terminalWidth - 3} header />
    </box>
    {window.items.map((entry, offset) => {
      const index = window.start + offset;
      const active = focused && index === selected;
      return <box key={`${entry.repoKey ?? "built-in"}:${entry.id}`} height={2} flexDirection="row" border={["bottom"]} borderColor={chrome.faintLine} backgroundColor={active ? chrome.surface : chrome.background}>
        <text fg={active ? palette.blue : chrome.background}>{active ? "▎" : " "}</text>
        <OvenColumns width={terminalWidth - 2} entry={entry} />
      </box>;
    })}
  </box>;
}

export function LandingSectionHeading({ title, source, landing }: {
  title: string;
  source: "burnlists" | "ovens";
  landing: LandingSnapshot;
}) {
  const count = landing[source].length;
  const projects = new Set(landing.burnlists.map((entry) => entry.repoKey ?? entry.repo)).size;
  const summary = source === "burnlists"
    ? `${count} Burnlists in ${projects} ${projects === 1 ? "project" : "projects"}`
    : `${count} generic ${count === 1 ? "Oven" : "Ovens"} · global catalog`;
  return <box height={3} paddingLeft={2} paddingTop={1} flexDirection="row" gap={2}>
    <text fg={palette.foreground}>{title}</text>
    <text fg={palette.dim}>{summary}</text>
  </box>;
}
