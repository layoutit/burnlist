import type { FormEvent } from "react";
import { ToggleGroup } from "../ToggleGroup/ToggleGroup";

export type ChartMode = "current" | "delta";

export type FieldToolbarProps = {
  chart: ChartMode;
  sort: string;
  filter: string;
  changedUnavailable: boolean;
  changedReason: string;
  onSearchInput?: (value: string) => void;
  onSelectChart?: (mode: ChartMode) => void;
  onToggleSort?: () => void;
  onToggleFilter?: () => void;
};

function searchInputHandler(onSearchInput: FieldToolbarProps["onSearchInput"]) {
  return onSearchInput ? (event: FormEvent<HTMLInputElement>) => onSearchInput(event.currentTarget.value) : undefined;
}

export function FieldToolbar({
  chart,
  sort,
  filter,
  changedUnavailable,
  changedReason,
  onSearchInput,
  onSelectChart,
  onToggleSort,
  onToggleFilter,
}: FieldToolbarProps) {
  return <div id="driving-parity-controls" className="driving-parity-controls">
    <input
      id="driving-parity-field-search"
      type="search"
      placeholder="Search Fields..."
      aria-label="Differential Testing search fields"
      onInput={searchInputHandler(onSearchInput)}
    />
    <span className="control-sep" aria-hidden="true">|</span>
    <ToggleGroup id="driving-parity-chart-toggle" className="chart-toggle differential-tabs" ariaLabel="Differential Testing chart mode">
      <button type="button" data-driving-parity-chart="current" aria-label="Value chart view" title="Value chart view" aria-pressed={chart === "current"} onClick={() => onSelectChart?.("current")}>Value</button>
      <span className="sep" aria-hidden="true">·</span>
      <button type="button" data-driving-parity-chart="delta" aria-label="Delta chart view" title="Delta chart view" aria-pressed={chart === "delta"} onClick={() => onSelectChart?.("delta")}>Delta</button>
    </ToggleGroup>
    <span className="control-sep" aria-hidden="true">|</span>
    <ToggleGroup id="driving-parity-sort-toggle" className="chart-toggle sort-toggle differential-tabs" ariaLabel="Differential Testing sort">
      <button
        type="button"
        data-driving-parity-sort="improved"
        aria-pressed={sort === "changed"}
        disabled={changedUnavailable || undefined}
        title={changedUnavailable ? changedReason : undefined}
        onClick={onToggleSort}
      >Changed</button>
    </ToggleGroup>
    <span className="control-sep" aria-hidden="true">|</span>
    <ToggleGroup id="driving-parity-filter-toggle" className="chart-toggle filter-toggle differential-tabs" ariaLabel="Differential Testing field filter">
      <button type="button" data-driving-parity-filter="failing" aria-pressed={filter === "failing"} onClick={onToggleFilter}>Failed</button>
    </ToggleGroup>
  </div>;
}
