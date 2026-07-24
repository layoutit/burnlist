import type { Meta, StoryObj } from "@storybook/react-vite";
import { SectionHeader } from "../oven/SectionHeader";
import { RefreshStatusChip } from "../oven/RefreshStatusChip";
import { DomainNote } from "../oven/DomainNote";
import { DifferentialEmptyState } from "../oven/DifferentialEmptyState";
import { PairedPreview, TerminalFrame, statusFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { statusFixtureCheckpoints, statusFixtureStates, type StatusFixtureCheckpoint } from "../../../tui/src/catalog/status-fixture";

function NativeConsole({ checkpoint }: { checkpoint: StatusFixtureCheckpoint }) {
  const state = statusFixtureStates[checkpoint], data = state.console;
  if (state.empty) return <DifferentialEmptyState title="Run overview" />;
  return <div><SectionHeader title="Run overview" count={data.count} /><RefreshStatusChip clientStatus={data.clientStatus} refresh={data.clientStatus === "failed" ? { status: data.clientStatus, error: data.error } : undefined} /><DomainNote isTarget={data.isTarget} rationale={data.rationale} /></div>;
}
function PairedStatus({ checkpoint = "normal", viewport = 72 }: { checkpoint?: StatusFixtureCheckpoint; viewport?: 36 | 72 }) {
  const entry = statusFrameEntries.find((candidate) => candidate.checkpoint === checkpoint && candidate.viewport.width === viewport);
  return entry ? <PairedPreview consolePreview={<NativeConsole checkpoint={checkpoint} />} terminalPreview={<TerminalFrame entry={entry} />} /> : <p role="status">No generated terminal status frame exists.</p>;
}
const meta = { title: "Patterns/Terminal heading and status", component: PairedStatus, args: { checkpoint: "normal", viewport: 72 }, argTypes: { checkpoint: { control: "select", options: statusFixtureCheckpoints }, viewport: { control: "select", options: [36, 72] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof PairedStatus>;
export default meta;
export const Paired: StoryObj<typeof meta> = {};
