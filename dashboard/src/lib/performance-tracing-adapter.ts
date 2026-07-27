import { adaptDifferentialTesting } from "./differential-testing-adapter";
// @ts-expect-error Console adapter remains JavaScript.
import { adaptPerformanceTracingReport } from "./performance-tracing.mjs";
import { withDifferentialTestingEnvelope } from "../oven/runtime/oven-payload-metadata";
// @ts-expect-error Canonical Oven contract remains JavaScript.
import { assertPerformanceTracingData } from "../../../ovens/performance-tracing/contract.mjs";

/** Shared JSON-only Performance Trace envelope projection for console and terminal. */
export function adaptPerformanceTracingEnvelope(raw: unknown) {
  const envelope = raw as { payload: unknown; fieldPage?: unknown; frameDeltaMetrics?: unknown };
  assertPerformanceTracingData(envelope.payload);
  return withDifferentialTestingEnvelope(adaptDifferentialTesting(adaptPerformanceTracingReport(envelope.payload) as any), envelope.fieldPage, envelope.frameDeltaMetrics, Object.hasOwn(envelope, "frameDeltaMetrics"));
}
