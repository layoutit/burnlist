import type { Meta, StoryObj } from "@storybook/react-vite";
import { TerminalFramePreview } from "./TerminalFrame";

const meta = {
  title: "Patterns/Terminal frame",
  component: TerminalFramePreview,
  args: { viewport: 42, interaction: "initial", animation: "t0", motion: "full" },
  argTypes: {
    viewport: { control: "select", options: [42, 64] },
    interaction: { control: "select", options: ["initial", "right"] },
    animation: { control: "select", options: ["t0", "t240"] },
    motion: { control: "select", options: ["full", "reduced"] },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TerminalFramePreview>;

export default meta;
export const GlyphcssFixture: StoryObj<typeof meta> = {};
