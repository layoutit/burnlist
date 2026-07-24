import type { Meta, StoryObj } from "@storybook/react-vite";
import { listFixture, listPreviewRows, type ListFixtureState } from "../../../tui/src/catalog/list-fixture";
import { LogTable } from "../oven/LogTable";
import { PairedPreview, TerminalFrame, sharedListFrameEntries } from "../components/TerminalFrame/TerminalFrame";

function ConsoleList({ state }: { state: ListFixtureState }) {
  const preview = listPreviewRows(72, state), rows = preview.rows.slice(state === "latest" ? -5 : 0, state === "latest" ? undefined : 5);
  return <LogTable columns={listFixture.columns.map((column) => column.label)} rows={rows.map((row) => ({ key: row.id, className: row.id === preview.selectedId ? "log-row selected" : "log-row", cells: listFixture.columns.map((column) => ({ className: `log-table-cell ${column.id}`, content: row.cells[column.id] })) }))} />;
}

function PairedListSurface({ state = "current", viewport = 72 }: { state?: ListFixtureState; viewport?: 36 | 48 | 72 }) {
  const entry = sharedListFrameEntries.find((candidate) => candidate.checkpoint === state && candidate.viewport.width === viewport);
  if (!entry) return <p role="status">No generated terminal list frame exists for this state.</p>;
  return <div style={{ display: "grid", gap: 16, width: "min(100%, 980px)" }}><p className="storybook-label">One shared fixture drives the console table and the captured OpenTUI frame.</p><PairedPreview consolePreview={<ConsoleList state={state} />} terminalPreview={<TerminalFrame entry={entry} />} /></div>;
}

const meta = { title: "Patterns/Terminal list surface", component: PairedListSurface, args: { state: "current", viewport: 72 }, argTypes: { state: { control: "select", options: ["current", "expanded", "latest"] }, viewport: { control: "select", options: [36, 48, 72] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof PairedListSurface>;
export default meta;
export const Paired: StoryObj<typeof meta> = { args: { state: "current" } };
