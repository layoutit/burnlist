import type { Filter } from "@lib";

export const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "ready", label: "Ready" },
  { value: "draft", label: "Draft" },
  { value: "complete", label: "Done" },
  { value: "all", label: "All" },
];

export function Filters({ filter, onFilterChange }: { filter: Filter; onFilterChange: (filter: Filter) => void }) {
  return (
    <div aria-label="Oven lifecycle" className="dashboard-filters" role="tablist">
      {FILTERS.map((entry, index) => (
        <span className="dashboard-filter-item" key={entry.value}>
          {index > 0 ? <span aria-hidden="true" className="dashboard-filter-separator">·</span> : null}
          <button aria-selected={filter === entry.value} className="dashboard-filter-button" onClick={() => onFilterChange(entry.value)} role="tab" type="button">
            {entry.label}
          </button>
        </span>
      ))}
    </div>
  );
}
