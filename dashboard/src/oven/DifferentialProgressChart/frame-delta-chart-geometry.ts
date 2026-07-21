import { rollingStandardDeviationScores } from "../differential-testing-render/differential-testing-progress-chart.js";

export const FRAME_DELTA_CHART_WIDTH = 640;
export const FRAME_DELTA_CHART_HEIGHT = 200;

export type FrameDeltaMetrics = {
  frameDeviationRatios?: number[];
  firstFailingFrame?: number | string | null;
};

export type FrameDeltaBand = {
  className: "frame-delta-pass-band" | "frame-delta-fail-band";
  x: string;
  y: "0";
  width: string;
  height: "200";
};

export type FrameDeltaLine = {
  className: "grid-line" | "grid-line x-grid-line" | "delta-zero-line";
  x1: string;
  x2: string;
  y1: string;
  y2: string;
};

export type FrameDeltaLabel = {
  className: string;
  x: string;
  y: string;
  textAnchor: "end" | "middle" | "start";
  dominantBaseline?: "central";
  text: string;
};

export type FrameDeltaPath = {
  className: "frame-delta-line-pass" | "frame-delta-line-fail";
  d: string;
};

export type FrameDeltaChartGeometry = {
  root: {
    id: "progress-chart";
    viewBox: "0 0 640 200";
    ariaLabel: "Current-run overall frame deviation residual normalized by a 31-frame rolling standard deviation";
    className: "delta-chart";
  };
  cleared: boolean;
  bands: FrameDeltaBand[];
  gridLines: FrameDeltaLine[];
  yLabels: FrameDeltaLabel[];
  xGridLines: FrameDeltaLine[];
  xLabels: FrameDeltaLabel[];
  zeroLine: FrameDeltaLine | null;
  passPath: FrameDeltaPath | null;
  failPath: FrameDeltaPath | null;
  firstFailingLabels: FrameDeltaLabel[];
};

