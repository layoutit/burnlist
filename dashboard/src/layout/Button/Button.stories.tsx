import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "./Button";

const variants = ["default", "secondary", "outline", "ghost", "link", "destructive"] as const;
const sizes = ["xs", "sm", "default", "lg"] as const;

const meta = {
  title: "UI/Button",
  component: Button,
  args: {
    children: "Run burn",
    size: "default",
    variant: "default",
  },
  argTypes: {
    variant: { control: "select", options: variants },
    size: {
      control: "select",
      options: [...sizes, "icon-xs", "icon-sm", "icon", "icon-lg"],
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground = {} satisfies Story;

export const Variants = {
  render: () => (
    <div className="storybook-row">
      {variants.map((variant) => (
        <Button key={variant} variant={variant}>{variant}</Button>
      ))}
    </div>
  ),
} satisfies Story;

export const Sizes = {
  render: () => (
    <div className="storybook-row">
      {sizes.map((size) => (
        <Button key={size} size={size}>{size}</Button>
      ))}
    </div>
  ),
} satisfies Story;

export const WithIcon = {
  render: () => (
    <div className="storybook-row">
      <Button><Plus aria-hidden="true" />New Oven</Button>
      <Button aria-label="Delete Oven" size="icon" variant="destructive">
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  ),
} satisfies Story;

export const AsLink = {
  render: () => (
    <Button asChild variant="outline">
      <a href="#storybook-button-link">Open Oven <ExternalLink aria-hidden="true" /></a>
    </Button>
  ),
} satisfies Story;

export const Disabled = {
  args: {
    children: "Unavailable",
    disabled: true,
  },
} satisfies Story;
