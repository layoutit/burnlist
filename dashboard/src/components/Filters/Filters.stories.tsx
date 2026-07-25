import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { PairPreview } from "../TerminalFrame/TerminalPairPreview";
import { Filters } from "./Filters";

const fixture = componentPairFixture.filters;
const meta = {
  title: "Patterns/Filters",
  component: Filters,
  args: { filter: fixture.selected.toLowerCase(), label: fixture.label, options: fixture.options },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type Filter = ComponentProps<typeof Filters>["filter"];

export const Lifecycle = {
  render: (args) => {
    const [filter, setFilter] = useState<Filter>(String(args.filter) as Filter);
    useEffect(() => setFilter(String(args.filter) as Filter), [args.filter]);
    return <PairPreview component="filters" terminalArgs={{ ...args, filter }}><Filters filter={filter} onFilterChange={setFilter} /></PairPreview>;
  },
} satisfies Story;
