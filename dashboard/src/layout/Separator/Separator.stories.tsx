import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./Separator";

const meta = {
  title: "UI/Separator",
  component: Separator,
  args: {
    decorative: true,
    orientation: "horizontal",
  },
  argTypes: {
    orientation: { control: "inline-radio", options: ["horizontal", "vertical"] },
  },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal = {
  render: () => (
    <div className="storybook-separator-demo" data-orientation="horizontal">
      <span>Current run</span>
      <Separator />
      <span>Retained history</span>
    </div>
  ),
} satisfies Story;

export const Vertical = {
  render: () => (
    <div className="storybook-separator-demo" data-orientation="vertical">
      <span>Active</span>
      <Separator orientation="vertical" />
      <span>Complete</span>
      <Separator orientation="vertical" />
      <span>Blocked</span>
    </div>
  ),
} satisfies Story;
