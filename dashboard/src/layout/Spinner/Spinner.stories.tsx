import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { Spinner } from "./Spinner";

const meta = {
  title: "UI/Spinner",
  component: Spinner,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes = {
  render: () => (
    <div className="storybook-row">
      <Spinner label="Loading small result" size="sm" />
      <Spinner label="Loading result" />
      <Spinner label="Loading large result" size="lg" />
    </div>
  ),
} satisfies Story;

export const InButton = {
  render: () => <Button disabled><Spinner label="Creating run" size="sm" /> Creating…</Button>,
} satisfies Story;
