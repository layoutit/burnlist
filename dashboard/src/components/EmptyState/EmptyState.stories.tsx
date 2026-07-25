import { Inbox } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { PairPreview } from "../TerminalFrame/TerminalPairPreview";
import { EmptyState } from "./EmptyState";

const fixture = componentPairFixture.emptyState;
const meta = {
  title: "Patterns/EmptyState",
  component: EmptyState,
  args: {
    title: fixture.title,
    detail: fixture.detail,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
  render: (args) => <PairPreview component="empty-state" terminalArgs={args}><EmptyState {...args} /></PairPreview>,
} satisfies Story;
export const CustomIcon = { args: { icon: Inbox, title: "No retained runs" } } satisfies Story;
