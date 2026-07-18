import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { adaptPerformanceTracingReport } from "../../../dashboard/src/lib/performance-tracing.mjs";
import { buildPayload } from "../example/adapter.mjs";
import {
  assertDifferentialTestingData,
  DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY,
} from "../engine/differential-testing-data-contract.mjs";
import { assertPerformanceTracingData } from "../../performance-tracing/engine/performance-tracing-contract.mjs";
import { mountDifferentialTestingDashboard } from "./differential-testing-renderer.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = resolve(here, "../example");
const FIXED_NOW = Date.parse("2026-01-01T12:30:00.000Z");
const PERFORMANCE_TIMESTAMP = "2026-07-15T12:00:00.000Z";

export let lastCaptureRoot = null;

function nsStub() {
  return {
    setAttribute() {},
    append() {},
    appendChild() {},
    replaceChildren() {},
  };
}

function controlStub() {
  return {
    value: "",
    focus() {},
    setSelectionRange() {},
    remove() {},
    append() {},
  };
}

function stubFor(selector) {
  if (selector === "#progress-chart") return null;
  if ([
    "#differential-overview-time",
    "#differential-refresh-status",
    "#driving-parity-field-search",
    "#driving-parity-page-size",
  ].includes(selector)) return controlStub();
  return null;
}

function installGlobals() {
  const installed = [];
  if (typeof globalThis.document === "undefined") {
    globalThis.document = {
      querySelector: stubFor,
      createElementNS: () => nsStub(),
      documentElement: {},
    };
    installed.push("document");
  }
  if (typeof globalThis.window === "undefined") {
    globalThis.window = {
      devicePixelRatio: 1,
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {},
    };
    installed.push("window");
  }
  if (typeof globalThis.getComputedStyle === "undefined") {
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
    installed.push("getComputedStyle");
  }
  return () => installed.reverse().forEach((name) => delete globalThis[name]);
}

function rootStubFor(selector) {
  return stubFor(selector);
}

function fakeRoot() {
  return {
    className: "",
    set innerHTML(value) { this._html = value; },
    get innerHTML() { return this._html ?? ""; },
    addEventListener(type, handler) {
      (this._handlers ||= {})[type] = handler;
    },
    querySelector: rootStubFor,
    querySelectorAll: () => [],
    append() {},
    remove() {},
  };
}

export function captureDashboardRoot(oven, payload, mountOptions = {}) {
  const previousTz = process.env.TZ;
  const previousDateNow = Date.now;
  const OriginalDTF = Intl.DateTimeFormat;
  const Shim = function DateTimeFormat(locales, options) {
    return new OriginalDTF(locales == null ? "en-US" : locales, { timeZone: "UTC", ...(options || {}) });
  };
  Shim.prototype = OriginalDTF.prototype;
  Object.setPrototypeOf(Shim, OriginalDTF);
  const restoreGlobals = installGlobals();
  const root = fakeRoot();
  lastCaptureRoot = root;
  process.env.TZ = "UTC";
  Date.now = () => FIXED_NOW;
  globalThis.Intl.DateTimeFormat = Shim;
  try {
    mountDifferentialTestingDashboard(root, oven, payload, mountOptions);
    return root;
  } finally {
    globalThis.Intl.DateTimeFormat = OriginalDTF;
    Date.now = previousDateNow;
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
    restoreGlobals();
  }
}

export function captureDashboardHtml(oven, payload, mountOptions = {}) {
  return captureDashboardRoot(oven, payload, mountOptions).innerHTML;
}

export function ovenLayout() {
  const detail = JSON.parse(readFileSync(resolve(here, "../detail.json"), "utf8"));
  return { id: "differential-testing", name: "Differential Testing", detail: { cells: detail.cells } };
}

function emptyCaptures() {
  return ["reference.json", "candidate.json"].map((name) => JSON.parse(readFileSync(resolve(exampleDir, name), "utf8")));
}

function populatedCaptures() {
  return [
    {
      captureId: "reference-fixture",
      generatedAt: "2026-01-01T12:00:00.000Z",
      fields: [
        { id: "position", label: "Position", sourceOwner: "engine/state", meaning: "One-dimensional position after the update", unit: "units", tolerance: 0.01 },
        { id: "active", label: "Active", sourceOwner: "engine/state", meaning: "Whether the object is active after the update", unit: null, tolerance: 0 },
      ],
      samples: [
        { tick: 0, values: { position: 0, active: false } },
        { tick: 1, values: { position: 1, active: true } },
        { tick: 2, values: { position: 2, active: true } },
      ],
    },
    {
      captureId: "candidate-fixture",
      generatedAt: "2026-01-01T12:00:00.000Z",
      samples: [
        { tick: 0, values: { position: 0, active: false } },
        { tick: 1, values: { position: 1.005, active: true } },
        { tick: 2, values: { position: 2.1, active: true } },
      ],
    },
  ];
}

export function differentialTestingPayload() {
  const base = buildPayload(...populatedCaptures());
  assertDifferentialTestingData(base);
  return base;
}

export function differentialTestingEmptyPayload() {
  const payload = buildPayload(...emptyCaptures());
  assertDifferentialTestingData(payload);
  return payload;
}

export function differentialTestingIncomparableTelemetryPayload() {
  const payload = buildPayload(...populatedCaptures());
  payload.telemetry = {
    status: "blocked",
    authority: DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY,
    blockers: ["Transition telemetry unavailable."],
  };
  assertDifferentialTestingData(payload);
  return payload;
}

export function performanceTracingPayload() {
  const report = performanceTracingFixture();
  assertPerformanceTracingData(report);
  return adaptPerformanceTracingReport(report);
}

function performanceTracingFixture() {
  const value = {
    schema: "performance-tracing-oven@1",
    status: "fail",
    runId: "fixture",
    generatedAt: PERFORMANCE_TIMESTAMP,
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
    generatedAt: PERFORMANCE_TIMESTAMP,
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
    generatedAt: PERFORMANCE_TIMESTAMP,
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
      comparisonKey: "fixture-context",
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
