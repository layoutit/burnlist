import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptPerformanceTracingReport } from "../../../dashboard/src/lib/performance-tracing.mjs";
import { startDifferentialTestingLiveUpdates } from "../../differential-testing/renderer/differential-testing-renderer.js";
import { assertPerformanceTracingData } from "./performance-tracing-contract.mjs";
import { assertPerformanceTracingProvenanceCurrent } from "./performance-tracing-handler.mjs";
import { createHash } from "node:crypto";

test("Performance Tracing validates reconciled browser-output reports", () => {
  assert.equal(assertPerformanceTracingData(fixture()).status, "fail");
  const genericProject = fixture();
  genericProject.scenario.route = "/benchmark";
  genericProject.diagnostics.rerun.command = "npm run benchmark";
  assert.equal(assertPerformanceTracingData(genericProject).scenario.route, "/benchmark");
});

test("Performance Tracing rejects weakened trust and contradictory budgets", () => {
  const weakened = fixture();
  weakened.trust.nativeParityClaim = true;
  assert.throws(() => assertPerformanceTracingData(weakened), /browser-output-only trust boundary/u);
  const contradictory = fixture();
  contradictory.verdict.checks[0].status = "pass";
  assert.throws(() => assertPerformanceTracingData(contradictory), /invalid or contradictory budget/u);
});

test("Performance Tracing rejects unordered or unreconciled history", () => {
  const unordered = fixture();
  unordered.history.unshift({ ...structuredClone(unordered.history[0]), runId: "older", generatedAt: "2026-07-15T13:00:00.000Z" });
  assert.throws(() => assertPerformanceTracingData(unordered), /unordered points/u);
  const unreconciled = fixture();
  unreconciled.history[0].metrics.p95FrameMs = 39;
  assert.throws(() => assertPerformanceTracingData(unreconciled), /latest point must reconcile/u);
});

test("Performance Tracing blocks a report after a measured input changes", () => {
  const root = mkdtempSync(join(tmpdir(), "performance-provenance-"));
  try {
    const binding = join(root, ".local", "performance", "report.json");
    const source = join(root, "source.mjs");
    mkdirSync(join(root, ".local", "performance"), { recursive: true });
    writeFileSync(binding, "{}\n");
    writeFileSync(source, "export const value = 1;\n");
    const bytes = Buffer.from("export const value = 1;\n");
    const payload = { provenance: { files: { "source.mjs": { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } } } };
    assert.equal(assertPerformanceTracingProvenanceCurrent(payload, binding), payload);
    writeFileSync(source, "export const value = 2;\n");
    assert.throws(() => assertPerformanceTracingProvenanceCurrent(payload, binding), /report is stale/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Performance Tracing live view reads its own Oven and adapts its report", async () => {
  const requests = [];
  const oven = { id: "performance-tracing", name: "Performance Tracing", detail: { cells: [] } };
  let mounted = null;
  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    dataOvenId: "performance-tracing",
    repoKey: "repo-key",
    adaptPayload: adaptPerformanceTracingReport,
    mountOptions: { initialChart: "current", initialProgressChart: "delta" },
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() {
          return url === "/api/ovens/performance-tracing" ? { oven } : { payload: fixture() };
        },
      };
    },
    setIntervalImpl: () => 17,
    clearIntervalImpl() {},
    mount: (_root, mountedOven, payload, options) => {
      mounted = { mountedOven, payload, options };
      return { update() {} };
    },
  });

  await controller.ready;
  controller.stop();
  assert.deepEqual(requests, [
    "/api/ovens/performance-tracing",
    "/api/oven-data/performance-tracing?repoKey=repo-key",
  ]);
  assert.equal(mounted.mountedOven, oven);
  assert.equal(mounted.payload.subtitle, "fixture");
  assert.equal(mounted.payload.fields.length, 6);
  assert.equal(mounted.options.initialChart, "current");
});

