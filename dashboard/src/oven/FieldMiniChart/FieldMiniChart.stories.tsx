import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { FieldMiniChart } from "./FieldMiniChart";

const fixture = componentPairFixture.lineChart;
const meta = {
  title: "Patterns/SeriesChart",
  component: FieldMiniChart,
  args: fixture,
  argTypes: { chartMode: { control: "inline-radio", options: ["delta", "value"] } },
  parameters: { layout: "centered", terminalParityOwner: "oven:grammar" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const points = Array.isArray(args.points) ? args.points as typeof fixture.points : fixture.points;
    const field = { samples: points.map((point, index) => [index, 0, point.value, point.state === "fail" ? 1 : 0] as [number, number, number, number]) };
    return <PairPreview component="line-chart" terminalArgs={{ ...args, points }}><div className="chart hybrid-chart" role="img" aria-label={String(args.title)}><FieldMiniChart field={field} showFrameLabels chartMode={String(args.chartMode)} /></div></PairPreview>;
  },
};
