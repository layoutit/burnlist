import { delta, percent } from "../utils/visual-parity-format";

type MetricTilesProps = {
  passed: number;
  total: number;
  ratio: number;
  meanAbsoluteDelta: number;
  maximumAbsoluteDelta: number;
};

export function MetricTiles({ passed, total, ratio, meanAbsoluteDelta, maximumAbsoluteDelta }: MetricTilesProps) {
  return <div className="visual-parity-metrics"><article><span>Frames</span><strong>{passed}/{total}</strong></article><article><span>Changed pixels</span><strong>{percent(ratio)}</strong></article><article><span>Mean RGB delta</span><strong>{delta(meanAbsoluteDelta)}</strong></article><article><span>Maximum delta</span><strong>{maximumAbsoluteDelta}</strong></article></div>;
}
