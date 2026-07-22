import { Inbox } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Patterns/EmptyState",
  component: EmptyState,
  args: {
    title: "No active Burnlists",
    detail: "Draft a Burnlist or change the lifecycle filter to see other work.",
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {} satisfies Story;
export const CustomIcon = { args: { icon: Inbox, title: "No retained runs" } } satisfies Story;
