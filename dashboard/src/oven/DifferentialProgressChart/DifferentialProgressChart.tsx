import { buildDifferentialProgressChart } from "./progress-chart-geometry";
import type { DifferentialProgressChartHistoryPoint, DifferentialProgressChartOptions, DifferentialProgressChartPrimitive } from "./progress-chart-geometry";

export type DifferentialProgressChartProps = DifferentialProgressChartOptions & {
  history: DifferentialProgressChartHistoryPoint[];
  hostOnly?: boolean;
  hostClassName?: string;
  hostRole?: "img";
  hostAriaLabel?: string;
};

function Primitive({ primitive }: { primitive: DifferentialProgressChartPrimitive }) {
  const { tag: Tag, attrs, className, text, children } = primitive;
  const props = Object.fromEntries(Object.entries(attrs ?? {}).map(([key, value]) => [key === "text-anchor" ? "textAnchor" : key === "dominant-baseline" ? "dominantBaseline" : key, value]));
  if (Tag === "title") return <title {...props}>{text}</title>;
  return <Tag className={className} {...props}>{text ?? null}{children?.map((child, index) => <Primitive key={index} primitive={child} />)}</Tag>;
}

export function DifferentialProgressChart({ history, mode = "failed", timeScale = "compact", hostOnly = false, hostClassName, hostRole, hostAriaLabel }: DifferentialProgressChartProps) {
  if (hostOnly) return <svg id="progress-chart" className={hostClassName} viewBox="0 0 640 200" role={hostRole} aria-label={hostAriaLabel ?? "Completion percentage over time"} />;
  const geometry = buildDifferentialProgressChart(history, { mode, timeScale });
  return <svg id={geometry.root.id} viewBox={geometry.root.viewBox} aria-label={geometry.root.ariaLabel} className={geometry.root.className} {...Object.fromEntries(Object.entries(geometry.root.data).map(([key, value]) => [`data-${key}`, value]))}>
    {geometry.primitives.map((primitive, index) => <Primitive key={index} primitive={primitive} />)}
  </svg>;
}
