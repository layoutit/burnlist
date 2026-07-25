import { BarChart3, List, Rows3 } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";

const fixture = componentPairFixture.toggleGroup;
const meta = {
  title: "UI/ToggleGroup",
  component: ToggleGroup,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewMode = {
  render: () => (
    <PairPreview component="toggle-group">
      <ToggleGroup aria-label={fixture.label} defaultValue={fixture.selected.toLowerCase()} type="single">
        <ToggleGroupItem aria-label="Compact list" value="list"><List aria-hidden="true" /> {fixture.options[0]}</ToggleGroupItem>
        <ToggleGroupItem aria-label="Table" value="table"><Rows3 aria-hidden="true" /> {fixture.options[1]}</ToggleGroupItem>
        <ToggleGroupItem aria-label="Chart" value="chart"><BarChart3 aria-hidden="true" /> {fixture.options[2]}</ToggleGroupItem>
      </ToggleGroup>
    </PairPreview>
  ),
} satisfies Story;

export const Multiple = {
  render: () => (
    <ToggleGroup aria-label="Visible evidence" defaultValue={["exact", "visual"]} type="multiple">
      <ToggleGroupItem value="exact">Exact</ToggleGroupItem>
      <ToggleGroupItem value="visual">Visual</ToggleGroupItem>
      <ToggleGroupItem value="performance">Performance</ToggleGroupItem>
    </ToggleGroup>
  ),
} satisfies Story;
