import { ovenFormatRegistry } from "../value-runtime";
import type { TerminalCapabilities } from "../terminal-contract";

/** Closed production allowlist: structural B5 plus implemented component families. */
export const TERMINAL_IMPLEMENTED_CAPABILITIES: TerminalCapabilities = Object.freeze({
  kinds: Object.freeze(["box", "grid", "stack", "panel", "text", "icon", "bind", "switch", "case", "option", "collection", "pagination", "mode-toggle", "search", "sort-toggle", "filter-toggle", "field-toolbar", "kpi-strip", "kpi-item", "progress-donut", "burn-donut", "waffle-metric", "progress-value", "log-table", "column", "section-header", "refresh-status", "domain-note", "differential-empty-state", "differential-kpi-strip", "differential-log-table", "progress-chart", "frame-delta-chart", "field-list", "verdict-header", "domain-tabs", "metric-tiles", "frame-card", "streaming-diff-heading", "diff-card"]),
  components: Object.freeze(["box", "kpi-strip", "kpi-item", "progress-donut", "burn-donut", "waffle-metric", "progress-value", "log-table", "section-header", "refresh-status", "domain-note", "differential-empty-state", "differential-kpi-strip", "differential-log-table", "progress-chart", "frame-delta-chart", "field-list", "verdict-header", "domain-tabs", "metric-tiles", "frame-card", "streaming-diff-heading", "diff-card"]),
  formats: Object.freeze(Object.keys(ovenFormatRegistry)),
  icons: Object.freeze(["ClipboardList", "Clock3", "Gauge", "TimerReset"]),
  selectors: Object.freeze(["changed", "non-pass"]),
});
