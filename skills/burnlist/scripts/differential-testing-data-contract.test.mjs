import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPayload } from "../examples/differential-testing/adapter.mjs";
import {
  DIFFERENTIAL_TESTING_REFRESH_MS,
  differentialExactPrefixFrameDeltaMetrics,
  differentialExactTarget,
  differentialTelemetryFieldMap,
  differentialPayloadRevision,
  differentialRefreshStatusLabel,
  differentialHistoryPoints,
  differentialProgressChartHistory,
  differentialSampleStateIsNonPass,
  differentialTestingLoadingMarkup,
  mountDifferentialTestingDashboard,
  startDifferentialTestingLiveUpdates,
} from "../dashboard/differential-testing-renderer.js";
import { rollingStandardDeviationScores } from "../dashboard/differential-testing-progress-chart.js";
import {
  assertDifferentialTestingData,
  buildDifferentialTelemetry,
  differentialStateVectorSha256,
  DIFFERENTIAL_TESTING_EXACT_AUTHORITY,
  DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY,
  validateDifferentialTestingData,
} from "./differential-testing-data-contract.mjs";

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), "../examples/differential-testing");

test("frame delta residuals normalize against their rolling standard deviation", () => {
  const scores = rollingStandardDeviationScores(
    [0, 1, 1, 1, 1],
    [0, -2, -1, 1, 2],
    1,
    1,
  );
  assert.equal(scores[0], 0);
  assert.equal(scores[1], 0);
  assert.equal(Number(scores[2].toFixed(6)), -0.801784);
  assert.equal(Number(scores[3].toFixed(6)), 0.801784);
  assert.equal(Number(scores[4].toFixed(6)), 4);
});

test("frame delta normalization stays finite for locally flat residuals", () => {
  assert.deepEqual(
    rollingStandardDeviationScores([0, 1, 1, 1], [0, 0, 0, 0], 1, 15),
    [0, 0, 0, 0],
  );
});

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

const telemetryProvenance = Object.freeze({
  comparison: {
    referenceId: "reference-fixture",
    referenceSha256: "f".repeat(64),
    scenarioId: "fixture-scenario",
    alignmentKey: "tick",
  },
  baseline: { id: "baseline-fixture", artifactSha256: "a".repeat(64), contractSha256: "c".repeat(64), check: { status: "pass", id: "baseline-check@1", sha256: "d".repeat(64), subjectSha256: "a".repeat(64) } },
  candidate: { id: "candidate-fixture", artifactSha256: "b".repeat(64), contractSha256: "c".repeat(64), check: { status: "pass", id: "candidate-check@1", sha256: "e".repeat(64), subjectSha256: "b".repeat(64) } },
});

function telemetryPayloads({ baselineMode = "mixed" } = {}) {
  const [reference, candidateCapture] = populatedCaptures();
  const baselineCapture = structuredClone(candidateCapture);
  baselineCapture.captureId = "baseline-fixture";
  baselineCapture.generatedAt = "2026-01-01T11:59:00.000Z";
  if (baselineMode === "mixed") {
    baselineCapture.samples[1].values.position = 1.1;
    baselineCapture.samples[2].values.position = 2;
  } else if (baselineMode === "passing") {
    baselineCapture.samples[1].values.position = 1;
    baselineCapture.samples[2].values.position = 2;
  }
  const baseline = buildPayload(reference, baselineCapture);
  const candidate = buildPayload(reference, candidateCapture);
  const provenance = structuredClone(telemetryProvenance);
  provenance.comparison.scenarioId = candidate.scenarioCatalog.selectedScenarioId;
  provenance.baseline.contractSha256 = candidate.scenarioCatalog.scenarios[0].contractSha256;
  provenance.candidate.contractSha256 = candidate.scenarioCatalog.scenarios[0].contractSha256;
  for (const [label, payload] of [["baseline", baseline], ["candidate", candidate]]) {
    const stateVectorSha256 = differentialStateVectorSha256(payload);
    provenance[label].stateVectorSha256 = stateVectorSha256;
    provenance[label].stateVectorCheck = {
      status: "pass",
      id: `${label}-state-vector-check@1`,
      sha256: "8".repeat(64),
      subjectSha256: stateVectorSha256,
      artifactSha256: provenance[label].artifactSha256,
    };
  }
  return { baseline, candidate, provenance };
}

const exactDigests = Object.freeze({
  report: "1".repeat(64),
  runtime: "2".repeat(64),
  reference: "3".repeat(64),
  contract: "4".repeat(64),
  profile: "5".repeat(64),
  check: "8".repeat(64),
  prefix: "9".repeat(64),
  state: "a".repeat(64),
  replay: "b".repeat(64),
  refreshReport: "c".repeat(64),
});

function exactCheck(id, subjectSha256, status = "pass") {
  return { status, id, sha256: exactDigests.check, subjectSha256 };
}

function attachReadyExactSession(payload, {
  targetFieldId = "active",
  result = "advanced",
  sessionId = "retained-session-fixture",
  candidateSessionId = result === "advanced" ? sessionId : result === "rejected" ? "rejected-candidate-session" : null,
} = {}) {
  const target = payload.fields.find((field) => field.id === targetFieldId);
  assert.ok(target);
  const scenarioId = "0123456789abcdef";
  const scenarioFrameCount = 25;
  const clearedPrefixFrames = 12;
  const refreshIdentity = {
    refreshId: "refresh-fixture",
    scenarioId,
    reportSha256: exactDigests.refreshReport,
    runtimeTreeSha256: exactDigests.runtime,
    contractSha256: exactDigests.contract,
  };
  Object.assign(payload.log[0], refreshIdentity);
  Object.assign(payload.progress.at(-1), refreshIdentity);
  payload.scenarioCatalog = {
    selectedScenarioId: scenarioId,
    scenarios: [{
      id: scenarioId,
      label: "Fixture scenario",
      frameCount: scenarioFrameCount,
      replaySha256: exactDigests.replay,
      profileSha256: exactDigests.profile,
      contractSha256: exactDigests.contract,
      updatedAt: payload.publishedAt,
    }],
  };
  payload.refresh = {
    id: refreshIdentity.refreshId,
    status: "complete",
    scenarioId,
    event: { kind: "exact-prefix-advanced", revision: String(clearedPrefixFrames), occurredAt: payload.publishedAt },
    requestedAt: payload.publishedAt,
    startedAt: payload.publishedAt,
    completedAt: payload.publishedAt,
    error: null,
    report: {
      id: "refresh-report-fixture",
      generatedAt: payload.log[0].timestamp,
      artifactSha256: refreshIdentity.reportSha256,
      runtimeTreeSha256: refreshIdentity.runtimeTreeSha256,
      contractSha256: refreshIdentity.contractSha256,
      scenarioId,
      frameCount: scenarioFrameCount,
      replaySha256: exactDigests.replay,
      profileSha256: exactDigests.profile,
      result: payload.log[0].result,
      check: exactCheck("refresh-report-check@1", refreshIdentity.reportSha256),
    },
  };
  payload.exactSession = {
    strategy: "exact-first",
    status: "ready",
    authority: DIFFERENTIAL_TESTING_EXACT_AUTHORITY,
    blockers: [],
    result,
    session: {
      id: sessionId,
      generatedAt: payload.publishedAt,
      scenarioId,
      scenarioFrameCount,
      profileId: "profile-fixture",
      runtimeSide: "candidate",
      reportSha256: exactDigests.report,
      stateSha256: exactDigests.state,
      referenceSha256: exactDigests.reference,
      runtimeTreeSha256: exactDigests.runtime,
      replaySha256: exactDigests.replay,
      profileSha256: exactDigests.profile,
      contractSha256: exactDigests.contract,
      clearedPrefixFrames,
    },
    contract: {
      schema: "fixture-exact-contract@1",
      sha256: exactDigests.contract,
      scope: "source-semantic rows and stored values",
      order: ["frame", "control", "tick", "call", "phaseOrder", "phase", "operationId", "fieldId"],
      numericAuthority: "stored values and declared bit strings",
      retentionScope: "retained exact-prefix advancement only",
    },
    frontier: {
      kind: "divergence",
      frame: clearedPrefixFrames,
      control: 0,
      tick: 2,
      call: null,
      phaseOrder: 1,
      phase: "update",
      fieldId: target.id,
      label: target.label,
      sourceOwner: target.sourceOwner,
      operationId: "target-store",
      reference: target.samples.at(-1)[1],
      candidate: target.samples.at(-1)[2],
      referenceBits: "0x00000000",
      candidateBits: "0x00000001",
      prefixCount: clearedPrefixFrames,
      prefixSha256: exactDigests.prefix,
    },
    producer: {
      fieldId: target.id,
      label: `${target.label} producer`,
      sourceOwner: target.sourceOwner,
      sourceAnchor: `${target.sourceOwner}#target-store`,
      operationId: "target-store",
      frame: clearedPrefixFrames,
      tick: 2,
      phase: "update",
      candidateClass: "edit-candidate",
      verdict: "actionable",
      lifecycle: "source-phase",
      inputProof: "proven",
      provenance: "source-provided",
      dependencyCoverage: "covered",
      oracleMode: "strict",
      sourceOrder: "single-operation",
      changeScope: "single-source-coherent",
    },
    decision: {
      kind: "runtime-change",
      targetFieldId: target.id,
      targetLabel: `${target.label} producer`,
      nextAction: "Apply one source-coherent engine change and run the composed loop once.",
      blockers: [],
      retainedSessionId: sessionId,
      candidateSessionId,
    },
  };
  return payload;
}

