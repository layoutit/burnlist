import { ovenFormatRegistry } from "../value-runtime";
import type { TerminalCapabilities } from "../terminal-contract";

/** Closed production allowlist: structural B5 plus implemented component families. */
export const TERMINAL_IMPLEMENTED_CAPABILITIES: TerminalCapabilities = Object.freeze({
  kinds: Object.freeze(["box", "grid", "stack", "panel", "text", "icon", "bind", "kpi-strip", "kpi-item", "progress-donut", "burn-donut", "waffle-metric", "progress-value", "log-table", "column", "section-header", "refresh-status", "domain-note", "differential-empty-state", "verdict-header", "domain-tabs", "metric-tiles", "frame-card"]),
  components: Object.freeze(["box", "kpi-strip", "kpi-item", "progress-donut", "burn-donut", "waffle-metric", "progress-value", "log-table", "section-header", "refresh-status", "domain-note", "differential-empty-state", "verdict-header", "domain-tabs", "metric-tiles", "frame-card"]),
  formats: Object.freeze(Object.keys(ovenFormatRegistry)),
  icons: Object.freeze(["ClipboardList", "Clock3", "Gauge", "TimerReset"]),
  selectors: Object.freeze([]),
});
