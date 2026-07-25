import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Progress } from "./Progress";

const fixture = componentPairFixture.progress;
const meta = {
  title: "UI/Progress",
  component: Progress,
  args: {
    "aria-label": fixture.label,
    value: fixture.value,
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground = {
  render: (args) => (
    <PairPreview component="progress">
      <div className="storybook-progress-demo"><Progress {...args} /></div>
    </PairPreview>
  ),
} satisfies Story;

export const States = {
  render: () => (
    <div className="storybook-stack storybook-progress-demo">
      {[0, 24, 68, 100].map((value) => (
        <div className="storybook-progress-line" key={value}>
          <span className="storybook-progress-value">{value}%</span>
          <Progress aria-label={`${value}% complete`} value={value} />
        </div>
      ))}
    </div>
  ),
} satisfies Story;
