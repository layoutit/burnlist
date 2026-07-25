import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { BurnDonut } from "../BurnDonut";
import { KpiItem } from "../KpiItem";
import { ProgressDonut } from "../ProgressDonut";
import { WaffleCanvas } from "../WaffleCanvas";
import { KpiStrip } from "./KpiStrip";

const fixture = componentPairFixture.kpiStrip;
const meta = {
  title: "Patterns/KpiStrip",
  component: KpiStrip,
  args: {
    title: fixture.title,
    percent: componentPairFixture.progressDonut.percent,
    entries: componentPairFixture.burnDonut.entries,
    metric: componentPairFixture.waffleMetric.metric,
  },
  parameters: { layout: "centered", terminalParityOwner: "oven:grammar" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <PairPreview component="kpi-strip" terminalArgs={args}><KpiStrip className="driving-parity-kpi-strip has-burns" ariaLabel={String(args.title)}>
    {fixture.items.map((item, index) => <KpiItem key={item.heading} className="driving-parity-kpi-item driving-parity-kpi-section" heading={item.heading} value={item.value} visual={index === 0
      ? <ProgressDonut percent={Number(args.percent)} />
      : index === 1
        ? <BurnDonut entries={[...(args.entries as typeof componentPairFixture.burnDonut.entries)]} />
        : <WaffleCanvas metric={args.metric as typeof componentPairFixture.waffleMetric.metric} />} />)}
  </KpiStrip></PairPreview>,
};
