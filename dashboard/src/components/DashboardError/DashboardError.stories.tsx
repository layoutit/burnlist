import type { Meta, StoryObj } from "@storybook/react-vite";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { PairPreview } from "../TerminalFrame/TerminalPairPreview";
import { DashboardError } from "./DashboardError";

const fixture = componentPairFixture.dashboardError;
const meta = {
  title: "Patterns/DashboardError",
  component: DashboardError,
  args: { message: fixture.message },
  parameters: { layout: "centered" },
} satisfies Meta<typeof DashboardError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
  render: (args) => (
    <PairPreview component="dashboard-error" terminalArgs={args}>
      <div className="storybook-pattern-demo"><DashboardError {...args} /></div>
    </PairPreview>
  ),
} satisfies Story;
