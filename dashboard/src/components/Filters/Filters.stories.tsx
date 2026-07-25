import { useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { PairPreview } from "../TerminalFrame/TerminalPairPreview";
import { Filters } from "./Filters";

const fixture = componentPairFixture.filters;
const meta = {
  title: "Patterns/Filters",
  component: Filters,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Filters>;

export default meta;
type Story = StoryObj<typeof meta>;
type Filter = ComponentProps<typeof Filters>["filter"];

export const Lifecycle = {
  render: () => {
    const [filter, setFilter] = useState<Filter>(fixture.selected.toLowerCase() as Filter);
    return <PairPreview component="filters"><Filters filter={filter} onFilterChange={setFilter} /></PairPreview>;
  },
} satisfies Story;
