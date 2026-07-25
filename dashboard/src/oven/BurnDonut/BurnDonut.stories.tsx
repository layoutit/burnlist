import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { BurnDonut } from "./BurnDonut";

const fixture = componentPairFixture.burnDonut;
const meta = { title: "Patterns/BurnDonut", component: BurnDonut, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta<typeof BurnDonut>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <PairPreview component="burn-donut"><figure><BurnDonut entries={[...fixture.entries]} /><figcaption>{fixture.label}</figcaption></figure></PairPreview>,
};
