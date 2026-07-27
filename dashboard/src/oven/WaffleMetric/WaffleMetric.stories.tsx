import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { WaffleCanvas } from "../WaffleCanvas";
import { WaffleMetric } from "./WaffleMetric";

const fixture = componentPairFixture.waffleMetric;
const meta = { title: "Patterns/WaffleMetric", component: WaffleMetric, args: fixture, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <PairPreview component="waffle-metric" terminalArgs={args}><figure><WaffleCanvas metric={args.metric as typeof fixture.metric} /><figcaption>{String(args.label)}</figcaption></figure></PairPreview>,
};
