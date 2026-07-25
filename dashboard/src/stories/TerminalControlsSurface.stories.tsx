import type { Meta, StoryObj } from "@storybook/react-vite";
import { DomainTabs } from "../oven/DomainTabs/DomainTabs";
import { FieldToolbar } from "../oven/FieldToolbar/FieldToolbar";
import { PaginationBar } from "../oven/PaginationBar/PaginationBar";
import { PairedPreview, TerminalFrame, sharedControlsFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { controlsCheckpoint, controlsFixture, controlsPage, controlsRows } from "../../../tui/src/oven-runtime/controls/controls-fixture";

function ConsoleControls({ checkpoint, viewport }: { checkpoint: typeof controlsFixture.checkpoints[number]; viewport: 36 | 72 }) {
  const state = controlsCheckpoint(checkpoint), page = controlsPage(state), rows = controlsRows(state), entry = sharedControlsFrameEntries.find((item) => item.checkpoint === checkpoint && item.viewport.width === viewport);
  if (!entry) return <p role="status">No generated terminal controls frame exists.</p>;
  const start = rows.length ? page.page * controlsFixture.pageSize + 1 : 0;
  const end = Math.min((page.page + 1) * controlsFixture.pageSize, rows.length);
  return <PairedPreview consolePreview={<div><DomainTabs tabs={controlsFixture.tabs} activeId={controlsFixture.tabs[state.tab]!.id} onSelect={() => {}} /><FieldToolbar chart="current" sort="" filter={state.filter ? "failing" : ""} changedUnavailable changedReason="Sort unavailable: changed telemetry is not rendered." onSearchInput={() => {}} onToggleFilter={() => {}} />{state.query ? <output aria-label="Search query">Search: {state.query}</output> : null}<PaginationBar pageSize={controlsFixture.pageSize} pageIndex={page.page} pageCount={page.count} start={start} end={end} total={rows.length} onPrev={() => {}} onNext={() => {}} /></div>} terminalPreview={<TerminalFrame entry={entry} />} />;
}
const meta = { title: "Patterns/Terminal controls surface", component: ConsoleControls, args: { checkpoint: "initial", viewport: 72 }, argTypes: { checkpoint: { control: "select", options: controlsFixture.checkpoints }, viewport: { control: "select", options: [36, 72] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof ConsoleControls>;
export default meta;
export const Paired: StoryObj<typeof meta> = {};
