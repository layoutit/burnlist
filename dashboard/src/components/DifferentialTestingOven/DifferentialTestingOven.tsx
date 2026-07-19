import { adaptPerformanceTracingReport } from "@lib";
import { adaptDifferentialTesting, type DifferentialTestingData } from "../../lib/differential-testing-adapter";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import differentialTestingIr from "../../../../ovens/differential-testing/differential-testing.ir.json";
import performanceTracingIr from "../../../../ovens/performance-tracing/performance-tracing.ir.json";

type ResponseEnvelope = { payload: unknown };

function responsePayload(raw: unknown): unknown {
  return (raw as ResponseEnvelope).payload;
}

export const dtAdapt = (raw: unknown) => adaptDifferentialTesting(responsePayload(raw) as DifferentialTestingData);
export const ptAdapt = (raw: unknown) => adaptDifferentialTesting(adaptPerformanceTracingReport(responsePayload(raw)) as DifferentialTestingData);

export function DifferentialTestingOvenPage() {
  return <OvenRuntime ir={differentialTestingIr} adapt={dtAdapt} />;
}

export function PerformanceTracingOvenPage() {
  return <OvenRuntime ir={performanceTracingIr} adapt={ptAdapt} />;
}
