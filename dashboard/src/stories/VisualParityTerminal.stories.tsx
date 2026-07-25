import type { Meta, StoryObj } from "@storybook/react-vite";
import { VerdictHeader } from "../oven/VerdictHeader/VerdictHeader";
import { DomainTabs } from "../oven/DomainTabs/DomainTabs";
import { MetricTiles } from "../oven/MetricTiles/MetricTiles";
import { FrameCard } from "../oven/FrameCard/FrameCard";
import { PairedPreview, TerminalFrame, visualParityFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { visualParityFixture } from "../../../tui/src/catalog/visual-parity-fixture";

function PairedVisualParity({ checkpoint = "desktop", viewport = 90 }: { checkpoint?: "desktop" | "mobile"; viewport?: 42 | 90 }) {
  const data = visualParityFixture.payload.byDomain[checkpoint], entry = visualParityFrameEntries.find((item) => item.checkpoint === checkpoint && item.viewport.width === viewport);
  const tabs = visualParityFixture.payload.domains.map((id) => ({ id, label: id, qualification: id === "desktop" ? "target" : "diagnostic", failed: id === "desktop" ? 0 : 1 }));
  return entry ? <PairedPreview consolePreview={<div><VerdictHeader {...visualParityFixture.payload.verdict} /><DomainTabs tabs={tabs} activeId={checkpoint} onSelect={() => {}} /><MetricTiles {...data.summary} /><FrameCard {...data.frames[0]!} /></div>} terminalPreview={<TerminalFrame entry={entry} />} /> : <p role="status">No generated Visual Parity frame exists.</p>;
}
const meta = { title: "Ovens/Visual Parity terminal", component: PairedVisualParity, args: { checkpoint: "desktop", viewport: 90 }, argTypes: { checkpoint: { control: "select", options: visualParityFixture.checkpoints }, viewport: { control: "select", options: [42, 90] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof PairedVisualParity>;
export default meta;
export const Paired: StoryObj<typeof meta> = {};
