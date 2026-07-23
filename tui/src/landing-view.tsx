import type { BurnlistSummary, LandingSnapshot, OvenSummary } from "./types";
import { groupBurnlists } from "./landing-groups";
import { compactTime, fitText, palette, progressLabel, visibleWindow } from "./theme";
import { TableCell, TableGroup, TableLine } from "./table-view";

interface ListProps<T> {
  entries: T[];
  selected: number;
  focused: boolean;
  maxRows: number;
  terminalWidth: number;
  empty: string;
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
    <TableCell grow={1} color={header ? tone : palette.foreground}>{fitText(header ? "" : entry?.title, titleWidth)}</TableCell>
    {ovenWidth ? <TableCell width={ovenWidth} color={header ? tone : palette.soft}>{header ? "OVEN" : entry?.ovenName ?? ""}</TableCell> : null}
    {statusWidth ? <TableCell width={statusWidth} color={header ? tone : entry?.statusLabel === "Blocked" ? palette.red : entry?.status === "active" ? palette.green : palette.muted}>{header ? "STATUS" : entry?.statusLabel ?? ""}</TableCell> : null}
    <TableCell width={progressWidth} color={header ? tone : palette.muted}>{header ? "PROGRESS" : entry ? progressLabel(entry.done, entry.total, entry.percent, entry.progressLabel) : ""}</TableCell>
    {updatedWidth ? <TableCell width={updatedWidth} color={tone}>{header ? "UPDATED" : compactTime(entry?.updatedAt ?? null)}</TableCell> : null}
  </box>;
}

export function BurnlistList({ landing, selected, focused, maxRows, terminalWidth, empty }: Omit<ListProps<BurnlistSummary>, "entries"> & { landing: LandingSnapshot }) {
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
    <TableLine header>
      <BurnlistColumns width={terminalWidth - 3} header />
    </TableLine>
    {groups.map((group) => <box key={group.key} flexDirection="column">
      <TableGroup name={group.label} count={group.entries.length} noun="Burnlist" />
      {group.entries.map((entry) => {
        const index = entries.indexOf(entry);
        const active = focused && index === selected;
        return <TableLine key={`${entry.repoKey ?? entry.repo}:${entry.id}:${entry.ovenId}`} selected={active}>
          <BurnlistColumns width={terminalWidth - 3} entry={entry} />
        </TableLine>;
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
    <TableCell width={nameWidth} color={header ? tone : palette.foreground}>{header ? "OVEN" : entry?.name ?? ""}</TableCell>
    {scopeWidth ? <TableCell width={scopeWidth} color={tone}>{header ? "SCOPE" : entry?.builtIn ? "Built-in" : "Project"}</TableCell> : null}
    {contractWidth ? <TableCell width={contractWidth} color={header ? tone : palette.soft}>{header ? "CONTRACT" : entry?.contract ?? ""}</TableCell> : null}
    {inputWidth ? <TableCell width={inputWidth} color={tone}>{header ? "INPUT" : entry?.dataInput ?? ""}</TableCell> : null}
    <TableCell grow={1} color={tone}>{fitText(header ? "DESCRIPTION" : entry?.description, Math.max(10, width - nameWidth - scopeWidth - contractWidth - inputWidth - 6))}</TableCell>
  </box>;
}

export function OvenList({ entries, selected, focused, maxRows, terminalWidth, empty }: ListProps<OvenSummary>) {
  const window = visibleWindow(entries, selected, maxRows);
  if (!entries.length) return <box flexGrow={1} paddingLeft={2}><text fg={palette.dim}>{empty}</text></box>;
  return <box flexDirection="column" flexGrow={1}>
    <TableLine header>
      <OvenColumns width={terminalWidth - 3} header />
    </TableLine>
    {window.items.map((entry, offset) => {
      const index = window.start + offset;
      const active = focused && index === selected;
      return <TableLine key={`${entry.repoKey ?? "built-in"}:${entry.id}`} selected={active}>
        <OvenColumns width={terminalWidth - 2} entry={entry} />
      </TableLine>;
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
