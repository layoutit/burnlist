/** Canonical Performance report fixtures adapted through the shared Differential surface. */
// @ts-expect-error Console adapter remains JavaScript.
import { adaptPerformanceTracingReport } from "../../../dashboard/src/lib/performance-tracing.mjs";
import { adaptPerformanceTracingEnvelope } from "../../../dashboard/src/lib/performance-tracing-adapter";

const stamp = "2026-07-15T12:00:00.000Z";
export const sourceText = "export const value = 1;\n";
const phase = { label: "camera / city residency", producer: "src/runtime/scene.mjs", nextProbe: "Separate camera and residency work.", sampleCount: 1, totalMs: 4, averageMs: 4, p50Ms: 4, p95Ms: 4, maxMs: 4, attributedShare: 1 };
const action = { id: "dispatch-phase-cameraResidency", priority: 1, target: "camera / city residency", producer: "src/runtime/scene.mjs", signal: "dispatch phase max 4 ms", evidence: { maxMs: 4 }, nextAction: "Separate camera and residency work.", verifyMetrics: ["p95StepCallMs"] };

function report(status: "pass" | "fail") {
  const failing = status === "fail", p95 = failing ? 40 : 20, limit = 25;
  const value = {
    schema: "performance-tracing-oven@1", status, runId: `${status}-fixture`, generatedAt: stamp,
    trust: { classification: "browser-output-performance-evidence", preparedRoute: true, nativeParityClaim: false, visualParityClaim: false },
    browser: { engine: "chromium", version: "1" }, scenario: { id: "prepared", route: "/" },
    metrics: { runCount: 1, startupReadyMs: 1000, p95FrameMs: p95, p99FrameMs: p95 + 10, maxFrameMs: p95 + 60, over33msRatio: failing ? 0.1 : 0, p95StepCallMs: 1, pageErrorCount: 0, nativeRequestCount: 0, runtimeConstructionCount: 0 },
    verdict: { status, passCount: failing ? 0 : 1, failCount: failing ? 1 : 0, checks: [{ id: "p95FrameMs", actual: p95, limit, operator: "<=", status }] }, artifacts: { report: "report.json" }, provenance: { files: { "source.mjs": { sha256: "5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29", bytes: 24 } } },
    runs: [{ id: "run-01", status: "passed", frameTiming: { p95FrameMs: p95, series: [{ frame: 0, elapsedMs: p95, frameMs: p95 }] }, stepTiming: { p95StepCallMs: 1, slowestSteps: [], series: [{ tick: 0, stepCallMs: 1 }], phaseTiming: { schema: "runtime-dispatch-phase-summary@1", sampleCount: 1, phases: { cameraResidency: phase } }, cameraPhaseTiming: { schema: "camera-publication-phase-summary@1", sampleCount: 1, phases: { assetResidencyDiscovery: phase } } }, trace: { schema: "browser-performance-trace-summary@2", attributionMode: "exclusive-classified-thread-time@1", measurementWindow: { status: "bounded" }, groups: { scripting: { label: "JS / scripting", durationMs: 100, inclusiveDurationMs: 120, count: 10, maxMs: 4, timeline: { mode: "exclusive-classified-thread-time", bucketDurationMs: 50, values: [1] } } } }, integrity: { pageErrorCount: 0, nativeRequestCount: 0, runtimeConstructionCount: 0 } }],
    history: [{ schema: "performance-history-point@1", runId: `${status}-fixture`, generatedAt: stamp, status, comparisonKey: "fixture-context", context: { browserTarget: "fixture", scenarioId: "prepared" }, metrics: { startupReadyMs: 1000, p95FrameMs: p95, p99FrameMs: p95 + 10, maxFrameMs: p95 + 60, over33msRatio: failing ? 0.1 : 0, p95StepCallMs: 1, maxStepCallMs: 4, residencyTransitionStepCount: 1 }, budgets: { p95FrameMs: limit }, traceGroups: { scripting: { label: "JS / scripting", durationMs: 100, count: 10, maxMs: 4 } } }],
    diagnostics: { schema: "performance-diagnostics@1", runId: `${status}-fixture`, generatedAt: stamp, primaryTarget: failing ? action : null, budgetGaps: failing ? [{ id: "p95FrameMs", actual: p95, limit, excess: p95 - limit }] : [], comparison: { comparable: false, previousRunId: null, previousGeneratedAt: null, metricChanges: {} }, runs: [{ runId: "run-01", frameSpikes: [], stepSpikes: [], phaseBottlenecks: [{ id: "cameraResidency", ...phase }], cameraPhaseBottlenecks: [{ id: "assetResidencyDiscovery", ...phase }], traceGroups: [], hotWindows: [{ bucket: 0, startMs: 0, endMs: 50, classifiedThreadTimeMs: 1, contributors: [] }], topEvents: [], structure: { integrity: { pageErrorCount: 0, nativeRequestCount: 0, runtimeConstructionCount: 0 } } }], phaseBottlenecks: [{ id: "cameraResidency", ...phase, runId: "run-01" }], cameraPhaseBottlenecks: [{ id: "assetResidencyDiscovery", ...phase, runId: "run-01" }], traceGroups: [], residencySpikes: [], actionItems: failing ? [action] : [], rerun: { command: "pnpm perf:trace -- --runs 1 --no-fail-on-budget", comparisonKey: "fixture-context", compareAgainstRunId: `${status}-fixture`, protocol: ["Change one producer."], requiredIntegrity: { pageErrorCount: 0, nativeRequestCount: 0, runtimeConstructionCount: 0 }, successCriteria: [{ id: "p95FrameMs", operator: "<=", limit }] }, caveats: ["inclusive", "instrumented", "browser output"] }
  } as const;
  return value;
}
const normal = adaptPerformanceTracingEnvelope({ payload: report("pass") });
const failedBudget = adaptPerformanceTracingEnvelope({ payload: report("fail") });
const empty = { ...normal, pageMode: "empty" as const, scenarioCatalog: { selectedScenarioId: null, scenarios: [] }, progress: [], log: [], fields: [] };
export const performanceTracingFixture = { id: "performance-tracing", checkpoints: ["normal", "failed-budget", "empty"] as const, reports: { normal: report("pass"), failedBudget: report("fail") }, payload: normal, failedBudget, empty } as const;