function attachEvidenceOnlySession(payload) {
  attachReadyExactSession(payload, { result: "evidence-only", candidateSessionId: null });
  const exact = payload.exactSession;
  exact.producer.candidateClass = "coverage-gap";
  exact.producer.verdict = "evidence-gap";
  exact.producer.sourceAnchor = null;
  exact.producer.operationId = null;
  exact.producer.inputProof = "missing";
  exact.producer.provenance = "missing";
  exact.producer.dependencyCoverage = "gap";
  exact.producer.oracleMode = "source-blocked";
  exact.producer.sourceOrder = "unproven";
  exact.producer.changeScope = "unproven";
  exact.decision = {
    kind: "evidence-change",
    targetFieldId: null,
    targetLabel: null,
    nextAction: "Repair the focused source evidence seam and resume the same frontier.",
    blockers: [],
    retainedSessionId: exact.session.id,
    candidateSessionId: null,
  };
  return payload;
}

function attachCompleteExactSession(payload) {
  attachReadyExactSession(payload);
  const exact = payload.exactSession;
  exact.status = "complete";
  exact.result = "complete";
  exact.session.clearedPrefixFrames = exact.session.scenarioFrameCount;
  exact.frontier = {
    ...exact.frontier,
    kind: "complete",
    frame: exact.session.scenarioFrameCount,
    tick: exact.session.scenarioFrameCount,
    phase: null,
    fieldId: null,
    label: null,
    sourceOwner: null,
    operationId: null,
    reference: null,
    candidate: null,
    referenceBits: null,
    candidateBits: null,
    prefixCount: exact.session.scenarioFrameCount,
  };
  delete exact.producer;
  exact.decision = {
    kind: "complete",
    targetFieldId: null,
    targetLabel: null,
    nextAction: "Run end-of-scenario checks once.",
    blockers: [],
    retainedSessionId: exact.session.id,
    candidateSessionId: exact.session.id,
  };
  payload.refresh.event.revision = String(exact.session.scenarioFrameCount);
  return payload;
}

function attachBlockedExactSession(payload) {
  const blocker = "The retained exact evidence is incomplete.";
  payload.exactSession = {
    strategy: "exact-first",
    status: "blocked",
    authority: DIFFERENTIAL_TESTING_EXACT_AUTHORITY,
    blockers: [blocker],
    result: "blocked",
    decision: {
      kind: "blocked",
      targetFieldId: null,
      targetLabel: null,
      nextAction: "Repair the named evidence seam.",
      blockers: [blocker],
      retainedSessionId: null,
      candidateSessionId: null,
    },
  };
  return payload;
}
test("accepts the empty shipped example without inventing a run", () => {
  const payload = buildPayload(...emptyCaptures());
  assert.equal(payload.summary.runs.total, 0);
  assert.equal(payload.summary.fields.total, 0);
  assert.equal(payload.summary.frames.total, 0);
  assert.deepEqual(payload.progress, []);
  assert.deepEqual(payload.log, []);
  assert.deepEqual(payload.fields, []);
  assert.deepEqual(payload.scenarioCatalog, { selectedScenarioId: null, scenarios: [] });
  assert.equal(payload.refresh, null);
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
});

test("empty scenario state rejects fake selection and retained data", async (t) => {
  await t.test("selectedScenarioId must stay null", () => {
    const payload = buildPayload(...emptyCaptures());
    payload.scenarioCatalog.selectedScenarioId = "0123456789abcdef";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must be null when there are no scenarios/u);
  });
  await t.test("refresh must stay null", () => {
    const payload = buildPayload(...emptyCaptures());
    payload.refresh = {};
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must be null when there are no scenarios/u);
  });
  await t.test("history must stay empty", () => {
    const payload = buildPayload(...emptyCaptures());
    payload.log.push({ timestamp: payload.publishedAt, result: "blocked", value: 0, scenarioId: "0123456789abcdef" });
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must be empty when there are no scenarios/u);
  });
});

test("renderer shows the clean no-scenarios state without a fake id", () => {
  const payload = buildPayload(...emptyCaptures());
  const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const root = { innerHTML: "", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    mountDifferentialTestingDashboard(root, oven, payload);
  } finally {
    globalThis.window = previousWindow;
  }
  assert.match(root.innerHTML, /No Differential Testing scenarios/u);
  assert.match(root.innerHTML, /<option selected>No scenarios<\/option>/u);
  assert.doesNotMatch(root.innerHTML, /[a-f0-9]{16}/u);
});

test("Differential Testing loading state mirrors the generic Oven layout", () => {
  const html = differentialTestingLoadingMarkup();
  assert.match(html, /class="differential-testing-loading" aria-busy="true"/u);
  assert.match(html, /class="differential-testing-loading-visual" aria-hidden="true" inert/u);
  assert.match(html, /class="work-panel-title">Overview<\/div>/u);
  assert.match(html, />Loading scenario…</u);
  assert.match(html, /id="burnlist-detail" class="detail-view"/u);
  assert.match(html, /class="driving-parity-kpi-strip"/u);
  assert.match(html, /class="detail-workspace"/u);
  assert.match(html, /class="panel progress-panel"/u);
  assert.match(html, /class="panel work-panel"/u);
  assert.match(html, /data-progress-chart-mode="failed" aria-pressed="false"/u);
  assert.match(html, /data-progress-chart-mode="delta" aria-pressed="true"/u);
  assert.match(html, /id="driving-parity-page" class="driving-parity-page"/u);
  assert.match(html, /data-driving-parity-chart="current"[^>]+aria-pressed="false"/u);
  assert.match(html, /data-driving-parity-chart="delta"[^>]+aria-pressed="true"/u);
  assert.equal((html.match(/class="hybrid-row"/gu) || []).length, 0);
  assert.match(html, />Fields List</u);
  assert.doesNotMatch(html, /differential-loading-(?:placeholder|waffle)|driving-parity-kpi-gauge|checklist-log-table-header/u);
  assert.doesNotMatch(html, /(?:^|\n)\s*header\s*\{/u);
});

test("accepts populated data and reconciles its mismatch", () => {
  const payload = buildPayload(...populatedCaptures());
  assert.equal(payload.summary.fields.failed, 1);
  assert.equal(payload.summary.frames.failed, 1);
  assert.equal(payload.fields[0].firstFailingTick, 2);
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
});

test("rejects raw or project-specific packets outside the normalized top-level contract", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.rawReport = { rows: payload.fields };
  assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /rawReport.*not supported by the Differential Testing data contract/u);
  delete payload.rawReport;
  payload.log[0].command = "project-specific rerun";
  assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /command.*not supported by the result-row contract/u);
});

test("chart failure bands honor normalized sample state instead of strict raw equality", () => {
  const payload = buildPayload(...populatedCaptures());
  const withinTolerance = payload.fields[0].samples[1];
  const outsideTolerance = payload.fields[0].samples[2];

  assert.notEqual(withinTolerance[1], withinTolerance[2]);
  assert.equal(withinTolerance[3], 0);
  assert.equal(differentialSampleStateIsNonPass(withinTolerance[3]), false);
  assert.equal(outsideTolerance[3], 1);
  assert.equal(differentialSampleStateIsNonPass(outsideTolerance[3]), true);
  assert.equal(differentialSampleStateIsNonPass(2), true);
  assert.equal(differentialSampleStateIsNonPass(3), true);
  assert.equal(differentialSampleStateIsNonPass(4), true);
});

test("serialized decimal values at the declared tolerance boundary remain a match", () => {
  const payload = buildPayload(...populatedCaptures());
  const boundarySample = payload.fields[0].samples[1];
  boundarySample[2] = 1.01;
  assert.ok(Math.abs(boundarySample[1] - boundarySample[2]) > payload.fields[0].tolerance);
  assert.equal(boundarySample[3], 0);
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
});

test("zero tolerance remains exact for numeric samples", () => {
  const payload = buildPayload(...populatedCaptures());
  const field = payload.fields[0];
  field.tolerance = 0;
  field.samples[1] = [1, 1, 1 + 5e-13, 0];
  field.maxDelta = Math.max(...field.samples.map((sample) => Math.abs(sample[1] - sample[2])));
  const result = validateDifferentialTestingData(payload);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /disagrees with the values and tolerance/u);
});

test("dashboard JSON responses serialize compactly before sending headers", () => {
  const source = readFileSync(resolve(exampleDir, "../../scripts/burnlist-dashboard-server.mjs"), "utf8");
  const helper = source.match(/function json\(res, status, body\) \{[\s\S]+?\n\}/u)?.[0] ?? "";
  assert.match(helper, /const serialized = JSON\.stringify\(body\);[\s\S]+res\.writeHead[\s\S]+res\.end\(serialized\);/u);
  assert.doesNotMatch(helper, /JSON\.stringify\(body, null, 2\)/u);
});

test("rejects a sample state that disagrees with values and tolerance", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.fields[0].samples[2][3] = 0;
  const result = validateDifferentialTestingData(payload);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /disagrees with the values and tolerance/u);
});

test("rejects field tick identities that are merely positionally similar", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.fields[1].samples[1][0] = 1.5;
  const result = validateDifferentialTestingData(payload);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /tick identities must match/u);
});

test("keeps present null distinct from a missing sample", () => {
  const [reference, candidate] = populatedCaptures();
  reference.samples[1].values.active = null;
  candidate.samples[1].values.active = null;
  delete candidate.samples[2].values.active;
  const payload = buildPayload(reference, candidate);
  const active = payload.fields.find((field) => field.id === "active");
  assert.deepEqual(active.samples[1], [1, null, null, 0]);
  assert.deepEqual(active.samples[2], [2, true, null, 3]);
  assert.equal(active.failedSampleCount, 0);
  assert.equal(active.missingSampleCount, 1);
  assert.equal(active.trustStatus, "blocked");
  assert.equal(payload.trust.status, "blocked");
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
});

