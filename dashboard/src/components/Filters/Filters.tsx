import type { Filter } from "@lib";
import { Tabs, TabsList, TabsTrigger } from "@layout";

export const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "ready", label: "Ready" },
  { value: "draft", label: "Draft" },
  { value: "complete", label: "Done" },
  { value: "all", label: "All" },
];

export function Filters({ filter, onFilterChange }: { filter: Filter; onFilterChange: (filter: Filter) => void }) {
  return (
    <Tabs className="dashboard-filters" onValueChange={(value) => onFilterChange(value as Filter)} value={filter}>
      <TabsList aria-label="Burnlist lifecycle" variant="line">
        {FILTERS.map((entry) => <TabsTrigger key={entry.value} value={entry.value}>{entry.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
}
