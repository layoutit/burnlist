import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { WaffleCanvas } from "../WaffleCanvas";
import { WaffleMetric } from "./WaffleMetric";

const fixture = componentPairFixture.waffleMetric;
const meta = { title: "Patterns/WaffleMetric", component: WaffleMetric, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta<typeof WaffleMetric>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <PairPreview component="waffle-metric"><figure><WaffleCanvas metric={fixture.metric} /><figcaption>{fixture.label}</figcaption></figure></PairPreview>,
};
