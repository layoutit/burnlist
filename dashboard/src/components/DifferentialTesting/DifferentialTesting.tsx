import { useEffect, useRef } from "react";
// @ts-expect-error The canonical renderer is plain ESM so React and the direct Oven route share one implementation.
import { startDifferentialTestingLiveUpdates } from "../../../../ovens/differential-testing/renderer/differential-testing-renderer.js";

export function DifferentialTestingPage() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add("driving-parity-view");
    return () => document.body.classList.remove("driving-parity-view");
  }, []);

  useEffect(() => {
    if (!root.current) return;
    const controller = startDifferentialTestingLiveUpdates(root.current);
    return () => controller.stop();
  }, []);

  return <div ref={root} className="shell driving-parity-view" />;
}