test("rejects summary totals that do not reconcile with raw samples", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.summary.frames.failed = 0;
  payload.summary.frames.passed += 1;
  assert.throws(() => assertDifferentialTestingData(payload), /summary\.frames/u);
});

test("rejects an unexplained blocked payload", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.trust.status = "blocked";
  payload.trust.blockers = [];
  assert.throws(() => assertDifferentialTestingData(payload), /must explain why trust is blocked/u);
});

test("accepts an unavailable payload that declares expected fields as blocked", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.trust = { status: "blocked", reportStatus: "blocked", blockers: ["The source capture failed validation."] };
  payload.fields = [];
  payload.progress = [];
  payload.log = [{ timestamp: payload.publishedAt, result: "blocked", value: 0, delta: null, failedFieldCount: 2, firstFailingTick: null, firstFailingLabel: "The source capture failed validation.", scenarioId: payload.scenarioCatalog.selectedScenarioId }];
  payload.summary.runs = { label: "Runs", total: 1, passed: 0, failed: 0, blocked: 1 };
  payload.summary.fields = { label: "Fields", total: 2, passed: 0, failed: 0, blocked: 2 };
  payload.summary.frames = { label: "Samples", total: 0, passed: 0, failed: 0, blocked: 0, uniqueTicks: 0 };
  payload.refresh = { ...payload.refresh, status: "failed", error: "The source capture failed validation." };
  delete payload.refresh.report;
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
});

test("builds sealed transition telemetry with exact per-field state transitions", () => {
  const { baseline, candidate, provenance } = telemetryPayloads();
  const telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
  assert.equal(telemetry.status, "comparable");
  assert.equal(telemetry.authority, DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY);
  assert.deepEqual(telemetry.comparison, provenance.comparison);
  assert.deepEqual(telemetry.summary, {
    failToPassCount: 1,
    passToFailCount: 1,
    stayedPassCount: 4,
    stayedFailCount: 0,
    netFailedSampleDelta: 0,
    residualCount: 0,
    reconciliation: "reconciled",
  });
  assert.equal(telemetry.fields.length, candidate.fields.length);
  assert.deepEqual(telemetry.fields[0], {
    id: "position",
    baselineFailedSampleCount: 1,
    candidateFailedSampleCount: 1,
    failToPassCount: 1,
    passToFailCount: 1,
    stayedPassCount: 1,
    stayedFailCount: 0,
    netFailedSampleDelta: 0,
    residualCount: 0,
    reconciliation: "reconciled",
    baselineStates: [0, 1, 0],
    transitions: [[1, 1, 0], [2, 0, 1]],
  });
  assert.deepEqual(telemetry.fields[1].transitions, []);
  candidate.telemetry = telemetry;
  assert.doesNotThrow(() => assertDifferentialTestingData(candidate));
});

test("keeps a globally worse telemetry candidate failed while exposing its local telemetry", () => {
  const { baseline, candidate, provenance } = telemetryPayloads({ baselineMode: "passing" });
  candidate.progress[0].result = "worsened";
  candidate.log[0].result = "worsened";
  candidate.refresh.report.result = "worsened";
  candidate.trust.reportStatus = "worsened";
  candidate.telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
  assert.equal(candidate.summary.frames.failed, 1);
  assert.equal(candidate.summary.fields.failed, 1);
  assert.equal(candidate.log[0].result, "worsened");
  assert.deepEqual(candidate.telemetry.summary, {
    failToPassCount: 0,
    passToFailCount: 1,
    stayedPassCount: 5,
    stayedFailCount: 0,
    netFailedSampleDelta: 1,
    residualCount: 0,
    reconciliation: "reconciled",
  });
  assert.equal(candidate.telemetry.authority, "telemetry-only");
  assert.doesNotThrow(() => assertDifferentialTestingData(candidate));
});

test("requires an exact trusted reference, scenario, and alignment binding", async (t) => {
  const validPayload = () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    candidate.telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
    return candidate;
  };

  await t.test("comparable payload omits comparison binding", () => {
    const payload = validPayload();
    delete payload.telemetry.comparison;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must bind the trusted reference, scenario, and alignment/u);
  });
  await t.test("comparison reference digest is malformed", () => {
    const payload = validPayload();
    payload.telemetry.comparison.referenceSha256 = "F".repeat(64);
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /lowercase 64-character SHA-256 digest/u);
  });
  await t.test("comparison carries an unsupported key", () => {
    const payload = validPayload();
    payload.telemetry.comparison.retentionEligible = true;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /not supported by the telemetry contract/u);
  });
  await t.test("builder provenance omits comparison binding", () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    delete provenance.comparison;
    assert.throws(() => buildDifferentialTelemetry(baseline, candidate, provenance), /comparison provenance must bind/u);
  });
  await t.test("builder comparison alignment is malformed", () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    provenance.comparison.alignmentKey = "";
    assert.throws(() => buildDifferentialTelemetry(baseline, candidate, provenance), /comparison alignmentKey must be a non-empty string/u);
  });
});

test("rejects telemetry seal, coverage, and aggregate arithmetic drift", async (t) => {
  const validPayload = () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    candidate.telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
    return candidate;
  };

  await t.test("contract seals differ", () => {
    const payload = validPayload();
    payload.telemetry.candidate.contractSha256 = "d".repeat(64);
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must equal the baseline contract/u);
  });
  await t.test("candidate failure seal differs from primary", () => {
    const payload = validPayload();
    payload.telemetry.candidate.failedSampleCount += 1;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must equal the primary failed sample total/u);
  });
  await t.test("one primary field is omitted", () => {
    const payload = validPayload();
    payload.telemetry.fields.pop();
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /exactly one entry for every primary field|missing primary field id/u);
  });
  await t.test("top net delta is inconsistent", () => {
    const payload = validPayload();
    payload.telemetry.summary.netFailedSampleDelta = 1;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /passToFailCount - failToPassCount/u);
  });
  await t.test("field baseline count is inconsistent", () => {
    const payload = validPayload();
    payload.telemetry.fields[0].baselineFailedSampleCount = 0;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /candidateFailedSampleCount - baselineFailedSampleCount/u);
  });
});

test("rejects malformed or unbound telemetry transitions", async (t) => {
  const validPayload = () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    candidate.telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
    return candidate;
  };

  await t.test("transition ticks are not strictly ordered", () => {
    const payload = validPayload();
    payload.telemetry.fields[0].transitions.reverse();
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /greater than the previous transition tick/u);
  });
  await t.test("candidate transition state disagrees with primary", () => {
    const payload = validPayload();
    payload.telemetry.fields[0].transitions[0][2] = 1;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /1-to-0 or 0-to-1|primary candidate state/u);
  });
  await t.test("transition tick is absent from the primary field", () => {
    const payload = validPayload();
    payload.telemetry.fields[0].transitions[0][0] = 1.5;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /does not identify a primary field sample tick/u);
  });
  await t.test("valid transition states cannot be relocated to another candidate tick", () => {
    const payload = validPayload();
    payload.telemetry.fields[0].transitions[0][0] = 0;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must equal the transitions reconstructed from baselineStates/u);
  });
  await t.test("baseline state vector cannot move a failure", () => {
    const payload = validPayload();
    payload.telemetry.fields[0].baselineStates = [1, 0, 0];
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must equal the transitions reconstructed from baselineStates/u);
  });
  await t.test("coherent baseline and transition relocation breaks the sealed state vector", () => {
    const payload = validPayload();
    payload.telemetry.fields[0].baselineStates = [1, 0, 0];
    payload.telemetry.fields[0].transitions = [[0, 1, 0], [2, 0, 1]];
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /canonical tick\/state vector reconstructed from baselineStates/u);
  });
});

test("telemetry builder rejects field contract, tick, reference, and seal drift", async (t) => {
  await t.test("field contract differs", () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    baseline.fields[0].semantics.meaning = "A different meaning";
    assert.throws(() => buildDifferentialTelemetry(baseline, candidate, provenance), /field contract differs/u);
  });
  await t.test("tick identity differs", () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    baseline.fields.forEach((field) => { field.samples[1][0] = 1.5; });
    baseline.fields[0].firstFailingTick = 1.5;
    provenance.baseline.stateVectorSha256 = differentialStateVectorSha256(baseline);
    provenance.baseline.stateVectorCheck.subjectSha256 = provenance.baseline.stateVectorSha256;
    assert.doesNotThrow(() => assertDifferentialTestingData(baseline));
    assert.throws(() => buildDifferentialTelemetry(baseline, candidate, provenance), /tick identity differs/u);
  });
  await t.test("reference value differs", () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    baseline.fields[0].samples[0][1] = 99;
    baseline.fields[0].samples[0][2] = 99;
    assert.doesNotThrow(() => assertDifferentialTestingData(baseline));
    assert.throws(() => buildDifferentialTelemetry(baseline, candidate, provenance), /reference value differs/u);
  });
  await t.test("contract seal differs", () => {
    const { baseline, candidate, provenance } = telemetryPayloads();
    provenance.candidate.contractSha256 = "d".repeat(64);
    assert.throws(() => buildDifferentialTelemetry(baseline, candidate, provenance), /contract SHA-256 digests must match/u);
  });
});