function fixture() {
  const value = {
    schema: "performance-tracing-oven@1",
    status: "fail",
    runId: "fixture",
    generatedAt: "2026-07-15T12:00:00.000Z",
    trust: {
      classification: "browser-output-performance-evidence",
      preparedRoute: true,
      nativeParityClaim: false,
      visualParityClaim: false,
    },
    browser: { engine: "chromium", version: "1" },
    scenario: { id: "prepared", route: "/" },
    metrics: {
      runCount: 1,
      startupReadyMs: 1000,
      p95FrameMs: 40,
      p99FrameMs: 50,
      maxFrameMs: 100,
      over33msRatio: 0.1,
      p95StepCallMs: 1,
      pageErrorCount: 0,
      nativeRequestCount: 0,
      runtimeConstructionCount: 0,
    },
    verdict: {
      status: "fail",
      passCount: 0,
      failCount: 1,
      checks: [{ id: "p95FrameMs", actual: 40, limit: 25, operator: "<=", status: "fail" }],
    },
    artifacts: { report: "report.json" },
    provenance: { files: { "source.mjs": { sha256: "a", bytes: 1 } } },
    runs: [{
      id: "run-01",
      status: "passed",
      frameTiming: { p95FrameMs: 40, series: [{ frame: 0, elapsedMs: 40, frameMs: 40 }] },
      stepTiming: {
        p95StepCallMs: 1,
        slowestSteps: [],
        series: [{ tick: 0, stepCallMs: 1 }],
        phaseTiming: {
          schema: "runtime-dispatch-phase-summary@1",
          sampleCount: 1,
          phases: { cameraResidency: phase() },
        },
        cameraPhaseTiming: {
          schema: "camera-publication-phase-summary@1",
          sampleCount: 1,
          phases: { assetResidencyDiscovery: phase() },
        },
      },
      trace: {
        schema: "browser-performance-trace-summary@2",
        attributionMode: "exclusive-classified-thread-time@1",
        measurementWindow: { status: "bounded" },
        groups: { scripting: { label: "JS / scripting", durationMs: 100, inclusiveDurationMs: 120, count: 10, maxMs: 4, timeline: { mode: "exclusive-classified-thread-time", bucketDurationMs: 50, values: [1] } } },
      },
      integrity: { pageErrorCount: 0, nativeRequestCount: 0, runtimeConstructionCount: 0 },
    }],
  };
  value.history = [{
    schema: "performance-history-point@1",
    runId: value.runId,
    generatedAt: value.generatedAt,
    status: value.status,
    comparisonKey: "fixture-context",
    context: { browserTarget: "fixture", scenarioId: "prepared" },
    metrics: {
      startupReadyMs: 1000,
      p95FrameMs: 40,
      p99FrameMs: 50,
      maxFrameMs: 100,
      over33msRatio: 0.1,
      p95StepCallMs: 1,
      maxStepCallMs: 4,
      residencyTransitionStepCount: 1,
    },
    budgets: { p95FrameMs: 25 },
    traceGroups: { scripting: { label: "JS / scripting", durationMs: 100, count: 10, maxMs: 4 } },
  }];
  value.diagnostics = {
    schema: "performance-diagnostics@1",
    runId: value.runId,
    generatedAt: value.generatedAt,
    primaryTarget: action(),
    budgetGaps: [{ id: "p95FrameMs", actual: 40, limit: 25, excess: 15, ratioToLimit: 1.6, percentOverLimit: 60 }],
    comparison: { comparable: false, previousRunId: null, previousGeneratedAt: null, metricChanges: {} },
    runs: [{
      runId: "run-01",
      frameSpikes: [{ frame: 0, elapsedMs: 40, frameMs: 40, overBudgetMs: 15 }],
      stepSpikes: [],
      phaseBottlenecks: [{ id: "cameraResidency", ...phase() }],
      cameraPhaseBottlenecks: [{ id: "assetResidencyDiscovery", ...phase() }],
      traceGroups: [],
      hotWindows: [{ bucket: 0, startMs: 0, endMs: 50, classifiedThreadTimeMs: 1, contributors: [] }],
      topEvents: [],
      structure: { integrity: value.runs[0].integrity },
    }],
    phaseBottlenecks: [{ id: "cameraResidency", ...phase(), runId: "run-01" }],
    cameraPhaseBottlenecks: [{ id: "assetResidencyDiscovery", ...phase(), runId: "run-01" }],
    traceGroups: [],
    residencySpikes: [],
    actionItems: [action()],
    rerun: {
      command: "pnpm perf:trace -- --runs 1 --no-fail-on-budget",
      comparisonKey: value.history[0].comparisonKey,
      compareAgainstRunId: value.runId,
      protocol: ["Change one producer."],
      requiredIntegrity: { pageErrorCount: 0, nativeRequestCount: 0, runtimeConstructionCount: 0 },
      successCriteria: [{ id: "p95FrameMs", operator: "<=", limit: 25 }],
    },
    caveats: ["inclusive", "instrumented", "browser output"],
  };
  return value;
}

function phase() {
  return {
    label: "camera / city residency",
    producer: "src/runtime/scene.mjs",
    nextProbe: "Separate camera and residency work.",
    sampleCount: 1,
    totalMs: 4,
    averageMs: 4,
    p50Ms: 4,
    p95Ms: 4,
    maxMs: 4,
    attributedShare: 1,
  };
}

function action() {
  return {
    id: "dispatch-phase-cameraResidency",
    priority: 1,
    target: "camera / city residency",
    producer: "src/runtime/scene.mjs",
    signal: "dispatch phase max 4 ms",
    evidence: { maxMs: 4 },
    nextAction: "Separate camera and residency work.",
    verifyMetrics: ["p95StepCallMs"],
  };
}
