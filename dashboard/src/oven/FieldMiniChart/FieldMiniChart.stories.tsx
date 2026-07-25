import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { FieldMiniChart } from "./FieldMiniChart";

const fixture = componentPairFixture.lineChart;
const field = {
  samples: fixture.points.map((point, index) => [index, 0, point.value, point.state === "fail" ? 1 : 0] as [number, number, number, number]),
};
const meta = { title: "Patterns/LineChart", component: FieldMiniChart, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta<typeof FieldMiniChart>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <PairPreview component="line-chart"><div className="chart hybrid-chart" role="img" aria-label={fixture.title}><FieldMiniChart field={field} showFrameLabels chartMode="delta" /></div></PairPreview>,
};