test("publication and artifact timestamps remain independently truthful", () => {
  const { baseline, candidate, provenance } = telemetryPayloads();
  provenance.baseline.generatedAt = "2025-12-31T23:58:00.000Z";
  provenance.candidate.generatedAt = "2026-01-01T11:58:00.000Z";
  const telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
  assert.equal(telemetry.baseline.generatedAt, provenance.baseline.generatedAt);
  assert.equal(telemetry.candidate.generatedAt, provenance.candidate.generatedAt);
  assert.notEqual(telemetry.candidate.generatedAt, candidate.publishedAt);
});

test("blocked transition telemetry explains itself and carries no comparison claims", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.telemetry = {
    status: "blocked",
    authority: DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY,
    blockers: ["Baseline and candidate contracts differ."],
  };
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));

  payload.telemetry.blockers = [];
  assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must explain why transition telemetry is blocked/u);
  payload.telemetry.blockers = ["Baseline and candidate contracts differ."];
  payload.telemetry.summary = { failToPassCount: 0, passToFailCount: 0, netFailedSampleDelta: 0 };
  payload.telemetry.fields = [];
  assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must be absent when transition telemetry is blocked/u);
});

test("comparable transition telemetry requires unblocked primary samples", () => {
  const { baseline, candidate, provenance } = telemetryPayloads();
  const telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
  const [reference, missingCandidate] = populatedCaptures();
  delete missingCandidate.samples[2].values.active;
  const blockedPayload = buildPayload(reference, missingCandidate);
  blockedPayload.telemetry = telemetry;
  const messages = validateDifferentialTestingData(blockedPayload).issues.map((entry) => entry.message).join("\n");
  assert.match(messages, /must be pass when transition telemetry is comparable|cannot be comparable while primary fields or samples are blocked/u);
});

test("accepts the compact retained exact session and exposes only its ready target", () => {
  const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  assert.deepEqual(differentialExactTarget(payload), {
    mode: "exact",
    status: "ready",
    fieldId: "active",
    label: "Active producer",
    reason: "Apply one source-coherent engine change and run the composed loop once.",
  });
  assert.equal(payload.exactSession.result, "advanced");
  assert.equal(payload.exactSession.session.referenceSha256, exactDigests.reference);
});

test("accepts exact completion without a producer", () => {
  const payload = attachCompleteExactSession(buildPayload(...populatedCaptures()));
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  assert.equal(payload.exactSession.producer, undefined);
  assert.deepEqual(differentialExactTarget(payload), {
    mode: "exact",
    status: "complete",
    fieldId: null,
    label: null,
    reason: "Exact contract is complete; scenario PASS or FAIL is reported separately.",
  });
});

test("exact completion cannot turn blocked primary evidence into a scenario pass", () => {
  const [reference, candidate] = populatedCaptures();
  delete candidate.samples[2].values.active;
  const payload = attachCompleteExactSession(buildPayload(reference, candidate));
  payload.refresh.report.result = "pass";
  payload.log[0].result = "pass";
  payload.progress.at(-1).result = "pass";
  payload.summary.runs = { label: "Runs", total: 1, passed: 1, failed: 0, blocked: 0 };

  const messages = validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n");
  assert.match(messages, /reportStatus.*completed refresh report result|must be blocked when primary trust is blocked/u);
  assert.match(messages, /pass only when every primary field and sample passes/u);
});

test("blocked exact authority fails closed without an aggregate target", () => {
  const payload = attachBlockedExactSession(buildPayload(...populatedCaptures()));
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  assert.deepEqual(differentialExactTarget(payload), {
    mode: "exact",
    status: "blocked",
    fieldId: null,
    label: null,
    reason: "The retained exact evidence is incomplete.",
  });
});

test("rejected candidates preserve the retained session identity", () => {
  const payload = attachReadyExactSession(buildPayload(...populatedCaptures()), { result: "rejected" });
  const retainedId = payload.exactSession.session.id;
  assert.notEqual(payload.exactSession.decision.candidateSessionId, retainedId);
  assert.equal(payload.exactSession.decision.retainedSessionId, retainedId);
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));

  payload.exactSession.decision.candidateSessionId = retainedId;
  assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must differ from the retained session id/u);
});

test("event-driven refresh states are strict and cadence-free", async (t) => {
  await t.test("queued refresh has not started", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.refresh = { ...payload.refresh, status: "queued", startedAt: null, completedAt: null, error: null };
    delete payload.refresh.report;
    assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  });

  await t.test("running refresh has started but has no report", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.refresh = { ...payload.refresh, status: "running", completedAt: null, error: null };
    delete payload.refresh.report;
    assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  });

  await t.test("failed refresh explains the failure", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.refresh = { ...payload.refresh, status: "failed", error: "Full-scenario report failed." };
    delete payload.refresh.report;
    assert.doesNotThrow(() => assertDifferentialTestingData(payload));
    payload.refresh.error = null;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must explain the refresh failure/u);
  });

  await t.test("old cadence keys have no compatibility path", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.refresh.nextBoundary = 20;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /nextBoundary.*not supported by the refresh contract/u);
  });
});

test("direct retained-session bindings reconcile contract, frontier, and selected scenario", async (t) => {
  const validPayload = () => attachReadyExactSession(buildPayload(...populatedCaptures()));

  await t.test("contract digest differs", () => {
    const payload = validPayload();
    payload.exactSession.session.contractSha256 = "f".repeat(64);
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /retained exact contract SHA-256|retained exact-session contract SHA-256/u);
  });

  await t.test("trusted reference binding is absent", () => {
    const payload = validPayload();
    delete payload.exactSession.session.referenceSha256;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /session\.referenceSha256/u);
  });

  await t.test("frontier is not the first uncleared frame", () => {
    const payload = validPayload();
    payload.exactSession.frontier.frame += 1;
    payload.exactSession.producer.frame += 1;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /first frame after clearedPrefixFrames/u);
  });

  await t.test("catalog selects another scenario", () => {
    const payload = validPayload();
    const otherScenarioId = "fedcba9876543210";
    payload.scenarioCatalog.scenarios.push({ ...payload.scenarioCatalog.scenarios[0], id: otherScenarioId, label: "Other scenario" });
    payload.scenarioCatalog.selectedScenarioId = otherScenarioId;
    payload.refresh.scenarioId = otherScenarioId;
    payload.refresh.report.scenarioId = otherScenarioId;
    payload.log[0].scenarioId = otherScenarioId;
    payload.progress.at(-1).scenarioId = otherScenarioId;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /retained exact-session scenario id/u);
  });

  await t.test("refresh names another scenario", () => {
    const payload = validPayload();
    payload.refresh.scenarioId = "fedcba9876543210";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /selected scenario id|refresh scenario id/u);
  });

  await t.test("history contains another scenario", () => {
    const payload = validPayload();
    payload.log[0].scenarioId = "fedcba9876543210";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must equal the selected scenario id/u);
  });

  await t.test("completed refresh may honestly lag the retained prefix", () => {
    const payload = validPayload();
    payload.refresh.event.revision = "11";
    assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  });

  await t.test("running refresh may honestly lag the retained prefix", () => {
    const payload = validPayload();
    payload.refresh.status = "running";
    payload.refresh.event.revision = "11";
    payload.refresh.completedAt = null;
    delete payload.refresh.report;
    assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  });

  await t.test("refresh event cannot be ahead of the retained prefix", () => {
    const payload = validPayload();
    payload.refresh.event.revision = "13";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must not be ahead of retained clearedPrefixFrames/u);
  });

  for (const revision of ["01", "11.0", "+11", "-1", "not-a-revision"]) {
    await t.test(`exact-prefix revision ${JSON.stringify(revision)} is not canonical decimal`, () => {
      const payload = validPayload();
      payload.refresh.event.revision = revision;
      assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /canonical non-negative decimal integer/u);
    });
  }
});

test("refresh reports may bind one compact adapter-attested execution closure", async (t) => {
  const validPayload = () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.refresh.report.executionClosure = {
      schema: "fixture-execution-closure@1",
      id: "execution-closure-fixture",
      sha256: "d".repeat(64),
      size: 2048,
    };
    return payload;
  };

  await t.test("accepts schema, id, digest, and size without project paths or bytes", () => {
    assert.doesNotThrow(() => assertDifferentialTestingData(validPayload()));
  });

  await t.test("rejects project-owned path leakage", () => {
    const payload = validPayload();
    payload.refresh.report.executionClosure.path = "/project/.local/execution-closure.json";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /executionClosure\.path.*not supported by the execution-closure contract/u);
  });

  await t.test("rejects an invalid digest", () => {
    const payload = validPayload();
    payload.refresh.report.executionClosure.sha256 = "not-a-digest";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /executionClosure\.sha256.*lowercase .*SHA-256/u);
  });

  await t.test("rejects an empty artifact", () => {
    const payload = validPayload();
    payload.refresh.report.executionClosure.size = 0;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /executionClosure\.size.*greater than zero/u);
  });
});

test("runtime targets fail closed on incomplete producer readiness", async (t) => {
  const validPayload = () => attachReadyExactSession(buildPayload(...populatedCaptures()));

  await t.test("source input proof is missing", () => {
    const payload = validPayload();
    payload.exactSession.producer.inputProof = "missing";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must be proven or not-applicable/u);
  });

  await t.test("decision targets another field", () => {
    const payload = validPayload();
    payload.exactSession.decision.targetFieldId = "position";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /surfaced producer field id/u);
  });

  await t.test("source order and change scope disagree", () => {
    const payload = validPayload();
    payload.exactSession.producer.changeScope = "atomic-source-order";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must match single-operation readiness/u);
  });
});

test("evidence-only work carries no runtime target or candidate session", () => {
  const payload = attachEvidenceOnlySession(buildPayload(...populatedCaptures()));
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  assert.equal(payload.exactSession.decision.candidateSessionId, null);
  assert.deepEqual(differentialExactTarget(payload), {
    mode: "exact",
    status: "no-target",
    fieldId: null,
    label: null,
    reason: "Repair the focused source evidence seam and resume the same frontier.",
  });
});

