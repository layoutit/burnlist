import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Separator } from "./Separator";

const fixture = componentPairFixture.separator;
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
    <PairPreview component="separator">
      <div className="storybook-separator-demo" data-orientation="horizontal">
        <span>{fixture.before}</span>
        <Separator />
        <span>{fixture.after}</span>
      </div>
    </PairPreview>
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
