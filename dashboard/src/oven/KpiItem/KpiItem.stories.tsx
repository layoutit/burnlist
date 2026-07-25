import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { ProgressDonut } from "../ProgressDonut";
import { KpiItem } from "./KpiItem";

const fixture = componentPairFixture.kpiItem;
const meta = { title: "Patterns/KpiItem", component: KpiItem, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta<typeof KpiItem>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <PairPreview component="kpi-item"><KpiItem className="driving-parity-kpi-item driving-parity-kpi-section" heading={fixture.heading} value={fixture.value} visual={<ProgressDonut percent={fixture.percent} />} /></PairPreview>,
};
