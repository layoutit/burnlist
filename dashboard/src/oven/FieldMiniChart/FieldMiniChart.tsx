import { buildFieldMiniChart, FIELD_MINI_CHART_HEIGHT, FIELD_MINI_CHART_WIDTH } from "./field-mini-chart-geometry";
import type { FieldMiniChartField } from "./field-mini-chart-geometry";

export type FieldMiniChartProps = {
  field: FieldMiniChartField;
  showFrameLabels: boolean;
  chartMode: string;
};

export function FieldMiniChart({ field, showFrameLabels, chartMode }: FieldMiniChartProps) {
  const geometry = buildFieldMiniChart(field, showFrameLabels, chartMode);
  if (geometry.empty) return <div className="plot" />;
  return <div className="plot">
    <svg viewBox={`0 0 ${FIELD_MINI_CHART_WIDTH} ${FIELD_MINI_CHART_HEIGHT}`} preserveAspectRatio="none">
      {geometry.bands.map((band, index) => <rect key={`band-${index}`} x={band.x} y={band.y} width={band.width} height={band.height} fill={band.fill} opacity={band.opacity} />)}
      {geometry.ticks.map((tick, index) => <line key={`tick-${index}`} className="frame-tick" x1={tick.x1} x2={tick.x2} y1={tick.y1} y2={tick.y2} stroke={tick.stroke} strokeWidth={tick.strokeWidth} vectorEffect={tick.vectorEffect} shapeRendering={tick.shapeRendering} />)}
      {geometry.lines.map((line, index) => <line key={`line-${index}`} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} stroke={line.stroke} strokeWidth={line.strokeWidth} strokeDasharray={line.strokeDasharray} opacity={line.opacity} vectorEffect={line.vectorEffect} />)}
      {geometry.paths.map((path, index) => <path key={`path-${index}`} d={path.d} fill={path.fill} stroke={path.stroke} strokeWidth={path.strokeWidth} strokeDasharray={path.strokeDasharray} strokeDashoffset={path.strokeDashoffset} opacity={path.opacity} vectorEffect={path.vectorEffect} />)}
    </svg>
    {geometry.tickLabels.map((label, index) => <span key={`label-${index}`} className="frame-tick-label" style={{ left: `${label.left}%` }}>{label.text}</span>)}
  </div>;
}
