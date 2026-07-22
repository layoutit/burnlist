import type { Meta, StoryObj } from "@storybook/react-vite";
import { Progress } from "./Progress";

const meta = {
  title: "UI/Progress",
  component: Progress,
  args: {
    "aria-label": "Burnlist completion",
    value: 68,
  },
  decorators: [
    (Story) => <div className="storybook-progress-demo"><Story /></div>,
  ],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground = {} satisfies Story;

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
