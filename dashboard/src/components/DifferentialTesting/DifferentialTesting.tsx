import { useEffect, useRef } from "react";
import { adaptPerformanceTracingReport, ovenRepoKey } from "@lib";
// @ts-expect-error The canonical renderer is plain ESM so React and the direct Oven route share one implementation.
import { startDifferentialTestingLiveUpdates } from "../../../../ovens/differential-testing/renderer/differential-testing-renderer.js";

export function DifferentialTestingPage({ ovenId = "differential-testing" }: { ovenId?: "differential-testing" | "performance-tracing" }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add("driving-parity-view");
    if (ovenId === "performance-tracing") document.body.classList.add("performance-tracing-oven");
    return () => {
      document.body.classList.remove("driving-parity-view");
      document.body.classList.remove("performance-tracing-oven");
    };
  }, [ovenId]);

  useEffect(() => {
    if (!root.current) return;
    const performanceTracing = ovenId === "performance-tracing";
    const controller = startDifferentialTestingLiveUpdates(root.current, {
      repoKey: ovenRepoKey(),
      dataOvenId: ovenId,
      ...(performanceTracing ? {
        adaptPayload: adaptPerformanceTracingReport,
        mountOptions: { initialChart: "current", initialProgressChart: "delta" },
        onError: (error: unknown) => {
          if (!root.current) return;
          const message = document.createElement("div");
          message.className = "empty";
          message.textContent = error instanceof Error ? error.message : String(error);
          root.current.replaceChildren(message);
        },
      } : {}),
    });
    return () => controller.stop();
  }, [ovenId]);

  return <div ref={root} className={`shell driving-parity-view${ovenId === "performance-tracing" ? " performance-tracing-oven" : ""}`} />;
}
