import { resolve } from "node:path";
import { differentialProgressChartHistory } from "../differential-testing-render/differential-testing-renderer.js";
import { renderDifferentialTestingFrameDeltaChart, renderDifferentialTestingProgressChart } from "../differential-testing-render/differential-testing-progress-chart.js";

const { differentialTestingPayload } = await import(resolve(process.cwd(), "dashboard/src/oven/differential-testing-render/golden-harness.mjs"));
const realHistory = differentialProgressChartHistory(differentialTestingPayload(), { mode: "value" });
const baseTime = "2026-01-01T12:00:00.000Z";

function point(offsetMinutes, failed, marker = "") {
  const time = new Date(Date.parse(baseTime) + offsetMinutes * 60_000).toISOString();
  return { time, drivingParityGeneratedAt: time, percent: Math.max(0, 100 - failed / 20), done: Math.max(0, 100 - failed), remaining: failed, total: 100, drivingParityStateFailures: failed, drivingParityFailedFields: Math.ceil(failed / 10), drivingParityAllFields: 100, drivingParityFrames: 10, drivingParityFailedStatePointPercent: failed / 10, drivingParityActiveComparablePoints: 1_000, drivingParityEventMarker: marker, drivingParityEventTitle: marker ? `${marker} fixture` : "fixture run" };
}

const spikeHistory = [point(0, 1, "baseline"), point(2, 1), point(4, 500, "worsened"), point(6, 1, "reverted"), point(8, 2, "worsened")];
const goalHistory = [point(0, 20, "baseline"), point(3, 5, "improved"), point(6, 0, "improved")];

export const progressChartGoldenCases = [
  { filename: "progress-real-compact.svg", description: "Real payload in the UI progress/value compact mode.", render: renderDifferentialTestingProgressChart, args: [realHistory, { mode: "progress", timeScale: "compact" }], svgId: "progress-chart" },
  { filename: "failed-real-compact.svg", description: "Real payload in failed compact mode.", render: renderDifferentialTestingProgressChart, args: [realHistory, { mode: "failed", timeScale: "compact" }], svgId: "progress-chart" },
  { filename: "failed-real-all.svg", description: "Real payload in failed full-time mode.", render: renderDifferentialTestingProgressChart, args: [realHistory, { mode: "failed", timeScale: "all" }], svgId: "progress-chart" },
  { filename: "delta-real-compact.svg", description: "Real payload in failed-ratio delta mode.", render: renderDifferentialTestingProgressChart, args: [realHistory, { mode: "delta", timeScale: "compact" }], svgId: "progress-chart" },
  { filename: "progress-empty.svg", description: "Empty progress history with frozen Date.now fallback.", render: renderDifferentialTestingProgressChart, args: [[], { mode: "progress" }], svgId: "progress-chart" },
  { filename: "progress-single-point.svg", description: "Single-point progress history.", render: renderDifferentialTestingProgressChart, args: [[point(0, 50)], { mode: "progress" }], svgId: "progress-chart" },
  { filename: "failed-backtracking-spike.svg", description: "Failed history with a backtracking spike removed by chart filtering.", render: renderDifferentialTestingProgressChart, args: [spikeHistory, { mode: "failed" }], svgId: "progress-chart" },
  { filename: "failed-goal-reached.svg", description: "Failed history reaching zero failures and goal-reached state.", render: renderDifferentialTestingProgressChart, args: [goalHistory, { mode: "failed" }], svgId: "progress-chart" },
  { filename: "frame-delta-normal.svg", description: "Normal frame residuals without an explicit failing-frame split.", render: renderDifferentialTestingFrameDeltaChart, args: [{ frameDeviationRatios: [0, 0, 0.01, 0.012, 0.008, 0.011, 0.009, 0.01] }], svgId: "progress-chart" },
  { filename: "frame-delta-first-failing.svg", description: "Frame residuals with explicit pass and fail bands.", render: renderDifferentialTestingFrameDeltaChart, args: [{ frameDeviationRatios: [0, 0, 0.01, 0.012, 0.008, 0.011, 0.009, 0.01], firstFailingFrame: 3 }], svgId: "progress-chart" },
  { filename: "frame-delta-short.svg", description: "Short frame series that clears the chart after metadata setup.", render: renderDifferentialTestingFrameDeltaChart, args: [{ frameDeviationRatios: [0.01] }], svgId: "progress-chart" },
  { filename: "frame-delta-outliers.svg", description: "Outlier-heavy residuals exercising rolling median and standard-deviation scoring.", render: renderDifferentialTestingFrameDeltaChart, args: [{ frameDeviationRatios: [0, 0, 0.01, 0.012, 0.009, 1.5, 0.011, 0.008, 2.2, 0.01, 0.012, 0.009, 3.1, 0.011, 0.01, 0.008, 0.012, 0.009, 0.01, 0.011], firstFailingFrame: 2 }], svgId: "progress-chart" },
];
