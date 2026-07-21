export const PERFORMANCE_TRACING_DATA_SCHEMA = "performance-tracing-oven@1";
export const PERFORMANCE_TRACING_HISTORY_SCHEMA = "performance-history-point@1";
export const PERFORMANCE_TRACING_DIAGNOSTICS_SCHEMA = "performance-diagnostics@1";
const MAX_HISTORY_POINTS = 120;

const METRIC_KEYS = Object.freeze([
  "runCount",
  "startupReadyMs",
  "p95FrameMs",
  "p99FrameMs",
  "maxFrameMs",
  "over33msRatio",
  "p95StepCallMs",
  "pageErrorCount",
  "nativeRequestCount",
  "runtimeConstructionCount",
]);

export function assertPerformanceTracingData(value, label = "Performance Tracing data") {
  if (!value || value.schema !== PERFORMANCE_TRACING_DATA_SCHEMA) {
    throw new Error(label + " must use " + PERFORMANCE_TRACING_DATA_SCHEMA + ".");
  }
  if (!value.runId || !isIsoTimestamp(value.generatedAt) || !["pass", "fail"].includes(value.status)) {
    throw new Error(label + " must identify one timestamped pass/fail run.");
  }
  if (value.trust?.classification !== "browser-output-performance-evidence"
    || value.trust.preparedRoute !== true || value.trust.nativeParityClaim !== false
    || value.trust.visualParityClaim !== false) {
    throw new Error(label + " must retain its browser-output-only trust boundary.");
  }
  for (const key of METRIC_KEYS) {
    if (!Number.isFinite(value.metrics?.[key]) || value.metrics[key] < 0) {
      throw new Error(label + ".metrics." + key + " must be finite and non-negative.");
    }
  }
  if (!value.browser?.engine || !value.browser?.version || !value.scenario?.id
    || typeof value.scenario.route !== "string" || !value.scenario.route.startsWith("/")) {
    throw new Error(label + " must bind browser and canonical scenario identity.");
  }
  const checks = value.verdict?.checks;
  if (!Array.isArray(checks) || checks.length === 0 || value.verdict.status !== value.status) {
    throw new Error(label + " must publish one reconciled budget verdict.");
  }
  const ids = new Set();
  for (const check of checks) {
    if (!check?.id || ids.has(check.id) || !Number.isFinite(check.actual) || !Number.isFinite(check.limit)
      || check.operator !== "<=" || !["pass", "fail"].includes(check.status)
      || check.status !== (check.actual <= check.limit ? "pass" : "fail")) {
      throw new Error(label + " contains an invalid or contradictory budget check.");
    }
    ids.add(check.id);
  }
  const expectedStatus = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  if (value.status !== expectedStatus
    || value.verdict.passCount !== checks.filter((check) => check.status === "pass").length
    || value.verdict.failCount !== checks.filter((check) => check.status === "fail").length) {
    throw new Error(label + " budget counts and status do not reconcile.");
  }
  if (!value.artifacts?.report || !value.provenance?.files || typeof value.provenance.files !== "object") {
    throw new Error(label + " must bind retained artifacts and source provenance.");
  }
  if (value.runs !== undefined) assertRuns(value.runs, label + ".runs");
  if (value.history !== undefined) assertHistory(value.history, value, label + ".history");
  assertDiagnostics(value.diagnostics, value, label + ".diagnostics");
  return value;
}

