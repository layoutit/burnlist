import { fitText } from "./theme";
import { useTerminalPalette } from "./terminal-accessibility";
import {
  bucketTerminalSeries,
  terminalSeriesChartFrame,
  terminalSeriesLevels,
  type TerminalChartPoint,
} from "./terminal-series-chart-model";
import "./glyph-surface";

export {
  bucketTerminalSeries,
  terminalSeriesChartFrame,
  terminalSeriesChartFrame as terminalLineChartFrame,
  type TerminalChartPoint,
} from "./terminal-series-chart-model";

export function TerminalSeriesChart({ height, points, title, width }: {
  height: number;
  points: readonly TerminalChartPoint[];
  title: string;
  width: number;
}) {
  const palette = useTerminalPalette(), rows = Math.max(2, Math.floor(height));
  if (rows < 5) {
    const compactSeries = bucketTerminalSeries(points, Math.max(1, width - 2));
    const max = Math.max(0.0001, ...compactSeries.map((point) => Math.abs(point.value)));
    return <box width={width} height={rows} flexDirection="column" overflow="hidden">
      <text fg={palette.muted}>{fitText(title, width)}</text>
      <text>{compactSeries.map((point) => <span key={`${point.label}-${point.value}`} fg={point.state === "fail" ? palette.red : palette.green}>{terminalSeriesLevels[Math.min(7, Math.round(Math.abs(point.value) / max * 7))]}</span>)}</text>
    </box>;
  }
  const frame = terminalSeriesChartFrame(points, width, rows - 1, palette);
  return <box width={width} height={rows} flexDirection="column" overflow="hidden">
    <text fg={palette.muted}>{fitText(title, width)}</text>
    <glyphSurface frame={frame} width={frame.cols} height={frame.rows} />
  </box>;
}

export const TerminalLineChart = TerminalSeriesChart;