function formatRatio(value: number): string {
  const digits = Math.abs(value) >= 1 ? 4 : 5;
  return Number(value).toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function buildFrameDeltaChart(metrics: FrameDeltaMetrics): FrameDeltaChartGeometry {
  const root = {
    id: "progress-chart" as const,
    viewBox: "0 0 640 200" as const,
    ariaLabel: "Current-run overall frame deviation residual normalized by a 31-frame rolling standard deviation" as const,
    className: "delta-chart" as const,
  };
  const ratios = Array.isArray(metrics?.frameDeviationRatios)
    ? metrics.frameDeviationRatios.map((value) => Math.max(0, Number(value) || 0))
    : [];
  const empty = {
    root,
    cleared: true,
    bands: [],
    gridLines: [],
    yLabels: [],
    xGridLines: [],
    xLabels: [],
    zeroLine: null,
    passPath: null,
    failPath: null,
    firstFailingLabels: [],
  };
  if (ratios.length < 2) return empty;

  const frameCount = ratios.length;
  const rollingMedianRadius = 15;
  const activeStart = ratios.findIndex((value) => value > 0);
  const hasMetricFirstFailingFrame = metrics?.firstFailingFrame !== null
    && metrics?.firstFailingFrame !== undefined
    && metrics?.firstFailingFrame !== "";
  const metricFirstFailingFrame = Number(metrics?.firstFailingFrame);
  const firstFailingFrame = hasMetricFirstFailingFrame && Number.isFinite(metricFirstFailingFrame)
    ? Math.max(-1, Math.min(frameCount - 1, Math.round(metricFirstFailingFrame)))
    : activeStart;
  const centeredRatios = ratios.map((value, index) => {
    if (!(value > 0)) return 0;
    const warmingUp = activeStart >= 0 && index < activeStart + rollingMedianRadius;
    const window = ratios
      .slice(
        warmingUp ? activeStart : Math.max(activeStart, index - rollingMedianRadius),
        warmingUp ? index + 1 : Math.min(frameCount, index + rollingMedianRadius + 1),
      )
      .filter((candidate) => candidate > 0)
      .sort((left, right) => left - right);
    if (!window.length) return 0;
    const middle = Math.floor(window.length / 2);
    const rollingMedian = window.length % 2
      ? window[middle]
      : (window[middle - 1] + window[middle]) / 2;
    return value - rollingMedian;
  });
  const standardizedRatios = rollingStandardDeviationScores(ratios, centeredRatios, activeStart, rollingMedianRadius);
  const maxResidual = Math.max(0.00001, ...standardizedRatios.map((value) => Math.abs(value)));
  const limit = maxResidual * 1.16;
  const zeroY = FRAME_DELTA_CHART_HEIGHT / 2;
  const x = (index: number) => index / Math.max(1, frameCount - 1) * FRAME_DELTA_CHART_WIDTH;
  const y = (value: number) => zeroY - (value / limit) * (FRAME_DELTA_CHART_HEIGHT * 0.44);
  const bands: FrameDeltaBand[] = [];
  const appendBand = (start: number, end: number, failing: boolean) => {
    const x1 = x(start);
    const x2 = x(end);
    bands.push({
      className: failing ? "frame-delta-fail-band" : "frame-delta-pass-band",
      x: Math.min(x1, x2).toFixed(1),
      y: "0",
      width: Math.max(1, Math.abs(x2 - x1)).toFixed(1),
      height: "200",
    });
  };
  if (firstFailingFrame < 0) appendBand(0, frameCount - 1, false);
  else {
    if (firstFailingFrame > 0) appendBand(0, firstFailingFrame, false);
    appendBand(firstFailingFrame, frameCount - 1, true);
  }

  const gridLines: FrameDeltaLine[] = [];
  const yLabels: FrameDeltaLabel[] = [];
  for (const value of [-limit / 2, 0, limit / 2]) {
    const tickY = y(value);
    if (value !== 0) gridLines.push({ className: "grid-line", x1: "0", x2: String(FRAME_DELTA_CHART_WIDTH - 42), y1: tickY.toFixed(1), y2: tickY.toFixed(1) });
    yLabels.push({
      className: "axis-label y-axis-label",
      x: String(FRAME_DELTA_CHART_WIDTH - 4),
      y: tickY.toFixed(1),
      textAnchor: "end",
      dominantBaseline: "central",
      text: formatRatio(value),
    });
  }

  const rawStep = Math.max(1, frameCount / 10);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10]
    .map((multiplier) => Math.max(1, Math.round(multiplier * magnitude)))
    .find((candidate) => candidate >= rawStep) || Math.max(1, Math.round(10 * magnitude));
  const xGridLines: FrameDeltaLine[] = [];
  const xLabels: FrameDeltaLabel[] = [];
  let labelOrdinal = 0;
  for (let index = step; index < frameCount - 1; index += step) {
    const showLabel = labelOrdinal % 2 === 0;
    const tickX = x(index);
    if (showLabel) {
      xGridLines.push({ className: "grid-line x-grid-line", x1: tickX.toFixed(1), x2: tickX.toFixed(1), y1: "16", y2: "200" });
      xLabels.push({ className: "axis-label", x: tickX.toFixed(1), y: "13", textAnchor: "middle", text: String(index) });
    }
    labelOrdinal += 1;
  }

  const firstFailingLabels: FrameDeltaLabel[] = [];
  if (firstFailingFrame >= 0 && firstFailingFrame < frameCount) {
    if (firstFailingFrame > 0) firstFailingLabels.push({
      className: "axis-label first-failing-frame-percent-label",
      x: Math.max(4, x(firstFailingFrame) - 4).toFixed(1),
      y: Math.max(12, FRAME_DELTA_CHART_HEIGHT - 4).toFixed(1),
      textAnchor: "end",
      text: `${Math.round(firstFailingFrame / frameCount * 100)}%`,
    });
    firstFailingLabels.push({
      className: "axis-label first-failing-frame-label",
      x: Math.min(FRAME_DELTA_CHART_WIDTH - 4, x(firstFailingFrame) + 4).toFixed(1),
      y: Math.max(12, FRAME_DELTA_CHART_HEIGHT - 4).toFixed(1),
      textAnchor: "start",
      text: String(firstFailingFrame),
    });
  }

  const passSegments: string[] = [];
  const failSegments: string[] = [];
  for (let index = 0; index < frameCount - 1; index += 1) {
    const startValue = standardizedRatios[index];
    const endValue = standardizedRatios[index + 1];
    const segment = `M${x(index).toFixed(1)},${y(startValue).toFixed(1)}L${x(index + 1).toFixed(1)},${y(endValue).toFixed(1)}`;
    const exactMatch = firstFailingFrame < 0 || (index < firstFailingFrame && index + 1 < firstFailingFrame);
    (exactMatch ? passSegments : failSegments).push(segment);
  }

  return {
    root,
    cleared: false,
    bands,
    gridLines,
    yLabels,
    xGridLines,
    xLabels,
    zeroLine: { className: "delta-zero-line", x1: "0", x2: String(Math.max(0, FRAME_DELTA_CHART_WIDTH - 14).toFixed(1)), y1: zeroY.toFixed(1), y2: zeroY.toFixed(1) },
    passPath: passSegments.length ? { className: "frame-delta-line-pass", d: passSegments.join(" ") } : null,
    failPath: failSegments.length ? { className: "frame-delta-line-fail", d: failSegments.join(" ") } : null,
    firstFailingLabels,
  };
}
