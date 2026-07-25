import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { BurnDonut } from "./BurnDonut";

const fixture = componentPairFixture.burnDonut;
const meta = { title: "Patterns/BurnDonut", component: BurnDonut, args: fixture, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <PairPreview component="burn-donut" terminalArgs={args}><figure><BurnDonut entries={[...(args.entries as typeof fixture.entries)]} /><figcaption>{String(args.label)}</figcaption></figure></PairPreview>,
};
