import { useEffect, useState } from "react";
import { BarChart3, List, Rows3 } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";

const fixture = componentPairFixture.toggleGroup;
const meta = {
  title: "UI/ToggleGroup",
  component: ToggleGroup,
  args: { label: fixture.label, options: fixture.options, selected: fixture.selected },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewMode = {
  render: (args) => {
    const [selected, setSelected] = useState(String(args.selected));
    useEffect(() => setSelected(String(args.selected)), [args.selected]);
    const options = Array.isArray(args.options) ? args.options.map(String) : [...fixture.options];
    return <PairPreview component="toggle-group" terminalArgs={{ ...args, options, selected }}>
      <ToggleGroup aria-label={String(args.label)} onValueChange={(next) => next && setSelected(next)} type="single" value={selected.toLowerCase()}>
        <ToggleGroupItem aria-label="List" value="list"><List aria-hidden="true" /> {options[0] ?? "List"}</ToggleGroupItem>
        <ToggleGroupItem aria-label="Table" value="table"><Rows3 aria-hidden="true" /> {options[1] ?? "Table"}</ToggleGroupItem>
        <ToggleGroupItem aria-label="Chart" value="chart"><BarChart3 aria-hidden="true" /> {options[2] ?? "Chart"}</ToggleGroupItem>
      </ToggleGroup>
    </PairPreview>;
  },
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
