import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";

const variants = ["default", "secondary", "outline", "ghost", "link", "destructive"] as const;

const meta = {
  title: "UI/Badge",
  component: Badge,
  args: {
    children: "active",
    variant: "default",
  },
  argTypes: {
    variant: { control: "select", options: variants },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground = {} satisfies Story;

export const Variants = {
  render: () => (
    <div className="storybook-row">
      {variants.map((variant) => (
        <Badge key={variant} variant={variant}>{variant}</Badge>
      ))}
    </div>
  ),
} satisfies Story;

export const OvenStates = {
  render: () => (
    <div className="storybook-row">
      <Badge>captured</Badge>
      <Badge variant="secondary">modified</Badge>
      <Badge variant="outline">third-party Oven</Badge>
      <Badge variant="destructive">blocked</Badge>
    </div>
  ),
} satisfies Story;
