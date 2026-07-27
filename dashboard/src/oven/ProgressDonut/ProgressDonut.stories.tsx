import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { ProgressDonut } from "./ProgressDonut";

const fixture = componentPairFixture.progressDonut;
const meta = { title: "Patterns/ProgressDonut", component: ProgressDonut, args: fixture, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <PairPreview component="progress-donut" terminalArgs={args}><figure><ProgressDonut percent={Number(args.percent)} /><figcaption>{String(args.label)}</figcaption></figure></PairPreview>,
};
