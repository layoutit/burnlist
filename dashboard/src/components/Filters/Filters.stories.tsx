import { useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Filters } from "./Filters";

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
    const [filter, setFilter] = useState<Filter>("active");
    return <Filters filter={filter} onFilterChange={setFilter} />;
  },
} satisfies Story;
