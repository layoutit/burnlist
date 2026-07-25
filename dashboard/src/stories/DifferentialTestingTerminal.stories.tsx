import type { Meta, StoryObj } from "@storybook/react-vite";
import { DifferentialKpiStrip } from "../oven/DifferentialKpiStrip";
import { DifferentialLogTable } from "../oven/DifferentialLogTable";
import { DifferentialFrameDeltaChart } from "../oven/DifferentialProgressChart";
import { DifferentialEmptyState } from "../oven/DifferentialEmptyState";
import { HybridFieldList } from "../oven/HybridFieldList";
import { PairedPreview, TerminalFrame, differentialFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { differentialFixture } from "../../../tui/src/catalog/differential-fixture";

type Checkpoint = typeof differentialFixture.checkpoints[number];
function Native({ checkpoint }: { checkpoint: Checkpoint }) {
  const payload = checkpoint === "empty" ? differentialFixture.empty : checkpoint === "failure" ? differentialFixture.failure : differentialFixture.payload;
  if (checkpoint === "empty") return <DifferentialEmptyState title="Differential Testing" />;
  const metrics = { frameDeviationRatios: payload.progress.map((row) => Number(row.frameDelta ?? 0)), firstFailingFrame: 0 };
  return <div><DifferentialKpiStrip payload={payload} /><DifferentialFrameDeltaChart metrics={metrics} /><DifferentialLogTable entries={payload.log as never} now={Date.parse(payload.publishedAt)} /><HybridFieldList fields={payload.fields as never} chartMode="delta" expanded={checkpoint === "drill-down" ? new Set(["active"]) : undefined} /></div>;
}
function PairedDifferential({ checkpoint = "normal", viewport = 78 }: { checkpoint?: Checkpoint; viewport?: 36 | 78 }) {
  const entry = differentialFrameEntries.find((item) => item.checkpoint === checkpoint && item.viewport.width === viewport);
  return entry ? <PairedPreview consolePreview={<Native checkpoint={checkpoint} />} terminalPreview={<TerminalFrame entry={entry} />} /> : <p role="status">No generated Differential frame exists.</p>;
}
const meta = { title: "Ovens/Differential Testing terminal", component: PairedDifferential, args: { checkpoint: "normal", viewport: 78 }, argTypes: { checkpoint: { control: "select", options: differentialFixture.checkpoints }, viewport: { control: "select", options: [36, 78] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof PairedDifferential>;
export default meta;
export const Paired: StoryObj<typeof meta> = {};
