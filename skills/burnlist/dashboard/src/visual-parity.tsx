import { useEffect, useRef } from "react";
import "../visual-parity.css";
// @ts-expect-error The canonical renderer is plain ESM so both rich Ovens share one implementation.
import {
  mountDifferentialTestingDashboard,
  startDifferentialTestingLiveUpdates,
} from "../differential-testing-renderer.js";
// @ts-expect-error The screenshot row is plain ESM so contract tests can inspect it directly.
import { renderVisualParityComparison } from "../visual-parity-renderer.js";

export function VisualParityPage() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add("driving-parity-view", "visual-parity-view");
    return () => document.body.classList.remove("driving-parity-view", "visual-parity-view");
  }, []);

  useEffect(() => {
    if (!root.current) return;
    const controller = startDifferentialTestingLiveUpdates(root.current, {
      ovenId: "visual-parity",
      ovenName: "Visual Parity",
      scenarioParam: "view",
      payloadTransform: (response: { payload: { differentialTesting: object } }) => ({
        ...response.payload.differentialTesting,
        visualParity: response.payload,
      }),
      mount: (target: HTMLElement, oven: object, payload: object, options: object) => mountDifferentialTestingDashboard(
        target,
        oven,
        payload,
        {
          ...options,
          detailCellId: "screenshot-comparison",
          detailRenderer: renderVisualParityComparison,
          initialProgressChart: "delta",
        },
      ),
    });
    return () => controller.stop();
  }, []);

  return <div ref={root} className="shell driving-parity-view visual-parity-view" />;
}
