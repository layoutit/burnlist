import type { ComponentPairId } from "./component-pair-fixture";

export const FIELD_CARD_BREAKPOINT = 56;

export type PairRegion = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  tone: "surface";
}>;

export type FieldCardLayout = Readonly<{
  narrow: boolean;
  starts: readonly number[];
  cardHeight: number;
  metadataX: number;
  metadataWidth: number;
  chartX: number;
  chartWidth: number;
  chartOffsetY: number;
  chartHeight: number;
}>;

/** One layout authority for the OpenTUI surface, browser adapter, and tests. */
export function fieldCardPairLayout(width: number): FieldCardLayout {
  const safeWidth = Math.max(12, Math.floor(width));
  const narrow = safeWidth < FIELD_CARD_BREAKPOINT;
  const metadataWidth = narrow
    ? safeWidth - 2
    : Math.max(24, Math.min(Math.floor(safeWidth * 0.46), safeWidth - 24));
  const chartX = narrow ? 1 : metadataWidth + 1;
  return {
    narrow,
    starts: [0, 8],
    cardHeight: 7,
    metadataX: 1,
    metadataWidth,
    chartX,
    chartWidth: Math.max(3, narrow ? safeWidth - 2 : safeWidth - chartX - 1),
    chartOffsetY: narrow ? 2 : 0,
    chartHeight: narrow ? 5 : 6,
  };
}

export function componentPairRegions(id: ComponentPairId, width: number, height: number): readonly PairRegion[] {
  if (id === "field-list-cards") {
    const layout = fieldCardPairLayout(width);
    return layout.starts
      .map((y) => ({ x: 0, y, width, height: Math.min(layout.cardHeight, height - y), tone: "surface" as const }))
      .filter((region) => region.height > 0);
  }
  if (id === "top-card") return [
    { x: 0, y: 0, width, height: Math.min(2, height), tone: "surface" as const },
    { x: 0, y: 3, width, height: Math.max(0, Math.min(6, height - 3)), tone: "surface" as const },
    { x: 0, y: Math.max(0, height - 2), width, height: Math.min(2, height), tone: "surface" as const },
  ].filter((region) => region.height > 0);
  if (id === "line-chart") return [{ x: 0, y: 0, width, height, tone: "surface" }];
  if (["kpi-strip", "kpi-item", "progress-donut", "burn-donut", "waffle-metric"].includes(id)) {
    return [{ x: 0, y: 0, width, height, tone: "surface" }];
  }
  return [];
}
