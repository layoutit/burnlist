import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/VisualParity/visual-parity.css";
import { MetricTiles } from "./MetricTiles";

const fixture = componentPairFixture.metricTiles;
const meta = { title: "Patterns/MetricTiles", component: MetricTiles, parameters: { layout: "centered", terminalParityOwner: "oven:visual-parity" } } satisfies Meta<typeof MetricTiles>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <PairPreview component="metric-tiles"><MetricTiles {...fixture} /></PairPreview>,
};
