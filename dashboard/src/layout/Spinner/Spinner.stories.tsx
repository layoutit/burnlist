import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Button } from "../Button";
import { Spinner } from "./Spinner";

const fixture = componentPairFixture.spinner;
const meta = {
  title: "UI/Spinner",
  component: Spinner,
  args: { label: fixture.label, size: "default", reducedMotion: false },
  argTypes: {
    size: { control: "inline-radio", options: ["sm", "default", "lg"] },
    reducedMotion: { control: "boolean" },
  },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground = {
  render: (args) => (
    <PairPreview component="spinner" terminalArgs={args}>
      <div className="storybook-row" data-reduced-motion={String(args.reducedMotion)}>
        <Spinner label={String(args.label)} size={args.size as "sm" | "default" | "lg"} />
      </div>
    </PairPreview>
  ),
} satisfies Story;

export const InButton = {
  render: () => <Button disabled><Spinner label="Creating run" size="sm" /> Creating…</Button>,
} satisfies Story;