test("result and status consistency is strict", async (t) => {
  await t.test("ready cannot claim complete", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.exactSession.result = "complete";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /advanced, rejected, or evidence-only when ready/u);
  });

  await t.test("advanced candidate must become retained", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.exactSession.decision.candidateSessionId = "unretained-candidate";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must equal the retained session id when the candidate is kept/u);
  });

  await t.test("evidence-only cannot claim an engine candidate", () => {
    const payload = attachEvidenceOnlySession(buildPayload(...populatedCaptures()));
    payload.exactSession.decision.candidateSessionId = "candidate-session";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must be null for an evidence-only result/u);
  });
});

test("removed ceremony keys are rejected with no compatibility path", async (t) => {
  const schemaText = readFileSync(resolve(exampleDir, "../../contracts/differential-testing-data.schema.json"), "utf8");
  for (const removedDefinition of ["exactCycles", "exactComparison", "exactBinding", "exactLifecycle", "telemetryGate", "cadenceFrames", "nextBoundary", "gateId"]) {
    assert.doesNotMatch(schemaText, new RegExp(`"${removedDefinition}"`, "u"));
  }

  for (const key of ["bindings", "lifecycle", "exactComparison"]) {
    await t.test(`rejects exactSession.${key}`, () => {
      const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
      payload.exactSession[key] = key === "bindings" ? [] : {};
      assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), new RegExp(`${key}.*not supported by the exact-session contract`, "u"));
    });
  }

  await t.test("rejects top-level exactCycles", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.exactCycles = [];
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /exactCycles.*not supported by the Differential Testing data contract/u);
  });

  await t.test("rejects the removed telemetryGate", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.telemetryGate = {};
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /telemetryGate.*not supported by the Differential Testing data contract/u);
  });

  await t.test("rejects old producer patchScope", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.exactSession.producer.patchScope = payload.exactSession.producer.changeScope;
    delete payload.exactSession.producer.changeScope;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /patchScope.*not supported by the exact-session contract/u);
  });
});

test("telemetry remains observational and cannot veto exact retention", () => {
  const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
  payload.refresh.report.result = "worsened";
  payload.log[0].result = "worsened";
  payload.progress.at(-1).result = "worsened";
  payload.trust.reportStatus = "worsened";
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  assert.equal(payload.exactSession.result, "advanced");
  assert.equal(payload.telemetry?.authority ?? DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY, "telemetry-only");
});

test("an invalid exact strategy fails closed instead of selecting an aggregate target", () => {
  const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
  payload.exactSession.strategy = "invalid";
  const target = differentialExactTarget(payload);
  assert.equal(target.mode, "exact");
  assert.equal(target.status, "blocked");
  assert.equal(target.fieldId, null);
  assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /must equal exact-first/u);
});
test("dashboard helpers preserve losing runs and observe telemetry and exact-session revisions", () => {
  const points = [
    { timestamp: "2026-01-01T12:00:00.000Z", result: "unchanged", value: 100 },
    { timestamp: "2026-01-01T12:00:02.000Z", result: "worsened", value: 500 },
    { timestamp: "2026-01-01T12:00:04.000Z", result: "improved", value: 100 },
  ];
  const preserved = differentialHistoryPoints(points);
  assert.deepEqual(preserved, points);
  assert.notEqual(preserved, points);

  const framePayload = {
    progress: [
      { timestamp: points[0].timestamp, frames: 1_000, frame: 197, frameDelta: null },
      { timestamp: points[1].timestamp, frames: 1_000, frame: 238, frameDelta: 41 },
    ],
  };
  const valueHistory = differentialProgressChartHistory(framePayload, { mode: "value" });
  assert.deepEqual(valueHistory.map((point) => Number(point.percent.toFixed(1))), [19.7, 23.8]);
  assert.deepEqual(valueHistory.map((point) => point.done), [197, 238]);
  const deltaHistory = differentialProgressChartHistory(framePayload, { mode: "delta" });
  assert.deepEqual(deltaHistory.map((point) => Number(point.percent.toFixed(1))), [0, 4.1]);
  assert.deepEqual(deltaHistory.map((point) => point.done), [0, 41]);

  const exactMetrics = differentialExactPrefixFrameDeltaMetrics(framePayload, {
    frameDeviationRatios: Array(1_000).fill(0.2),
    firstFailingFrame: 0,
  });
  assert.deepEqual(exactMetrics.frameDeviationRatios.slice(236, 240), [0, 0, 0.2, 0.2]);
  assert.equal(exactMetrics.firstFailingFrame, 238);
  assert.equal(differentialExactPrefixFrameDeltaMetrics(framePayload, null), null);

  const payload = { publishedAt: points[2].timestamp, adapter: { id: "fixture" }, summary: {}, progress: points.slice(), log: [], fields: [{ id: "field-a", label: "Field A", samples: [] }], telemetry: {
    status: "comparable",
    baseline: { artifactSha256: "a".repeat(64) },
    candidate: { artifactSha256: "b".repeat(64) },
    summary: { failToPassCount: 1, passToFailCount: 2, netFailedSampleDelta: 1 },
  } };
  payload.fields[0].samples = Array.from({ length: 2_000 }, (_, index) => [index, index, index, 0]);
  const before = differentialPayloadRevision(payload);
  payload.fields[0].samples[0][2] = 1;
  payload.fields[0].samples[0][3] = 1;
  const afterSamples = differentialPayloadRevision(payload);
  assert.notEqual(afterSamples, before);
  payload.telemetry.candidate.artifactSha256 = "c".repeat(64);
  const afterTelemetry = differentialPayloadRevision(payload);
  assert.notEqual(afterTelemetry, afterSamples);
  payload.exactSession = { strategy: "exact-first", status: "blocked", blockers: ["Missing checked frontier."] };
  const afterExact = differentialPayloadRevision(payload);
  assert.notEqual(afterExact, afterTelemetry);
  payload.exactSession.blockers = ["Checked frontier changed."];
  const afterExactBlocker = differentialPayloadRevision(payload);
  assert.notEqual(afterExactBlocker, afterExact);
  payload.progress.push({ timestamp: "2026-01-01T12:00:06.000Z", result: "improved", value: 50 });
  const afterProgress = differentialPayloadRevision(payload);
  assert.notEqual(afterProgress, afterExactBlocker);
  payload.fields[0].label = "Renamed field";
  assert.notEqual(differentialPayloadRevision(payload), afterProgress);
});

test("refresh states map to the compact selector status", () => {
  assert.equal(differentialRefreshStatusLabel({ status: "queued" }), "Queued");
  assert.equal(differentialRefreshStatusLabel({ status: "running" }), "Updating");
  assert.equal(differentialRefreshStatusLabel({ status: "complete" }), "");
  assert.equal(differentialRefreshStatusLabel({ status: "failed" }), "Update failed");
  assert.equal(differentialRefreshStatusLabel({ status: "complete" }, "loading"), "Loading");
  assert.equal(differentialRefreshStatusLabel({ status: "complete" }, "queued"), "Queued");
  assert.equal(differentialRefreshStatusLabel({ status: "complete" }, "running"), "Updating");
});

test("Changed renders telemetry transitions while primary field status stays failing", () => {
  const { baseline, candidate, provenance } = telemetryPayloads({ baselineMode: "passing" });
  candidate.progress[0].result = "worsened";
  candidate.log[0].result = "worsened";
  candidate.refresh.report.result = "worsened";
  candidate.trust.reportStatus = "worsened";
  candidate.telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
  assert.equal(differentialTelemetryFieldMap(candidate).size, candidate.fields.length);

  const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const controls = { value: "", focus() {}, setSelectionRange() {} };
  const root = {
    innerHTML: "",
    addEventListener() {},
    querySelector: () => controls,
    querySelectorAll: () => [],
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    mountDifferentialTestingDashboard(root, oven, candidate);
  } finally {
    globalThis.window = previousWindow;
  }
  const renderedHtml = root.innerHTML;
  assert.match(renderedHtml, /0 F→P/u);
  assert.match(renderedHtml, /1 P→F/u);
  assert.match(renderedHtml, /telemetry only/u);
  assert.match(renderedHtml, /class="hybrid-row fail"/u);
  assert.match(renderedHtml, />Position</u);
  assert.doesNotMatch(renderedHtml, /data-row-expand-key="active"/u);
});

test("exact authority stays in the data contract without adding a non-template panel", () => {
  const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
  const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const controls = { value: "", focus() {}, setSelectionRange() {} };
  const root = {
    innerHTML: "",
    addEventListener() {},
    querySelector: () => controls,
    querySelectorAll: () => [],
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    mountDifferentialTestingDashboard(root, oven, payload);
  } finally {
    globalThis.window = previousWindow;
  }
  const renderedHtml = root.innerHTML;
  assert.equal(differentialExactTarget(payload).fieldId, "active");
  assert.doesNotMatch(renderedHtml, /differential-exact-session|Exact authority/u);
  assert.match(renderedHtml, />Active</u);
  assert.match(renderedHtml, />Position</u);
  assert.doesNotMatch(renderedHtml, />Cards</u);
  assert.doesNotMatch(renderedHtml, />Table</u);
});

test("evidence work never appears as a runtime Target", () => {
  const payload = attachEvidenceOnlySession(buildPayload(...populatedCaptures()));
  payload.exactSession.decision.nextAction = "Record the missing exact evidence.";
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  assert.deepEqual(differentialExactTarget(payload), {
    mode: "exact",
    status: "no-target",
    fieldId: null,
    label: null,
    reason: "Record the missing exact evidence.",
  });
});

