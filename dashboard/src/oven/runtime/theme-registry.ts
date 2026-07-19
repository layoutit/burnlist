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

const themes: Readonly<Record<string, OvenTheme>> = Object.freeze(Object.assign(Object.create(null), { checklist }));

export function getOvenTheme(theme: unknown): OvenTheme | undefined {
  return typeof theme === "string" ? themes[theme] : undefined;
}