function assertDiagnostics(diagnostics, current, label) {
  if (!diagnostics || diagnostics.schema !== PERFORMANCE_TRACING_DIAGNOSTICS_SCHEMA
    || diagnostics.runId !== current.runId || diagnostics.generatedAt !== current.generatedAt) {
    throw new Error(label + " must identify the current report with " + PERFORMANCE_TRACING_DIAGNOSTICS_SCHEMA + ".");
  }
  if (!Array.isArray(diagnostics.actionItems)
    || (diagnostics.actionItems.length === 0 && diagnostics.primaryTarget !== null)
    || (diagnostics.actionItems.length > 0 && diagnostics.primaryTarget?.id !== diagnostics.actionItems[0].id)) {
    throw new Error(label + " must reconcile its optional measured primary target with the action plan.");
  }
  for (const [index, item] of diagnostics.actionItems.entries()) {
    if (!item?.id || item.priority !== index + 1 || !item.target || !item.producer || !item.signal
      || !item.nextAction || !item.evidence || typeof item.evidence !== "object"
      || !Array.isArray(item.verifyMetrics) || item.verifyMetrics.length === 0) {
      throw new Error(label + " contains an action item without measured evidence, a source producer, or verification metrics.");
    }
  }
  if (!Array.isArray(diagnostics.budgetGaps) || !diagnostics.comparison || typeof diagnostics.comparison !== "object"
    || !Array.isArray(diagnostics.phaseBottlenecks) || !Array.isArray(diagnostics.cameraPhaseBottlenecks)
    || !Array.isArray(diagnostics.traceGroups)
    || !Array.isArray(diagnostics.residencySpikes) || !Array.isArray(diagnostics.runs) || diagnostics.runs.length === 0) {
    throw new Error(label + " must retain budget gaps, comparison context, bottlenecks, and per-run evidence.");
  }
  for (const gap of diagnostics.budgetGaps) {
    if (!gap?.id || !Number.isFinite(gap.actual) || !Number.isFinite(gap.limit) || !Number.isFinite(gap.excess)) {
      throw new Error(label + " contains an invalid budget gap.");
    }
  }
  for (const run of diagnostics.runs) {
    if (!run?.runId || !Array.isArray(run.frameSpikes) || !Array.isArray(run.stepSpikes)
      || !Array.isArray(run.phaseBottlenecks) || !Array.isArray(run.traceGroups)
      || !Array.isArray(run.cameraPhaseBottlenecks)
      || !Array.isArray(run.hotWindows) || !Array.isArray(run.topEvents)
      || !run.structure?.integrity || typeof run.structure.integrity !== "object") {
      throw new Error(label + " contains incomplete per-run spike, phase, trace-window, or integrity evidence.");
    }
    for (const phase of run.phaseBottlenecks) assertPhase(phase, label + ".runs phase");
    for (const phase of run.cameraPhaseBottlenecks) assertPhase(phase, label + ".runs camera phase");
    for (const window of run.hotWindows) {
      if (!Number.isFinite(window?.startMs) || !Number.isFinite(window.endMs)
        || !Number.isFinite(window.classifiedThreadTimeMs) || !Array.isArray(window.contributors)) {
        throw new Error(label + " contains an invalid hot trace window.");
      }
    }
  }
  const rerun = diagnostics.rerun;
  const latestComparisonKey = current.history?.at(-1)?.comparisonKey;
  if (typeof rerun?.command !== "string" || !rerun.command.trim() || rerun.compareAgainstRunId !== current.runId
    || !rerun.comparisonKey || (latestComparisonKey && rerun.comparisonKey !== latestComparisonKey)
    || !Array.isArray(rerun.protocol) || rerun.protocol.length === 0
    || rerun.requiredIntegrity?.pageErrorCount !== 0 || rerun.requiredIntegrity?.nativeRequestCount !== 0
    || rerun.requiredIntegrity?.runtimeConstructionCount !== 0 || !Array.isArray(rerun.successCriteria)
    || !Array.isArray(diagnostics.caveats) || diagnostics.caveats.length < 3) {
    throw new Error(label + " must retain the exact comparable rerun, integrity gate, success criteria, and caveats.");
  }
}

