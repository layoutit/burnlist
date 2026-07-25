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
  parameters: { layout: "centered", terminalParityOwner: "oven:grammar" },
} satisfies Meta<typeof KpiStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <PairPreview component="kpi-strip"><KpiStrip className="driving-parity-kpi-strip has-burns" ariaLabel={fixture.title}>
    {fixture.items.map((item, index) => <KpiItem key={item.heading} className="driving-parity-kpi-item driving-parity-kpi-section" heading={item.heading} value={item.value} visual={index === 0
      ? <ProgressDonut percent={componentPairFixture.progressDonut.percent} />
      : index === 1
        ? <BurnDonut entries={[...componentPairFixture.burnDonut.entries]} />
        : <WaffleCanvas metric={componentPairFixture.waffleMetric.metric} />} />)}
  </KpiStrip></PairPreview>,
};
