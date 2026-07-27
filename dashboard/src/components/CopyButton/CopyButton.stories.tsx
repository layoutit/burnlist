import type { Meta, StoryObj } from "@storybook/react-vite";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { PairPreview } from "../TerminalFrame/TerminalPairPreview";
import { CopyButton } from "./CopyButton";

const fixture = componentPairFixture.copyButton;
const meta = {
  title: "Patterns/CopyButton",
  component: CopyButton,
  args: { text: fixture.value },
  parameters: { layout: "centered" },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
  render: (args) => <PairPreview component="copy-button" terminalArgs={{ ...args, value: args.text }}><CopyButton aria-label="Copy instructions" text={String(args.text)} /></PairPreview>,
} satisfies Story;
