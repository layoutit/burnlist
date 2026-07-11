import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPayload } from "../examples/differential-testing/adapter.mjs";
import {
  DIFFERENTIAL_TESTING_REFRESH_MS,
  differentialFrameDeltaMetrics,
  differentialExactTarget,
  differentialTelemetryFieldMap,
  differentialPayloadRevision,
  differentialHistoryPoints,
  differentialProgressChartHistory,
  differentialSampleStateIsNonPass,
  mountDifferentialTestingDashboard,
  startDifferentialTestingLiveUpdates,
} from "../dashboard/differential-testing-renderer.js";
import {
  assertDifferentialTestingData,
  buildDifferentialTelemetry,
  differentialStateVectorSha256,
  DIFFERENTIAL_TESTING_CADENCE_FRAMES,
  DIFFERENTIAL_TESTING_EXACT_AUTHORITY,
  DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY,
  validateDifferentialTestingData,
} from "./differential-testing-data-contract.mjs";

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), "../examples/differential-testing");

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
  gateReport: "c".repeat(64),
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
  const scenarioId = "fixture-scenario";
  const scenarioFrameCount = 25;
  const clearedPrefixFrames = 12;
  const completedBoundary = 10;
  const nextBoundary = 20;
  const gateIdentity = {
    gateId: "gate-fixture",
    scenarioId,
    reportSha256: exactDigests.gateReport,
    runtimeTreeSha256: exactDigests.runtime,
    contractSha256: exactDigests.contract,
  };
  Object.assign(payload.log[0], gateIdentity);
  Object.assign(payload.progress.at(-1), gateIdentity);
  payload.telemetryGate = {
    status: "current",
    authority: DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY,
    blockers: [],
    configuredScenario: {
      id: scenarioId,
      frameCount: scenarioFrameCount,
      cadenceFrames: DIFFERENTIAL_TESTING_CADENCE_FRAMES,
      replaySha256: exactDigests.replay,
      profileSha256: exactDigests.profile,
      contractSha256: exactDigests.contract,
    },
    clearedPrefixFrames,
    completedBoundary,
    nextBoundary,
    gateId: gateIdentity.gateId,
    report: {
      id: "gate-report-fixture",
      generatedAt: payload.log[0].timestamp,
      artifactSha256: gateIdentity.reportSha256,
      runtimeTreeSha256: gateIdentity.runtimeTreeSha256,
      contractSha256: gateIdentity.contractSha256,
      scenarioId,
      frameCount: scenarioFrameCount,
      completedBoundary,
      replaySha256: exactDigests.replay,
      profileSha256: exactDigests.profile,
      result: payload.log[0].result,
      check: exactCheck("gate-report-check@1", gateIdentity.reportSha256),
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
      nextBoundary,
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
  exact.session.nextBoundary = null;
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
  payload.telemetryGate.clearedPrefixFrames = exact.session.scenarioFrameCount;
  payload.telemetryGate.completedBoundary = exact.session.scenarioFrameCount;
  payload.telemetryGate.nextBoundary = null;
  payload.telemetryGate.report.completedBoundary = exact.session.scenarioFrameCount;
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
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
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
  payload.log = [{ timestamp: payload.publishedAt, result: "blocked", value: 0, delta: null, failedFieldCount: 2, firstFailingTick: null, firstFailingLabel: "The source capture failed validation." }];
  payload.summary.runs = { label: "Runs", total: 1, passed: 0, failed: 0, blocked: 1 };
  payload.summary.fields = { label: "Fields", total: 2, passed: 0, failed: 0, blocked: 2 };
  payload.summary.frames = { label: "Samples", total: 0, passed: 0, failed: 0, blocked: 0, uniqueTicks: 0 };
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
});

test("builds sealed transition telemetry with exact per-field state transitions", () => {
  const { baseline, candidate, provenance } = telemetryPayloads();
  const telemetry = buildDifferentialTelemetry(baseline, candidate, provenance);
  assert.equal(telemetry.status, "comparable");
  assert.equal(telemetry.authority, DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY);
  assert.deepEqual(telemetry.comparison, telemetryProvenance.comparison);
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
  assert.equal(payload.exactSession.session.nextBoundary, null);
  assert.equal(differentialExactTarget(payload).status, "complete");
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

test("fixed cadence records the highest crossed 10-frame boundary", async (t) => {
  await t.test("the workflow cadence is exactly ten", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.telemetryGate.configuredScenario.cadenceFrames = 5;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /fixed workflow cadence of 10 frames/u);
  });

  await t.test("one gate covers multiple boundaries crossed by one accepted candidate", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.exactSession.session.clearedPrefixFrames = 22;
    payload.exactSession.session.nextBoundary = 25;
    payload.exactSession.frontier.frame = 22;
    payload.exactSession.frontier.prefixCount = 22;
    payload.exactSession.producer.frame = 22;
    payload.telemetryGate.clearedPrefixFrames = 22;
    payload.telemetryGate.completedBoundary = 20;
    payload.telemetryGate.nextBoundary = 25;
    payload.telemetryGate.report.completedBoundary = 20;
    assert.doesNotThrow(() => assertDifferentialTestingData(payload));

    payload.telemetryGate.completedBoundary = 10;
    payload.telemetryGate.report.completedBoundary = 10;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /highest fixed 10-frame boundary/u);
  });

  await t.test("the retained session carries its next boundary directly", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.exactSession.session.nextBoundary = 25;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /next fixed 10-frame boundary/u);
  });
});

