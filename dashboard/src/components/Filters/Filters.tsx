import type { Filter } from "@lib";
import { ToggleGroup, ToggleGroupItem } from "@layout";
import "./Filters.css";

export const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "ready", label: "Ready" },
  { value: "draft", label: "Draft" },
  { value: "complete", label: "Done" },
  { value: "all", label: "All" },
];

export function Filters({ filter, onFilterChange }: { filter: Filter; onFilterChange: (filter: Filter) => void }) {
  return (
    <ToggleGroup
      aria-label="Burnlist lifecycle"
      className="dashboard-filters"
      onValueChange={(value) => {
        if (value) onFilterChange(value as Filter);
      }}
      type="single"
      value={filter}
    >
      {FILTERS.map((entry) => <ToggleGroupItem key={entry.value} value={entry.value}>{entry.label}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}
