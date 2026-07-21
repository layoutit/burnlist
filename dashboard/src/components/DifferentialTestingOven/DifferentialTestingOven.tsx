import { useEffect, type ReactNode } from "react";
import { adaptPerformanceTracingReport } from "@lib";
import { adaptDifferentialTesting, type DifferentialTestingData } from "../../lib/differential-testing-adapter";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import { withDifferentialTestingEnvelope } from "@/oven/runtime/oven-payload-metadata";
import differentialTestingIr from "../../../../ovens/differential-testing/differential-testing.ir.json";
import performanceTracingIr from "../../../../ovens/performance-tracing/performance-tracing.ir.json";

type ResponseEnvelope = { payload: unknown; fieldPage?: unknown; frameDeltaMetrics?: unknown };

function responseEnvelope(raw: unknown): ResponseEnvelope {
  return raw as ResponseEnvelope;
}

function adaptEnvelope(raw: unknown, adaptPayload: (payload: unknown) => DifferentialTestingData) {
  const envelope = responseEnvelope(raw);
  const payload = adaptDifferentialTesting(adaptPayload(envelope.payload));
  return withDifferentialTestingEnvelope(payload, envelope.fieldPage, envelope.frameDeltaMetrics, Object.hasOwn(envelope, "frameDeltaMetrics"));
}

export const dtAdapt = (raw: unknown) => adaptEnvelope(raw, (payload) => payload as DifferentialTestingData);
export const ptAdapt = (raw: unknown) => adaptEnvelope(raw, (payload) => adaptPerformanceTracingReport(payload) as DifferentialTestingData);

function DifferentialTestingShell({ children, performanceTracing = false }: { children: ReactNode; performanceTracing?: boolean }) {
  useEffect(() => {
    document.body.classList.add("driving-parity-view");
    if (performanceTracing) document.body.classList.add("performance-tracing-oven");
    return () => {
      document.body.classList.remove("driving-parity-view");
      if (performanceTracing) document.body.classList.remove("performance-tracing-oven");
    };
  }, [performanceTracing]);
  return <div className={`shell driving-parity-view${performanceTracing ? " performance-tracing-oven" : ""}`}>{children}</div>;
}

export function DifferentialTestingOvenPage() {
  return <DifferentialTestingShell><OvenRuntime ir={differentialTestingIr} adapt={dtAdapt} /></DifferentialTestingShell>;
}

export function PerformanceTracingOvenPage() {
  return <DifferentialTestingShell performanceTracing><OvenRuntime ir={performanceTracingIr} adapt={ptAdapt} /></DifferentialTestingShell>;
}