test("direct retained-session bindings reconcile contract, frontier, and telemetry gate", async (t) => {
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

  await t.test("telemetry gate names another scenario", () => {
    const payload = validPayload();
    payload.telemetryGate.configuredScenario.id = "another-scenario";
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /retained exact-session scenario id/u);
  });

  await t.test("telemetry gate cleared prefix differs", () => {
    const payload = validPayload();
    payload.telemetryGate.clearedPrefixFrames = 11;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => entry.message).join("\n"), /retained exact-session clearedPrefixFrames/u);
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
  for (const removedDefinition of ["exactCycles", "exactComparison", "exactBinding", "exactLifecycle"]) {
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

  await t.test("rejects old producer patchScope", () => {
    const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
    payload.exactSession.producer.patchScope = payload.exactSession.producer.changeScope;
    delete payload.exactSession.producer.changeScope;
    assert.match(validateDifferentialTestingData(payload).issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"), /patchScope.*not supported by the exact-session contract/u);
  });
});

test("telemetry remains observational and cannot veto exact retention", () => {
  const payload = attachReadyExactSession(buildPayload(...populatedCaptures()));
  payload.telemetryGate.report.result = "worsened";
  payload.log[0].result = "worsened";
  payload.progress.at(-1).result = "worsened";
  assert.doesNotThrow(() => assertDifferentialTestingData(payload));
  assert.equal(payload.exactSession.result, "advanced");
  assert.equal(payload.telemetryGate.authority, "telemetry-only");
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

  const chartHistory = differentialProgressChartHistory({
    progress: points.map((point, index) => ({ ...point, fieldCount: 2, failedFieldCount: point.value ? 1 : 0, frames: 50 })),
    summary: { fields: { total: 2 }, frames: { total: 100, uniqueTicks: 50 } },
  });
  assert.deepEqual(chartHistory.map((point) => point.drivingParityStateFailures), [100, 500, 100]);
  assert.deepEqual(chartHistory.map((point) => point.drivingParityEventMarker), ["", "worsened", "improved"]);
  assert.equal(chartHistory[0].drivingParityActiveComparablePoints, 100);

  const frameMetrics = differentialFrameDeltaMetrics({ fields: [{ samples: [[0, 0, 0, 0], [1, 0, 1, 1], [2, null, null, 4]] }, { samples: [[0, 0, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0]] }] });
  assert.deepEqual(frameMetrics.frameDeviationRatios, [0, 0.5, 0]);
  assert.equal(frameMetrics.firstFailingFrame, 1);

  const payload = { publishedAt: points[2].timestamp, adapter: { id: "fixture" }, summary: {}, progress: points.slice(), log: [], fields: [{ id: "field-a", label: "Field A", samples: [] }], telemetry: {
    status: "comparable",
    baseline: { artifactSha256: "a".repeat(64) },
    candidate: { artifactSha256: "b".repeat(64) },
    summary: { failToPassCount: 1, passToFailCount: 2, netFailedSampleDelta: 1 },
  } };
  const before = differentialPayloadRevision(payload);
  payload.telemetry.candidate.artifactSha256 = "c".repeat(64);
  const afterTelemetry = differentialPayloadRevision(payload);
  assert.notEqual(afterTelemetry, before);
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

test("Changed renders telemetry transitions while primary field status stays failing", () => {
  const { baseline, candidate, provenance } = telemetryPayloads({ baselineMode: "passing" });
  candidate.progress[0].result = "worsened";
  candidate.log[0].result = "worsened";
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

test("hybrid rows default to Delta and label frames only on the first row", () => {
  const payload = buildPayload(...populatedCaptures());
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
  assert.match(root.innerHTML, /id="progress-panel-title">Parity Progress<\/h2>/u);
  assert.match(root.innerHTML, /class="work-panel-title">Parity Progress</u);
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
  assert.match(root.innerHTML, /class="hybrid-value-delta"><\/span>/u);
  assert.match(root.innerHTML, /class="checklist-log-table-header"><span>Age<\/span><span>Value<\/span><span>Result<\/span><span>Delta<\/span>/u);
  assert.match(root.innerHTML, /class="log-table-cell age">(?:now|\d+m)<\/span>/u);
  assert.doesNotMatch(root.innerHTML, /class="log-table-cell age">\d+[hd]<\/span>/u);
  assert.match(root.innerHTML, /id="driving-parity-controls" class="driving-parity-controls"/u);
  assert.match(root.innerHTML, /data-driving-parity-chart="delta"[^>]+aria-pressed="true"/u);
  assert.doesNotMatch(root.innerHTML, /differential-(?:page|workspace|toolbar|controls|kpi-strip)/u);
  assert.equal((renderedHtml.match(/class="frame-tick-label"/gu) || []).length, 1);
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
  assert.equal(requests.filter(([url]) => url === "/api/ovens/differential-testing").length, 1);
  assert.ok(requests.every(([, options]) => options.cache === "no-store"));

  controller.stop();
  assert.equal(clearedTimer, 17);
});
