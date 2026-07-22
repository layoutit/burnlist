import { BarChart3, List, Rows3 } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";

const meta = {
  title: "UI/ToggleGroup",
  component: ToggleGroup,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewMode = {
  render: () => (
    <ToggleGroup aria-label="Dashboard view" defaultValue="table" type="single">
      <ToggleGroupItem aria-label="Compact list" value="list"><List aria-hidden="true" /> List</ToggleGroupItem>
      <ToggleGroupItem aria-label="Table" value="table"><Rows3 aria-hidden="true" /> Table</ToggleGroupItem>
      <ToggleGroupItem aria-label="Chart" value="chart"><BarChart3 aria-hidden="true" /> Chart</ToggleGroupItem>
    </ToggleGroup>
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
