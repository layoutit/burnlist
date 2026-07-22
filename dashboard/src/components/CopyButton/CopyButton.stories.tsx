import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyButton } from "./CopyButton";

const meta = {
  title: "Patterns/CopyButton",
  component: CopyButton,
  args: { text: "npm run verify" },
  parameters: { layout: "centered" },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {} satisfies Story;
