import { compact, count, nonPass, value } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import type { HybridFieldData } from "../HybridField/HybridField";

export type HybridTelemetry = {
  failToPassCount?: number | null;
  passToFailCount?: number | null;
  stayedPassCount?: number | null;
  stayedFailCount?: number | null;
  residualCount?: number | null;
};

export type HybridMetricProps = {
  field: HybridFieldData;
  telemetry?: HybridTelemetry | null;
};

export function HybridMetric({ field, telemetry }: HybridMetricProps) {
  const frameDelta = telemetry ? Number(telemetry.passToFailCount || 0) - Number(telemetry.failToPassCount || 0) : null;
  const deltaClass = frameDelta === null || frameDelta === 0 ? "" : frameDelta < 0 ? "up" : "down";
  const deltaSymbol = frameDelta === null || frameDelta === 0 ? "" : frameDelta < 0 ? "▼" : "▲";
  const deltaValue = frameDelta === null ? "" : frameDelta === 0 ? "0" : compact(Math.abs(frameDelta));
  const transitionTitle = telemetry
    ? `${count(telemetry.failToPassCount)} fail-to-pass; ${count(telemetry.passToFailCount)} pass-to-fail; ${count(telemetry.stayedPassCount)} stayed-pass; ${count(telemetry.stayedFailCount)} stayed-fail; residual ${count(telemetry.residualCount)}`
    : "";
  const valueDelta = field.maxDelta === null || !Number.isFinite(Number(field.maxDelta)) ? "" : value(field.maxDelta);

  return <span className="hybrid-cell hybrid-metric">
    <span className="hybrid-count">{count(nonPass(field))}</span>
    <span className={`hybrid-delta ${deltaClass}`} title={transitionTitle || undefined}>
      <span className="hybrid-delta-symbol">{deltaSymbol}</span>
      <span className="hybrid-delta-value">{deltaValue}</span>
    </span>
    <span className="hybrid-value-delta">{valueDelta}</span>
  </span>;
}
