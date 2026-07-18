export type WaffleMetricData = {
  total?: number;
  failed?: number;
  blocked?: number;
};

export function waffleMetricData(metric: WaffleMetricData) {
  const failed = Number(metric.failed || 0) + Number(metric.blocked || 0);
  const ratio = metric.total ? failed / metric.total : 0;
  return {
    failed,
    failedCells: Math.min(80, Math.round(ratio * 96)),
    empty: metric.total ? false : true,
  };
}

export function WaffleMetric({ metric }: { metric: WaffleMetricData }) {
  const data = waffleMetricData(metric);
  return <canvas className="driving-parity-kpi-waffle" aria-hidden="true" data-failed-cells={data.failedCells} data-empty={String(data.empty)} />;
}
