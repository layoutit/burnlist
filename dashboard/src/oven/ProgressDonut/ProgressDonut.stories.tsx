import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { ProgressDonut } from "./ProgressDonut";

const fixture = componentPairFixture.progressDonut;
const meta = { title: "Patterns/ProgressDonut", component: ProgressDonut, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta<typeof ProgressDonut>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <PairPreview component="progress-donut"><figure><ProgressDonut percent={fixture.percent} /><figcaption>{fixture.label}</figcaption></figure></PairPreview>,
};
