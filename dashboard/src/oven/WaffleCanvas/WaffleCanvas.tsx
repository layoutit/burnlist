import { useEffect, useRef } from "react";
import { waffleMetricData, type WaffleMetricData } from "../WaffleMetric";
import { paintWaffleCanvas, WAFFLE_FAIL_COLOR, WAFFLE_PASS_COLOR } from "./waffle-canvas-paint";

export function WaffleCanvas({ metric }: { metric: WaffleMetricData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = waffleMetricData(metric);

  useEffect(() => {
    if (typeof window === "undefined" || !ref.current) return;
    const styles = getComputedStyle(document.documentElement);
    const passColor = styles.getPropertyValue("--driving-parity-kpi-green").trim() || WAFFLE_PASS_COLOR;
    const failColor = styles.getPropertyValue("--driving-parity-kpi-red").trim() || WAFFLE_FAIL_COLOR;
    paintWaffleCanvas(ref.current, {
      scale: window.devicePixelRatio || 1,
      box: ref.current.getBoundingClientRect(),
      passColor,
      failColor,
    });
  }, [data.empty, data.failedCells]);

  return <canvas ref={ref} className="driving-parity-kpi-waffle" aria-hidden="true" data-failed-cells={data.failedCells} data-empty={String(data.empty)} />;
}
