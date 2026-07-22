import { useEffect, type ReactNode } from "react";
import type { ResolvedOvenIr } from "@hooks";
import { adaptPerformanceTracingReport } from "@lib";
import { adaptDifferentialTesting, type DifferentialTestingData } from "../../lib/differential-testing-adapter";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import { withDifferentialTestingEnvelope } from "@/oven/runtime/oven-payload-metadata";

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

export function DifferentialTestingOvenPage({ ir }: { ir: ResolvedOvenIr }) {
  return <DifferentialTestingShell><OvenRuntime ir={ir} adapt={dtAdapt} /></DifferentialTestingShell>;
}

export function PerformanceTracingOvenPage({ ir }: { ir: ResolvedOvenIr }) {
  return <DifferentialTestingShell performanceTracing><OvenRuntime ir={ir} adapt={ptAdapt} /></DifferentialTestingShell>;
}