function assertHistory(history, current, label) {
  if (!Array.isArray(history) || history.length === 0 || history.length > MAX_HISTORY_POINTS) {
    throw new Error(label + " must contain 1-" + MAX_HISTORY_POINTS + " retained trace points.");
  }
  const identities = new Set();
  let priorTime = -Infinity;
  for (const point of history) {
    const time = Date.parse(point?.generatedAt);
    const identity = point?.runId + "\n" + point?.generatedAt;
    if (point?.schema !== PERFORMANCE_TRACING_HISTORY_SCHEMA || !point.runId || !Number.isFinite(time)
      || !["pass", "fail"].includes(point.status) || !point.comparisonKey
      || !point.context || typeof point.context !== "object" || identities.has(identity)
      || time < priorTime) {
      throw new Error(label + " contains invalid, duplicate, or unordered points.");
    }
    identities.add(identity);
    priorTime = time;
    for (const key of ["startupReadyMs", "p95FrameMs", "p99FrameMs", "maxFrameMs", "over33msRatio", "p95StepCallMs", "maxStepCallMs", "residencyTransitionStepCount"]) {
      if (!Number.isFinite(point.metrics?.[key]) || point.metrics[key] < 0) {
        throw new Error(label + " contains an invalid " + key + " metric.");
      }
    }
    if (!point.budgets || !Number.isFinite(point.budgets.p95FrameMs)
      || !point.traceGroups || typeof point.traceGroups !== "object") {
      throw new Error(label + " must retain budgets and trace groups.");
    }
    for (const group of Object.values(point.traceGroups)) {
      if (!group?.label || !Number.isFinite(group.durationMs) || group.durationMs < 0
        || !Number.isFinite(group.count) || group.count < 0 || !Number.isFinite(group.maxMs) || group.maxMs < 0) {
        throw new Error(label + " contains an invalid trace group.");
      }
    }
  }
  const latest = history.at(-1);
  if (latest.runId !== current.runId || latest.generatedAt !== current.generatedAt
    || latest.status !== current.status || latest.metrics.p95FrameMs !== current.metrics.p95FrameMs) {
    throw new Error(label + " latest point must reconcile with the current report.");
  }
}

function assertRuns(runs, label) {
  if (!Array.isArray(runs) || runs.length === 0) throw new Error(label + " must contain retained browser runs.");
  for (const run of runs) {
    if (run?.status !== "passed" || !Number.isFinite(run.frameTiming?.p95FrameMs)
      || !Array.isArray(run.frameTiming?.series) || run.frameTiming.series.length === 0
      || !Number.isFinite(run.stepTiming?.p95StepCallMs) || !Array.isArray(run.stepTiming?.slowestSteps)
      || !Array.isArray(run.stepTiming?.series) || run.stepTiming.series.length === 0
      || run.stepTiming?.phaseTiming?.schema !== "runtime-dispatch-phase-summary@1"
      || !Number.isSafeInteger(run.stepTiming.phaseTiming.sampleCount) || run.stepTiming.phaseTiming.sampleCount < 1
      || !run.stepTiming.phaseTiming.phases || typeof run.stepTiming.phaseTiming.phases !== "object"
      || run.stepTiming?.cameraPhaseTiming?.schema !== "camera-publication-phase-summary@1"
      || !Number.isSafeInteger(run.stepTiming.cameraPhaseTiming.sampleCount) || run.stepTiming.cameraPhaseTiming.sampleCount < 1
      || !run.stepTiming.cameraPhaseTiming.phases || typeof run.stepTiming.cameraPhaseTiming.phases !== "object"
      || run.trace?.schema !== "browser-performance-trace-summary@2"
      || run.trace?.attributionMode !== "exclusive-classified-thread-time@1"
      || run.trace?.measurementWindow?.status !== "bounded"
      || !run.trace?.groups || typeof run.trace.groups !== "object") {
      throw new Error(label + " contains an incomplete retained browser run.");
    }
    for (const phase of Object.entries(run.stepTiming.phaseTiming.phases).map(([id, value]) => ({ id, ...value }))) {
      assertPhase(phase, label + " phase");
    }
    for (const phase of Object.entries(run.stepTiming.cameraPhaseTiming.phases).map(([id, value]) => ({ id, ...value }))) {
      assertPhase(phase, label + " camera phase");
    }
    for (const group of Object.values(run.trace.groups)) {
      if (!Array.isArray(group?.timeline?.values) || group.timeline.mode !== "exclusive-classified-thread-time"
        || !Number.isFinite(group.timeline.bucketDurationMs) || !Number.isFinite(group.inclusiveDurationMs)) {
        throw new Error(label + " contains a trace group without a source timeline.");
      }
    }
  }
}

function assertPhase(phase, label) {
  if (!phase?.id || !phase.label || !phase.producer || !phase.nextProbe || !Number.isSafeInteger(phase.sampleCount)
    || phase.sampleCount < 0 || !Number.isFinite(phase.totalMs) || phase.totalMs < 0
    || !Number.isFinite(phase.p95Ms) || phase.p95Ms < 0 || !Number.isFinite(phase.maxMs) || phase.maxMs < 0) {
    throw new Error(label + " is missing bounded timing, source producer, or next-probe evidence.");
  }
}

function isIsoTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && /T/u.test(value);
}
