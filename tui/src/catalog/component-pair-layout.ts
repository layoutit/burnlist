import type { ComponentPairId } from "./component-pair-fixture";
import { fieldCardPairLayout, topCardPairLayout } from "../oven-runtime/components/paired-layout";
export * from "../oven-runtime/components/paired-layout";

export type PairRegion = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  tone: "surface";
}>;

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