test("dashboard Delta chart stays source-backed while the log reports frame advances", () => {
  const payload = buildPayload(...populatedCaptures());
  const baselineLog = payload.log[0];
  payload.log = [
    { ...baselineLog, timestamp: "2026-01-01T12:00:02.000Z", result: "improved", value: 845_738, delta: -801, frames: 1_000, frame: 238, frameDelta: 41 },
    { ...baselineLog, timestamp: "2026-01-01T12:00:00.000Z", result: "unchanged", value: 846_539, delta: null, frames: 1_000, frame: 197, frameDelta: null },
  ];
  payload.progress = [...payload.log].reverse();
  const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const controls = { value: "", focus() {}, setSelectionRange() {} };
  const root = { innerHTML: "", addEventListener() {}, querySelector: () => controls, querySelectorAll: () => [] };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    mountDifferentialTestingDashboard(root, oven, payload);
  } finally {
    globalThis.window = previousWindow;
  }
  const renderedHtml = root.innerHTML;
  assert.equal(root.className, "shell driving-parity-view");
  assert.doesNotMatch(root.innerHTML, /class="shell driving-parity-view/u);
  assert.match(root.innerHTML, /class="driving-parity-kpi-heading">Results</u);
  assert.match(root.innerHTML, /class="driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress"/u);
  assert.match(root.innerHTML, /class="driving-parity-kpi-heading">Progress<\/span>/u);
  assert.match(root.innerHTML, /class="driving-parity-kpi-progress-donut-segment"[^>]+stroke-dasharray="23\.800 76\.200"/u);
  assert.ok(root.innerHTML.indexOf('driving-parity-kpi-progress') < root.innerHTML.indexOf('driving-parity-kpi-burns'));
  assert.match(root.innerHTML, /class="pass">238<\/span><span class="separator">\/<\/span><span class="total">1,000 \(23\.8%\)<\/span>/u);
  assert.match(root.innerHTML, /class="driving-parity-kpi-heading differential-scenario-heading">Scenario</u);
  assert.match(root.innerHTML, /id="differential-scenario-selector"/u);
  assert.match(root.innerHTML, /id="progress-panel-title">Parity Progress<\/h2>/u);
  assert.match(root.innerHTML, /class="work-panel-title">Parity Progress<\/div>/u);
  assert.doesNotMatch(root.innerHTML, /class="work-panel-title">Parity Progress<span/u);
  assert.match(root.innerHTML, /class="label-toggle progress-chart-toggle differential-tabs"/u);
  assert.match(root.innerHTML, /id="progress-headline">0\/0</u);
  assert.match(root.innerHTML, /data-work-tab-pane="timeline" hidden/u);
  assert.match(root.innerHTML, /id="target-summaries-toggle"/u);
  assert.match(root.innerHTML, /id="log-file-changes-toggle"/u);
  assert.match(root.innerHTML, /id="detail-repo-graph-panel" hidden/u);
  assert.match(root.innerHTML, /id="focused-functions-panel" hidden/u);
  assert.match(root.innerHTML, /id="driving-parity-inline-renderer"/u);
  assert.doesNotMatch(root.innerHTML, /id="driving-parity-frame"|srcdoc=/u);
  assert.match(root.innerHTML, /id="sort-mode" aria-label="sort cards"/u);
  assert.match(root.innerHTML, /class="coverage" id="coverage"/u);
  assert.doesNotMatch(root.innerHTML, />Δ /u);
  assert.match(root.innerHTML, /class="hybrid-value-delta">0\.1000<\/span>/u);
  assert.match(root.innerHTML, /class="hybrid-value-delta">0<\/span>/u);
  assert.match(root.innerHTML, /class="checklist-log-table-header"><span>Age<\/span><span>Frame<\/span><span>Result<\/span><span>Delta<\/span><span>Done<\/span>/u);
  assert.match(root.innerHTML, /class="log-table-cell failed improved">238<\/span>/u);
  assert.match(root.innerHTML, /class="log-delta-indicator">▲<\/span><span>41<\/span>/u);
  assert.match(root.innerHTML, /class="log-table-cell delta improved">4\.1%<\/span><span class="log-table-cell done">24%<\/span>/u);
  assert.match(root.innerHTML, /class="log-table-cell failed unchanged">197<\/span>/u);
  assert.match(root.innerHTML, /class="log-table-cell result unchanged">—<\/span><span class="log-table-cell delta unchanged">—<\/span><span class="log-table-cell done">20%<\/span>/u);
  assert.equal((root.innerHTML.match(/class="log-row no-detail log-table-row log-placeholder-row"/gu) || []).length, 8);
  assert.match(root.innerHTML, /log-placeholder-row" aria-hidden="true"><span class="log-table-cell age">\.<\/span>(?:<span class="log-table-cell">\.<\/span>){4}/u);
  assert.match(root.innerHTML, /class="log-table-cell age">(?:now|\d+m)<\/span>/u);
  assert.doesNotMatch(root.innerHTML, /class="log-table-cell age">\d+[hd]<\/span>/u);
  assert.match(root.innerHTML, /id="driving-parity-controls" class="driving-parity-controls"/u);
  assert.match(root.innerHTML, /id="driving-parity-chart-toggle" class="chart-toggle differential-tabs"/u);
  assert.match(root.innerHTML, /data-progress-chart-mode="failed" aria-pressed="false"/u);
  assert.match(root.innerHTML, /data-progress-chart-mode="delta" aria-pressed="true"/u);
  assert.match(root.innerHTML, /data-driving-parity-chart="delta"[^>]+aria-pressed="true"/u);
  assert.doesNotMatch(root.innerHTML, /differential-(?:page|workspace|toolbar|controls|kpi-strip)/u);
  assert.equal((renderedHtml.match(/class="frame-tick-label"/gu) || []).length, 1);
});

test("KPI failed totals use the same million compaction as total samples", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.summary.frames = {
    total: 11_692_000,
    passed: 10_331_585,
    failed: 896_810,
    blocked: 463_605,
    uniqueTicks: 1_000,
  };
  const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const controls = { value: "", focus() {}, setSelectionRange() {} };
  const root = { innerHTML: "", addEventListener() {}, querySelector: () => controls, querySelectorAll: () => [] };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    mountDifferentialTestingDashboard(root, oven, payload);
  } finally {
    globalThis.window = previousWindow;
  }
  assert.match(root.innerHTML, /class="driving-parity-kpi-heading">Frames<\/span><span class="driving-parity-kpi-ratio"><span class="total">11,692k<\/span><span class="separator">·<\/span><span class="fail">1,360k \(11\.6%\)<\/span>/u);
});

test("project payloads cannot rename the generic Differential Testing Oven", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.title = "Project Alpha Differential Testing";
  const oven = { name: "Differential Testing", detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const controls = { value: "", focus() {}, setSelectionRange() {} };
  const root = { innerHTML: "", addEventListener() {}, querySelector: () => controls, querySelectorAll: () => [] };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    mountDifferentialTestingDashboard(root, oven, payload);
  } finally {
    globalThis.window = previousWindow;
  }
  assert.match(root.innerHTML, /class="work-panel-head differential-overview-head"><div class="work-panel-title">Overview<\/div><div class="differential-overview-meta">[\s\S]*<time id="differential-overview-time"/u);
  assert.match(root.innerHTML, /class="sep" aria-hidden="true">·<\/span>/u);
  assert.doesNotMatch(root.innerHTML, /class="driving-parity-kpi-title">Differential Testing<\/span>/u);
  assert.doesNotMatch(root.innerHTML, /Project Alpha Differential Testing/u);
});

test("Value charts merge contiguous failing reference intervals into bounded SVG paths", () => {
  const renderReferencePathCount = (states) => {
    const payload = buildPayload(...populatedCaptures());
    const field = structuredClone(payload.fields[0]);
    field.samples = states.map((state, tick) => [tick, tick, tick + 1, state]);
    field.failedSampleCount = states.filter((state) => state !== 0).length;
    payload.fields = [field];
    const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
    const controls = { value: "", focus() {}, setSelectionRange() {} };
    const listeners = new Map();
    const root = { innerHTML: "", addEventListener(type, listener) { listeners.set(type, listener); }, querySelector: () => controls, querySelectorAll: () => [] };
    const previousWindow = globalThis.window;
    globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
    try {
      mountDifferentialTestingDashboard(root, oven, payload);
      listeners.get("click")({
        target: {
          closest: (selector) => selector === "[data-driving-parity-chart]"
            ? { dataset: { drivingParityChart: "current" } }
            : null,
        },
      });
    } finally {
      globalThis.window = previousWindow;
    }
    return (root.innerHTML.match(/<path d="[^"]+" fill="none" stroke="#61d394" stroke-width="1\.25" stroke-dasharray="5 4"/gu) || []).length;
  };

  assert.equal(renderReferencePathCount(Array(1_000).fill(1)), 1);
  assert.equal(renderReferencePathCount([1, 0, 0, 1, 0, 0, 1]), 3);
});

test("default field ordering does not rescan the payload inside a sort comparator", () => {
  const payload = buildPayload(...populatedCaptures());
  payload.fields.indexOf = () => { throw new Error("quadratic field-order lookup"); };
  const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const controls = { value: "", focus() {}, setSelectionRange() {} };
  const root = { innerHTML: "", addEventListener() {}, querySelector: () => controls, querySelectorAll: () => [] };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    assert.doesNotThrow(() => mountDifferentialTestingDashboard(root, oven, payload));
  } finally {
    globalThis.window = previousWindow;
  }
});

