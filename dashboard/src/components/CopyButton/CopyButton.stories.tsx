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
  decorators: [
    (Story) => <PairPreview component="copy-button"><Story /></PairPreview>,
  ],
} satisfies Story;
