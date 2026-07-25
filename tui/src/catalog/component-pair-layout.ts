import type { ComponentPairId } from "./component-pair-fixture";

export const FIELD_CARD_BREAKPOINT = 56;
export const TOP_CARD_BREAKPOINT = 58;
export const FIELD_CARD_TRACKS = Object.freeze({ metadata: 0.3, chart: 0.7, chartRows: 3 });
export const TOP_CARD_TRACKS = Object.freeze({ log: 0.5, chart: 0.5, chartRows: 6 });

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

export type TopCardLayout = Readonly<{
  narrow: boolean;
  dividerY: number;
  bodyY: number;
  logX: number;
  logY: number;
  logWidth: number;
  logHeight: number;
  chartX: number;
  chartY: number;
  chartWidth: number;
  chartHeight: number;
}>;

/** One layout authority for the OpenTUI surface, browser adapter, and tests. */
export function fieldCardPairLayout(width: number): FieldCardLayout {
  const safeWidth = Math.max(12, Math.floor(width));
  const narrow = safeWidth < FIELD_CARD_BREAKPOINT;
  const metadataWidth = narrow
    ? safeWidth - 2
    : Math.max(16, Math.min(Math.floor(safeWidth * FIELD_CARD_TRACKS.metadata), safeWidth - 24));
  const chartX = narrow ? 1 : metadataWidth + 1;
  return {
    narrow,
    starts: narrow ? [0, 6] : [0, 5],
    cardHeight: narrow ? 5 : 4,
    metadataX: 1,
    metadataWidth,
    chartX,
    chartWidth: Math.max(3, narrow ? safeWidth - 2 : safeWidth - chartX - 1),
    chartOffsetY: narrow ? 2 : 1,
    chartHeight: FIELD_CARD_TRACKS.chartRows,
  };
}

export function topCardPairLayout(width: number, height: number): TopCardLayout {
  const safeWidth = Math.max(20, Math.floor(width)), safeHeight = Math.max(12, Math.floor(height));
  const narrow = safeWidth < TOP_CARD_BREAKPOINT;
  const dividerY = 3, bodyY = 4;
  if (narrow) {
    const logHeight = 6, chartY = bodyY + logHeight + 1;
    return {
      narrow, dividerY, bodyY,
      logX: 1, logY: bodyY, logWidth: safeWidth - 2, logHeight,
      chartX: 1, chartY, chartWidth: safeWidth - 2, chartHeight: Math.max(2, Math.min(TOP_CARD_TRACKS.chartRows, safeHeight - chartY)),
    };
  }
  const logWidth = Math.max(22, Math.floor((safeWidth - 3) * TOP_CARD_TRACKS.log)), chartX = logWidth + 2;
  const bodyHeight = Math.max(2, Math.min(TOP_CARD_TRACKS.chartRows + 1, safeHeight - bodyY));
  return {
    narrow, dividerY, bodyY,
    logX: 1, logY: bodyY, logWidth, logHeight: bodyHeight,
    chartX, chartY: bodyY, chartWidth: Math.max(8, safeWidth - chartX - 1), chartHeight: bodyHeight,
  };
}

export function componentPairRegions(id: ComponentPairId, width: number, height: number): readonly PairRegion[] {
  if (id === "field-list-cards") {
    const layout = fieldCardPairLayout(width);
    return layout.starts
      .map((y) => ({ x: 0, y, width, height: Math.min(layout.cardHeight, height - y), tone: "surface" as const }))
      .filter((region) => region.height > 0);
  }
  if (id === "top-card") {
    const layout = topCardPairLayout(width, height);
    return [
      { x: 0, y: 0, width, height: 3, tone: "surface" as const },
      { x: layout.logX, y: layout.logY, width: layout.logWidth, height: layout.logHeight, tone: "surface" as const },
      { x: layout.chartX, y: layout.chartY, width: layout.chartWidth, height: layout.chartHeight, tone: "surface" as const },
    ].filter((region) => region.height > 0);
  }
  if (id === "line-chart") return [{ x: 0, y: 0, width, height, tone: "surface" }];
  if (["kpi-strip", "kpi-item", "progress-donut", "burn-donut"].includes(id)) {
    return [{ x: 0, y: 0, width, height, tone: "surface" }];
  }
  return [];
}
