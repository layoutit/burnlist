import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { ProgressDonut } from "../ProgressDonut";
import { KpiItem } from "./KpiItem";

const fixture = componentPairFixture.kpiItem;
const meta = { title: "Patterns/KpiItem", component: KpiItem, args: fixture, parameters: { layout: "centered", terminalParityOwner: "oven:grammar" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <PairPreview component="kpi-item" terminalArgs={args}><KpiItem className="driving-parity-kpi-item driving-parity-kpi-section" heading={String(args.heading)} value={String(args.value)} visual={<ProgressDonut percent={Number(args.percent)} />} /></PairPreview>,
};
