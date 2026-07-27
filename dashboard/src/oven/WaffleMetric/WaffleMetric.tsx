export type WaffleMetricData = {
  total?: number;
  failed?: number;
  blocked?: number;
};

export function WaffleMetric({ metric }: { metric: WaffleMetricData }) {
  const data = waffleMetricData(metric);
  return <canvas className="driving-parity-kpi-waffle" aria-hidden="true" data-failed-cells={data.failedCells} data-empty={String(data.empty)} />;
}
import { waffleMetricData } from "../../../../src/ovens/oven-progress-metrics.mjs";
export { waffleMetricData };