test("scenario selector requests another published scenario and shows Loading", () => {
  const payload = buildPayload(...populatedCaptures());
  const secondScenario = { ...payload.scenarioCatalog.scenarios[0], id: "fedcba9876543210", label: "Second scenario" };
  payload.scenarioCatalog.scenarios.push(secondScenario);
  const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const controls = { value: "", focus() {}, setSelectionRange() {} };
  const listeners = new Map();
  const root = { innerHTML: "", addEventListener(type, listener) { listeners.set(type, listener); }, querySelector: () => controls, querySelectorAll: () => [] };
  const selected = [];
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    mountDifferentialTestingDashboard(root, oven, payload, { onScenarioChange: (scenarioId) => selected.push(scenarioId) });
    listeners.get("change")({ target: { value: secondScenario.id, matches: (selector) => selector === "#differential-scenario-selector" } });
  } finally {
    globalThis.window = previousWindow;
  }
  assert.deepEqual(selected, [secondScenario.id]);
  assert.match(root.innerHTML, new RegExp(`<option value="${secondScenario.id}" selected>${secondScenario.id}</option>`, "u"));
  assert.doesNotMatch(root.innerHTML, />Second scenario<\/option>/u);
  assert.match(root.innerHTML, /id="differential-refresh-status"[^>]*>Loading</u);
  assert.match(root.innerHTML, /class="differential-overview-meta">[\s\S]*id="differential-refresh-status"[^>]*>Loading<[\s\S]*id="differential-overview-time"/u);
});

test("first-row tick cadence and label clearance match the shared hybrid reference", () => {
  const [reference, candidate] = populatedCaptures();
  reference.samples = Array.from({ length: 21 }, (_, tick) => ({ tick, values: { position: tick, active: tick > 0 } }));
  candidate.samples = structuredClone(reference.samples);
  const payload = buildPayload(reference, candidate);
  const oven = { detail: JSON.parse(readFileSync(resolve(exampleDir, "../../ovens/differential-testing/detail.json"), "utf8")) };
  const controls = { value: "", focus() {}, setSelectionRange() {} };
  const root = { innerHTML: "", addEventListener() {}, querySelector: () => controls, querySelectorAll: () => [] };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, clearTimeout() {}, setTimeout() {} };
  try {
    mountDifferentialTestingDashboard(root, oven, payload);
  } finally {
    globalThis.window = previousWindow;
  }
  assert.equal((root.innerHTML.match(/class="frame-tick-label"/gu) || []).length, 3);
  assert.equal((root.innerHTML.match(/class="frame-tick"[^>]+y1="13"/gu) || []).length, 3);
});

test("live Differential Testing dashboard paints the canonical skeleton before its first payload arrives", async () => {
  let releaseFetch;
  const fetchGate = new Promise((resolveFetch) => { releaseFetch = resolveFetch; });
  const root = { innerHTML: "" };
  const payload = buildPayload(...populatedCaptures());
  const controller = startDifferentialTestingLiveUpdates(root, {
    fetchImpl: async (url) => {
      await fetchGate;
      if (url === "/api/ovens/differential-testing") {
        return { ok: true, async json() { return { oven: {} }; } };
      }
      return {
        ok: true,
        headers: { get: () => null },
        async json() { return { payload }; },
      };
    },
    setIntervalImpl: () => 17,
    clearIntervalImpl() {},
    mount: (mountRoot) => {
      mountRoot.innerHTML = '<main id="loaded-dashboard"></main>';
      return { update() {} };
    },
  });

  assert.match(root.innerHTML, /class="differential-testing-loading" aria-busy="true"/u);
  releaseFetch();
  await controller.ready;
  assert.equal(root.innerHTML, '<main id="loaded-dashboard"></main>');
  controller.stop();
});

test("live Differential Testing dashboard polls and updates only when the payload revision changes", async () => {
  const oven = { detail: { cells: [] } };
  let payload = { publishedAt: "2026-01-01T12:00:00.000Z" };
  const requests = [];
  let intervalCallback = null;
  let intervalMs = null;
  let clearedTimer = null;
  const mountedPayloads = [];
  const updatedPayloads = [];
  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return {
        ok: true,
        async json() {
          return url === "/api/ovens/differential-testing" ? { oven } : { payload };
        },
      };
    },
    setIntervalImpl: (callback, delay) => {
      intervalCallback = callback;
      intervalMs = delay;
      return 17;
    },
    clearIntervalImpl: (timer) => { clearedTimer = timer; },
    mount: (_root, _oven, initialPayload) => {
      mountedPayloads.push(initialPayload);
      return { update: (_nextOven, nextPayload) => updatedPayloads.push(nextPayload) };
    },
  });

  await controller.ready;
  assert.equal(intervalMs, DIFFERENTIAL_TESTING_REFRESH_MS);
  assert.equal(DIFFERENTIAL_TESTING_REFRESH_MS, 2000);
  assert.deepEqual(mountedPayloads, [payload]);
  assert.equal(requests.filter(([url]) => url === "/api/ovens/differential-testing").length, 1);

  await intervalCallback();
  assert.equal(updatedPayloads.length, 0);
  payload = { publishedAt: "2026-01-01T12:00:02.000Z" };
  await intervalCallback();
  assert.deepEqual(updatedPayloads, [payload]);
  payload = { publishedAt: "2026-01-01T12:00:04.000Z" };
  await controller.selectScenario("0123456789abcdef");
  assert.equal(requests.at(-1)[0], "/api/oven-data/differential-testing?scenario=0123456789abcdef");
  assert.deepEqual(updatedPayloads, [{ publishedAt: "2026-01-01T12:00:02.000Z" }, payload]);
  assert.equal(requests.filter(([url]) => url === "/api/ovens/differential-testing").length, 1);
  assert.ok(requests.every(([, options]) => options.cache === "no-store"));

  controller.stop();
  assert.equal(clearedTimer, 17);
});

test("live Differential Testing dashboard keeps the completed report visible while its replacement is running", async () => {
  const oven = { detail: { cells: [] } };
  const completed = { publishedAt: "2026-01-01T12:00:00.000Z", refresh: { status: "complete", report: {} }, fields: [{ id: "completed-field" }] };
  const running = { publishedAt: "2026-01-01T12:00:02.000Z", refresh: { status: "running" }, fields: [], progress: [] };
  const replacement = { publishedAt: "2026-01-01T12:00:04.000Z", refresh: { status: "complete" }, fields: [{ id: "replacement-field" }] };
  let payload = completed;
  let intervalCallback = null;
  const updates = [];
  const statuses = [];
  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    fetchImpl: async (url) => ({
      ok: true,
      headers: { get: () => null },
      async json() { return url === "/api/ovens/differential-testing" ? { oven } : { payload }; },
    }),
    setIntervalImpl: (callback) => {
      intervalCallback = callback;
      return 17;
    },
    clearIntervalImpl() {},
    mount: (_root, _oven, initialPayload) => {
      assert.equal(initialPayload, completed);
      return {
        update: (_nextOven, nextPayload) => updates.push(nextPayload),
        setClientRefreshStatus: (status) => statuses.push(status),
      };
    },
  });

  await controller.ready;
  payload = running;
  await intervalCallback();
  await intervalCallback();
  assert.deepEqual(updates, []);
  assert.deepEqual(statuses, ["running", "running"]);

  payload = replacement;
  await intervalCallback();
  assert.deepEqual(updates, [replacement]);
  controller.stop();
});

test("live Differential Testing dashboard does not retain an empty catalog when its first scenario is queued", async () => {
  const oven = { detail: { cells: [] } };
  const empty = { publishedAt: "2026-01-01T12:00:00.000Z", refresh: null, fields: [] };
  const queued = { publishedAt: "2026-01-01T12:00:02.000Z", refresh: { status: "queued" }, fields: [] };
  let payload = empty;
  let intervalCallback = null;
  const updates = [];
  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    fetchImpl: async (url) => ({
      ok: true,
      headers: { get: () => null },
      async json() { return url === "/api/ovens/differential-testing" ? { oven } : { payload }; },
    }),
    setIntervalImpl: (callback) => {
      intervalCallback = callback;
      return 17;
    },
    clearIntervalImpl() {},
    mount: () => ({
      update: (_nextOven, nextPayload) => updates.push(nextPayload),
      setClientRefreshStatus() {},
    }),
  });

  await controller.ready;
  payload = queued;
  await intervalCallback();
  assert.deepEqual(updates, [queued]);
  controller.stop();
});

