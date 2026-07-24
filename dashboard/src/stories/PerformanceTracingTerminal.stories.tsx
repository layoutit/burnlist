import type { Meta, StoryObj } from "@storybook/react-vite";
import { DifferentialEmptyState } from "../oven/DifferentialEmptyState";
import { DifferentialFrameDeltaChart } from "../oven/DifferentialProgressChart";
import { DifferentialKpiStrip } from "../oven/DifferentialKpiStrip";
import { DifferentialLogTable } from "../oven/DifferentialLogTable";
import { HybridFieldList } from "../oven/HybridFieldList";
import { PairedPreview, TerminalFrame, performanceTracingFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { performanceTracingFixture } from "../../../tui/src/catalog/performance-tracing-fixture";

type Checkpoint = typeof performanceTracingFixture.checkpoints[number];
function Native({ checkpoint }: { checkpoint: Checkpoint }) {
  const payload = checkpoint === "empty" ? performanceTracingFixture.empty : checkpoint === "failed-budget" ? performanceTracingFixture.failedBudget : performanceTracingFixture.payload;
  if (checkpoint === "empty") return <DifferentialEmptyState title="Performance Tracing" />;
  const deltas = payload.progress.map((row) => row.frameDelta).filter((value): value is number => typeof value === "number");
  return <div><DifferentialKpiStrip payload={payload} /><DifferentialFrameDeltaChart metrics={{ frameDeviationRatios: deltas, firstFailingFrame: -1 }} hostOnly={!deltas.length} hostRole="img" hostAriaLabel="Exact-prefix frame delta unavailable: insufficient history" /><DifferentialLogTable entries={payload.log as never} now={Date.parse(payload.publishedAt)} /><HybridFieldList fields={payload.fields as never} chartMode="current" /></div>;
}
function PairedPerformanceTracing({ checkpoint = "normal", viewport = 78 }: { checkpoint?: Checkpoint; viewport?: 36 | 78 }) {
  const entry = performanceTracingFrameEntries.find((item) => item.checkpoint === checkpoint && item.viewport.width === viewport);
  return entry ? <PairedPreview consolePreview={<Native checkpoint={checkpoint} />} terminalPreview={<TerminalFrame entry={entry} />} /> : <p role="status">No generated Performance Tracing frame exists.</p>;
}
const meta = { title: "Ovens/Performance Tracing terminal", component: PairedPerformanceTracing, args: { checkpoint: "normal", viewport: 78 }, argTypes: { checkpoint: { control: "select", options: performanceTracingFixture.checkpoints }, viewport: { control: "select", options: [36, 78] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof PairedPerformanceTracing>;
export default meta;
export const Paired: StoryObj<typeof meta> = {};
