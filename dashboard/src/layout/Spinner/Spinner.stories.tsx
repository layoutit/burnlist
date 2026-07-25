import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Button } from "../Button";
import { Spinner } from "./Spinner";

const fixture = componentPairFixture.spinner;
const meta = {
  title: "UI/Spinner",
  component: Spinner,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground = {
  render: () => (
    <PairPreview component="spinner">
      <div className="storybook-row">
        <Spinner label="Loading small result" size="sm" />
        <Spinner label={fixture.label} />
        <Spinner label="Loading large result" size="lg" />
      </div>
    </PairPreview>
  ),
} satisfies Story;

export const InButton = {
  render: () => <Button disabled><Spinner label="Creating run" size="sm" /> Creating…</Button>,
} satisfies Story;