test("live Differential Testing dashboard reuses per-scenario ETags and skips unchanged payload JSON", async () => {
  const oven = { detail: { cells: [] } };
  const initialPayload = { publishedAt: "2026-01-01T12:00:00.000Z" };
  const scenarioPayload = { publishedAt: "2026-01-01T12:00:02.000Z", scenario: "0123456789abcdef" };
  const initialEtag = 'W/"initial"';
  const requests = [];
  const updatedPayloads = [];
  let intervalCallback = null;
  let initialPayloadRequests = 0;
  let payloadJsonCalls = 0;
  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (url === "/api/ovens/differential-testing") {
        return { ok: true, async json() { return { oven }; } };
      }
      if (url === "/api/oven-data/differential-testing") {
        initialPayloadRequests += 1;
        if (initialPayloadRequests === 1) {
          return {
            ok: true,
            status: 200,
            headers: { get: (name) => name.toLowerCase() === "etag" ? initialEtag : null },
            async json() {
              payloadJsonCalls += 1;
              return { payload: initialPayload };
            },
          };
        }
        return {
          ok: false,
          status: 304,
          headers: { get: (name) => name.toLowerCase() === "etag" ? initialEtag : null },
          async json() { assert.fail("304 response body must not be parsed"); },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === "etag" ? 'W/"scenario"' : null },
        async json() {
          payloadJsonCalls += 1;
          return { payload: scenarioPayload };
        },
      };
    },
    setIntervalImpl: (callback) => {
      intervalCallback = callback;
      return 17;
    },
    clearIntervalImpl() {},
    mount: (_root, _oven, payload) => {
      assert.equal(payload, initialPayload);
      return {
        update: (_nextOven, nextPayload) => updatedPayloads.push(nextPayload),
        setClientRefreshStatus() {},
      };
    },
  });

  await controller.ready;
  await intervalCallback();
  const unchangedRequest = requests.filter(([url]) => url === "/api/oven-data/differential-testing").at(-1);
  assert.equal(new Headers(unchangedRequest[1].headers).get("if-none-match"), initialEtag);
  assert.equal(payloadJsonCalls, 1);
  assert.deepEqual(updatedPayloads, []);

  await controller.selectScenario("0123456789abcdef");
  const scenarioRequest = requests.at(-1);
  assert.equal(scenarioRequest[0], "/api/oven-data/differential-testing?scenario=0123456789abcdef");
  assert.equal(new Headers(scenarioRequest[1].headers).get("if-none-match"), null);
  assert.equal(payloadJsonCalls, 2);
  assert.deepEqual(updatedPayloads, [scenarioPayload]);
  controller.stop();
});

test("live Differential Testing dashboard escapes an initial server error", async () => {
  const root = { innerHTML: "" };
  const controller = startDifferentialTestingLiveUpdates(root, {
    fetchImpl: async () => ({
      ok: false,
      async json() { return { error: '<img src=x onerror="globalThis.injected=true">' }; },
    }),
    setIntervalImpl: () => 17,
    clearIntervalImpl() {},
  });

  await controller.ready;
  assert.equal(root.innerHTML, '<div class="empty">&lt;img src=x onerror=&quot;globalThis.injected=true&quot;&gt;</div>');
  controller.stop();
});

test("live Differential Testing dashboard discards an in-flight response after scenario selection", async () => {
  let resolveOldPayload;
  const oldPayload = new Promise((resolvePayload) => { resolveOldPayload = resolvePayload; });
  const applied = [];
  let resolveApplied;
  const newPayloadApplied = new Promise((resolvePayload) => { resolveApplied = resolvePayload; });
  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    fetchImpl: async (url) => {
      if (url === "/api/ovens/differential-testing") return { ok: true, async json() { return { oven: {} }; } };
      if (url === "/api/oven-data/differential-testing") return { ok: true, async json() { return { payload: await oldPayload }; } };
      return { ok: true, async json() { return { payload: { scenario: "new" } }; } };
    },
    setIntervalImpl: () => 17,
    clearIntervalImpl() {},
    mount: (_root, _oven, payload) => {
      applied.push(["mount", payload.scenario]);
      resolveApplied();
      return { update: (_nextOven, nextPayload) => applied.push(["update", nextPayload.scenario]) };
    },
  });

  void controller.selectScenario("0123456789abcdef");
  resolveOldPayload({ scenario: "old" });
  await controller.ready;
  await newPayloadApplied;
  assert.deepEqual(applied, [["mount", "new"]]);
  controller.stop();
});

test("Burnlist serves only catalog-listed contained scenario payloads", async (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "burnlist-differential-scenarios-"));
  const fixtureRepo = resolve(directory, "fixture-repo");
  const fixturePlanDirectory = resolve(fixtureRepo, "notes/burnlists/inprogress/fixture");
  mkdirSync(fixturePlanDirectory, { recursive: true });
  writeFileSync(resolve(fixturePlanDirectory, "burnlist.md"), `# Fixture Burnlist

## Active Checklist

- [ ] B1 | Verify root navigation
  Files/search: fixture
  Action: Keep the index distinct from detail routes.
  Done/delete when: The root renders the Burnlist table.
  Validate: Open the root and detail route.

## Completed
`);
  const bundleDir = resolve(directory, "bundle");
  const scenariosDir = resolve(bundleDir, "scenarios");
  mkdirSync(scenariosDir, { recursive: true });
  const current = buildPayload(...populatedCaptures());
  const secondId = "fedcba9876543210";
  const secondEntry = { ...current.scenarioCatalog.scenarios[0], id: secondId, label: "Second scenario" };
  current.scenarioCatalog.scenarios.push(secondEntry);
  const second = structuredClone(current);
  second.scenarioCatalog.selectedScenarioId = secondId;
  second.scenarioCatalog.scenarios = [secondEntry];
  second.refresh.scenarioId = secondId;
  second.refresh.report.scenarioId = secondId;
  second.log[0].scenarioId = secondId;
  second.progress[0].scenarioId = secondId;
  assert.doesNotThrow(() => assertDifferentialTestingData(current));
  assert.doesNotThrow(() => assertDifferentialTestingData(second));
  writeFileSync(resolve(bundleDir, "current.json"), `${JSON.stringify(current)}\n`);
  writeFileSync(resolve(scenariosDir, `${secondId}.json`), `${JSON.stringify(second)}\n`);

  const serverPath = resolve(exampleDir, "../../scripts/burnlist-dashboard-server.mjs");
  const port = 48000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [serverPath, "--port", String(port), "--auto-port", "--state-dir", resolve(directory, "state"), "--oven-data", "differential-testing=bundle/current.json"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => {
    child.kill("SIGTERM");
    rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = await new Promise((accept, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Burnlist test server did not start: ${output}`)), 5000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//u);
      if (!match) return;
      clearTimeout(timer);
      accept(match[0]);
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Burnlist test server exited with ${code}: ${output}`));
    });
  });

  const indexHtml = await (await fetch(baseUrl)).text();
  assert.match(indexHtml, /<div id="root"><\/div>/u);
  assert.match(indexHtml, /<script type="module" crossorigin src="\/assets\/index-[A-Za-z0-9_-]+\.js"><\/script>/u);
  assert.doesNotMatch(indexHtml, /burnlist-fallback/u);
  const detailHtml = await (await fetch(`${baseUrl}fixture-repo/fixture`)).text();
  assert.equal(detailHtml, indexHtml);
  const loadingHtml = await (await fetch(`${baseUrl}ovens/differential-testing/view`)).text();
  assert.equal(loadingHtml, indexHtml);
  const newOvenHtml = await (await fetch(`${baseUrl}ovens/new`)).text();
  assert.equal(newOvenHtml, indexHtml);
  const runBurnHtml = await (await fetch(`${baseUrl}runs/new`)).text();
  assert.equal(runBurnHtml, indexHtml);
  assert.equal((await fetch(`${baseUrl}assets/fallback-burn-ovens.js`)).status, 404);
  assert.equal((await fetch(`${baseUrl}assets/differential-testing-renderer.js`)).status, 404);

  const currentResponse = await fetch(`${baseUrl}api/oven-data/differential-testing`);
  assert.equal(currentResponse.status, 200);
  const currentEtag = currentResponse.headers.get("etag");
  assert.match(currentEtag, /^W\/"dt-/u);
  assert.equal((await currentResponse.json()).scenarioId, current.scenarioCatalog.selectedScenarioId);
  const unchangedCurrentResponse = await fetch(`${baseUrl}api/oven-data/differential-testing`, { headers: { "If-None-Match": currentEtag } });
  assert.equal(unchangedCurrentResponse.status, 304);
  assert.equal(await unchangedCurrentResponse.text(), "");
  assert.equal((await fetch(`${baseUrl}api/oven-data/differential-testing?scenario=${current.scenarioCatalog.selectedScenarioId}`)).status, 200);
  const secondResponse = await fetch(`${baseUrl}api/oven-data/differential-testing?scenario=${secondId}`);
  assert.equal(secondResponse.status, 200);
  const secondResponsePayload = (await secondResponse.json()).payload;
  assert.equal(secondResponsePayload.scenarioCatalog.selectedScenarioId, secondId);
  assert.equal(secondResponsePayload.scenarioCatalog.scenarios.length, 2);
  assert.equal((await fetch(`${baseUrl}api/oven-data/differential-testing?scenario=../../etc/passwd`)).status, 400);
  assert.equal((await fetch(`${baseUrl}api/oven-data/differential-testing?scenario=aaaaaaaaaaaaaaaa`)).status, 404);
  assert.equal((await fetch(`${baseUrl}api/types`)).status, 404);
  assert.equal((await fetch(`${baseUrl}types/new`)).status, 404);

  const empty = buildPayload(...emptyCaptures());
  writeFileSync(resolve(bundleDir, "current.json"), `${JSON.stringify(empty)}\n`);
  rmSync(scenariosDir, { recursive: true, force: true });
  const emptyResponse = await fetch(`${baseUrl}api/oven-data/differential-testing`, { headers: { "If-None-Match": currentEtag } });
  assert.equal(emptyResponse.status, 200);
  assert.notEqual(emptyResponse.headers.get("etag"), currentEtag);
  assert.deepEqual((await emptyResponse.json()).payload.scenarioCatalog, { selectedScenarioId: null, scenarios: [] });
  assert.equal((await fetch(`${baseUrl}api/oven-data/differential-testing?scenario=${secondId}`)).status, 404);
});

test("Burnlist rejects retired pre-Oven options instead of adapting them", () => {
  const serverPath = resolve(exampleDir, "../../scripts/burnlist-dashboard-server.mjs");
  for (const option of ["--legacy-detail-origin", "--types-dir"]) {
    const result = spawnSync(process.execPath, [serverPath, option, "/tmp/retired"], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`Unknown option: ${option}`, "u"));
  }
});
