import type { Meta, StoryObj } from "@storybook/react-vite";
import { DashboardError } from "./DashboardError";

const meta = {
  title: "Patterns/DashboardError",
  component: DashboardError,
  args: { message: "The local Burnlist registry could not be read." },
  parameters: { layout: "centered" },
} satisfies Meta<typeof DashboardError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
  render: (args) => <div className="storybook-pattern-demo"><DashboardError {...args} /></div>,
} satisfies Story;
