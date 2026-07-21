import { buildFrameDeltaChart } from "./frame-delta-chart-geometry";
import type { FrameDeltaLabel, FrameDeltaLine, FrameDeltaMetrics } from "./frame-delta-chart-geometry";

export type DifferentialFrameDeltaChartProps = {
  metrics: FrameDeltaMetrics;
  hostOnly?: boolean;
  hostClassName?: string;
  hostRole?: "img";
  hostAriaLabel?: string;
};

function ChartLine({ line }: { line: FrameDeltaLine }) {
  return <line className={line.className} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />;
}

function ChartLabel({ label }: { label: FrameDeltaLabel }) {
  return <text className={label.className} x={label.x} y={label.y} textAnchor={label.textAnchor} dominantBaseline={label.dominantBaseline}>{label.text}</text>;
}

export function DifferentialFrameDeltaChart({ metrics, hostOnly = false, hostClassName, hostRole, hostAriaLabel }: DifferentialFrameDeltaChartProps) {
  if (hostOnly) return <svg id="progress-chart" className={hostClassName} viewBox="0 0 640 200" role={hostRole} aria-label={hostAriaLabel ?? "Exact-prefix frame delta metrics unavailable"} />;
  const geometry = buildFrameDeltaChart(metrics);
  return <svg id={geometry.root.id} viewBox={geometry.root.viewBox} aria-label={geometry.root.ariaLabel} className={geometry.root.className}>
    {!geometry.cleared && <>
      {geometry.bands.map((band, index) => <rect key={`band-${index}`} className={band.className} x={band.x} y={band.y} width={band.width} height={band.height} />)}
      {geometry.yLabels.flatMap((label, index) => [
        ...(index === 1 ? [] : [<ChartLine key={`grid-${index}`} line={geometry.gridLines[index === 0 ? 0 : 1]} />]),
        <ChartLabel key={`y-label-${index}`} label={label} />,
      ])}
      {geometry.xLabels.flatMap((label, index) => [
        <ChartLine key={`x-grid-${index}`} line={geometry.xGridLines[index]} />,
        <ChartLabel key={`x-label-${index}`} label={label} />,
      ])}
      {geometry.zeroLine && <ChartLine line={geometry.zeroLine} />}
      {geometry.passPath && <path className={geometry.passPath.className} d={geometry.passPath.d} />}
      {geometry.failPath && <path className={geometry.failPath.className} d={geometry.failPath.d} />}
      {geometry.firstFailingLabels.map((label, index) => <ChartLabel key={`first-failing-${index}`} label={label} />)}
    </>}
  </svg>;
}
