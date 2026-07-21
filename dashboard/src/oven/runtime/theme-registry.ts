import type { JsonValue, OvenViewDef } from "../OvenView/types";
import { checklistKpiItemClassName } from "../KpiItem/KpiItem";
import { checklistKpiStripAriaLabel, checklistKpiStripClassName } from "../KpiStrip/KpiStrip";

type ThemeComponentDefaults = Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
type ThemeRegion = Readonly<{
  kinds: readonly string[];
  element: "section" | "div" | "fragment";
  className?: string;
  props?: Readonly<Record<string, JsonValue>>;
}>;

export type OvenTheme = Readonly<{
  view: Pick<OvenViewDef, "shellClassName" | "bodyClassName" | "bodyId">;
  components: ThemeComponentDefaults;
  regions: readonly ThemeRegion[];
  kpiItemVariants: Readonly<Record<string, string>>;
  progressKpiClassName: string;
  runtimeLayout?: "differential-testing";
}>;

const checklist: OvenTheme = Object.freeze({
  view: Object.freeze({
    shellClassName: "shell detail-view-shell driving-parity-view checklist-detail-shell",
    bodyClassName: "detail-view",
    bodyId: "burnlist-detail",
  }),
  components: Object.freeze({
    "kpi-strip": Object.freeze({
      ariaLabel: checklistKpiStripAriaLabel,
      className: checklistKpiStripClassName,
    }),
    "kpi-item": Object.freeze({ className: checklistKpiItemClassName }),
  }),
  regions: Object.freeze([
    Object.freeze({ kinds: Object.freeze(["kpi-strip"]), element: "section", className: "differential-overview checklist-overview" }),
    Object.freeze({ kinds: Object.freeze(["checklist-ledger", "checklist-burn-panel"]), element: "div", className: "detail-workspace checklist-progress-workspace", props: Object.freeze({ "data-detail-tab": "dashboard" }) }),
    Object.freeze({ kinds: Object.freeze(["checklist-event-cards"]), element: "fragment" }),
  ]),
  kpiItemVariants: Object.freeze({ current: "checklist-kpi-current" }),
  progressKpiClassName: "driving-parity-kpi-progress",
});

const streamingDiff: OvenTheme = Object.freeze({
  view: Object.freeze({}),
  components: Object.freeze({}),
  regions: Object.freeze([
    Object.freeze({ kinds: Object.freeze(["streaming-diff-heading", "diff-card"]), element: "section", className: "streaming-diff-view" }),
  ]),
  kpiItemVariants: Object.freeze({}),
  progressKpiClassName: "",
});

const visualParity: OvenTheme = Object.freeze({
  view: Object.freeze({}),
  components: Object.freeze({}),
  regions: Object.freeze([
    Object.freeze({ kinds: Object.freeze(["verdict-header", "domain-tabs", "metric-tiles", "domain-note", "frame-card"]), element: "section", className: "visual-parity-page" }),
  ]),
  kpiItemVariants: Object.freeze({}),
  progressKpiClassName: "",
});

const differentialTesting: OvenTheme = Object.freeze({
  view: Object.freeze({
    shellClassName: "shell driving-parity-view",
  }),
  components: Object.freeze({
    "kpi-strip": Object.freeze({
      id: "driving-parity-kpi-strip",
      ariaLabel: "Differential Testing field KPIs",
      className: "driving-parity-kpi-strip has-burns",
    }),
    "kpi-item": Object.freeze({
      className: "driving-parity-kpi-item driving-parity-kpi-section",
    }),
    "progress-donut": Object.freeze({
      className: "driving-parity-kpi-gauge driving-parity-kpi-progress-donut",
    }),
    "progress-chart": Object.freeze({
      hostOnly: true,
      hostClassName: "chart",
      hostRole: "img",
      hostAriaLabel: "Completion percentage over time",
    }),
    "frame-delta-chart": Object.freeze({
      hostOnly: true,
      hostClassName: "chart",
      hostRole: "img",
      hostAriaLabel: "Completion percentage over time",
    }),
  }),
  regions: Object.freeze([
    Object.freeze({ kinds: Object.freeze(["refresh-status", "differential-kpi-strip"]), element: "section", className: "differential-overview", props: Object.freeze({ id: "differential-overview" }) }),
    Object.freeze({ kinds: Object.freeze(["mode-toggle", "switch", "differential-log-table"]), element: "div", className: "detail-workspace", props: Object.freeze({ id: "detail-workspace", "data-detail-tab": "dashboard" }) }),
    Object.freeze({ kinds: Object.freeze(["field-toolbar", "collection"]), element: "main", className: "driving-parity-page", props: Object.freeze({ id: "driving-parity-page" }) }),
  ]),
  kpiItemVariants: Object.freeze({
    scenario: "driving-parity-kpi-scenario",
    burns: "driving-parity-kpi-burns",
    fields: "driving-parity-kpi-fields",
    frames: "driving-parity-kpi-frames",
  }),
  progressKpiClassName: "driving-parity-kpi-progress",
  runtimeLayout: "differential-testing",
});

const themes: Readonly<Record<string, OvenTheme>> = Object.freeze(Object.assign(Object.create(null), {
  checklist,
  "streaming-diff": streamingDiff,
  "visual-parity": visualParity,
  "differential-testing": differentialTesting,
}));

export function getOvenTheme(theme: unknown): OvenTheme | undefined {
  return typeof theme === "string" ? themes[theme] : undefined;
}
