import { createHash } from "node:crypto";

export const DIFFERENTIAL_TESTING_DATA_SCHEMA = "burnlist-differential-testing-data@1";
export const DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY = "telemetry-only";
export const DIFFERENTIAL_TESTING_EXACT_AUTHORITY = "adapter-attested";
export const DIFFERENTIAL_TESTING_EXACT_COORDINATE_ORDER = Object.freeze(["frame", "control", "tick", "call", "phaseOrder", "phase", "operationId", "fieldId"]);
export const DIFFERENTIAL_TESTING_CADENCE_FRAMES = 10;

export const DIFFERENTIAL_SAMPLE_STATES = Object.freeze({
  match: 0,
  mismatch: 1,
  referenceMissing: 2,
  candidateMissing: 3,
  bothMissing: 4,
});

const resultValues = new Set(["pass", "improved", "unchanged", "worsened", "blocked"]);
const trustValues = new Set(["pass", "blocked"]);
const telemetryStatusValues = new Set(["comparable", "blocked"]);
const exactStatusValues = new Set(["ready", "complete", "blocked"]);
const exactResultValues = new Set(["advanced", "complete", "rejected", "evidence-only", "blocked"]);
const exactDecisionKinds = new Set(["runtime-change", "evidence-change", "complete", "blocked"]);
const exactCandidateClasses = new Set(["edit-candidate", "input-trace", "carrier", "render-symptom", "lifetime-symptom", "diagnostic", "coverage-gap", "symptom"]);
const exactProducerVerdicts = new Set(["actionable", "trace-first", "evidence-gap"]);
const exactProducerLifecycles = new Set(["source-phase", "mechanics", "contact", "render-committed", "top-level", "diagnostic", "mixed", "unknown"]);
const exactInputProofStates = new Set(["proven", "not-applicable", "drifting", "missing", "unknown"]);
const exactProvenanceStates = new Set(["source-provided", "not-applicable", "substitute", "generic-default", "mixed", "missing", "unknown"]);
const exactCoverageStates = new Set(["covered", "not-applicable", "gap", "unknown"]);
const exactOracleModes = new Set(["strict", "numeric-toleranced", "diagnostic", "source-blocked", "noisy"]);
const exactSourceOrderStates = new Set(["single-operation", "atomic-proven", "unproven"]);
const exactChangeScopeStates = new Set(["single-source-coherent", "atomic-source-order", "unproven"]);
const scalarTypes = new Set(["string", "number", "boolean"]);
const sha256Pattern = /^[a-f0-9]{64}$/u;

export class DifferentialTestingDataValidationError extends Error {
  constructor(issues) {
    const shown = issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    const remainder = issues.length > 8 ? `; plus ${issues.length - 8} more` : "";
    super(`Differential Testing data is invalid: ${shown}${remainder}`);
    this.name = "DifferentialTestingDataValidationError";
    this.issues = issues;
    this.status = 422;
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function scalar(value) {
  return value === null || (scalarTypes.has(typeof value) && (typeof value !== "number" || Number.isFinite(value)));
}

function valuesMatch(left, right, tolerance) {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= tolerance;
  return Object.is(left, right);
}

function valueDelta(left, right) {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right);
  return Object.is(left, right) ? 0 : 1;
}

function nearlyEqual(left, right) {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= Math.max(1e-12, Math.abs(right) * 1e-12);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function stateVectorRecordsFromPayload(payload) {
  return (Array.isArray(payload?.fields) ? payload.fields : []).map((field) => ({
    id: field.id,
    samples: Array.isArray(field.samples) ? field.samples.map((sample) => [sample[0], sample[3]]) : [],
  }));
}

function normalizedStateVectorRecords(records) {
  return records
    .map((record) => ({ id: record.id, samples: record.samples.map((sample) => [sample[0], sample[1]]) }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function differentialStateVectorSha256(payload) {
  return canonicalSha256(normalizedStateVectorRecords(stateVectorRecordsFromPayload(payload)));
}

export function validateDifferentialTestingData(payload, { maxIssues = 50 } = {}) {
  const issues = [];
  const issue = (path, message) => {
    if (issues.length < maxIssues) issues.push({ path, message });
  };
  const text = (value, path, { nullable = false, max = 2000 } = {}) => {
    if (nullable && value === null) return true;
    if (typeof value !== "string" || value.trim().length === 0) {
      issue(path, nullable ? "must be a non-empty string or null" : "must be a non-empty string");
      return false;
    }
    if (value.length > max) issue(path, `must be at most ${max} characters`);
    return true;
  };
  const count = (value, path) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      issue(path, "must be a non-negative safe integer");
      return false;
    }
    return true;
  };
  const finite = (value, path, { nullable = false, minimum = -Infinity } = {}) => {
    if (nullable && value === null) return true;
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
      issue(path, `must be ${nullable ? "null or " : ""}a finite number${Number.isFinite(minimum) ? ` greater than or equal to ${minimum}` : ""}`);
      return false;
    }
    return true;
  };
  const integer = (value, path) => {
    if (!Number.isSafeInteger(value)) {
      issue(path, "must be a safe integer");
      return false;
    }
    return true;
  };
  const onlyKeys = (value, path, allowed, contract = "contract") => {
    if (!plainObject(value)) return;
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) issue(`${path}.${key}`, `is not supported by the ${contract}`);
    }
  };
  const sha256 = (value, path) => {
    if (typeof value !== "string" || !sha256Pattern.test(value)) {
      issue(path, "must be a lowercase 64-character SHA-256 digest");
      return false;
    }
    return true;
  };
  const checkerAttestation = (check, path) => {
    if (!plainObject(check)) {
      issue(path, "must be an adapter checker attestation");
      return null;
    }
    onlyKeys(check, path, new Set(["status", "id", "sha256", "subjectSha256"]), "checker-attestation contract");
    if (!["pass", "fail", "missing"].includes(check.status)) issue(`${path}.status`, "must be pass, fail, or missing");
    text(check.id, `${path}.id`, { max: 160 });
    sha256(check.sha256, `${path}.sha256`);
    sha256(check.subjectSha256, `${path}.subjectSha256`);
    return check;
  };
  const stateVectorAttestation = (check, path) => {
    if (!plainObject(check)) {
      issue(path, "must be an adapter state-vector checker attestation");
      return null;
    }
    onlyKeys(check, path, new Set(["status", "id", "sha256", "subjectSha256", "artifactSha256"]), "state-vector checker-attestation contract");
    if (!["pass", "fail", "missing"].includes(check.status)) issue(`${path}.status`, "must be pass, fail, or missing");
    text(check.id, `${path}.id`, { max: 160 });
    sha256(check.sha256, `${path}.sha256`);
    sha256(check.subjectSha256, `${path}.subjectSha256`);
    sha256(check.artifactSha256, `${path}.artifactSha256`);
    return check;
  };

  if (!plainObject(payload)) {
    issue("$", "must be an object");
    return { ok: false, issues };
  }
  onlyKeys(payload, "$", new Set(["schema", "publishedAt", "title", "subtitle", "adapter", "trust", "summary", "progress", "log", "fields", "telemetry", "telemetryGate", "exactSession"]), "Differential Testing data contract");
  if (payload.schema !== DIFFERENTIAL_TESTING_DATA_SCHEMA) issue("$.schema", `must equal ${DIFFERENTIAL_TESTING_DATA_SCHEMA}`);
  if (!validTimestamp(payload.publishedAt)) issue("$.publishedAt", "must be a parseable timestamp");
  text(payload.title, "$.title", { max: 160 });
  text(payload.subtitle, "$.subtitle", { max: 500 });

  if (!plainObject(payload.adapter)) {
    issue("$.adapter", "must be an object with a stable id");
  } else {
    text(payload.adapter.id, "$.adapter.id", { max: 160 });
  }

  const trust = payload.trust;
  if (!plainObject(trust)) {
    issue("$.trust", "must be an object");
  } else {
    if (!trustValues.has(trust.status)) issue("$.trust.status", "must be pass or blocked");
    if (trust.reportStatus !== null && trust.reportStatus !== undefined) text(trust.reportStatus, "$.trust.reportStatus", { max: 80 });
    if (!Array.isArray(trust.blockers)) {
      issue("$.trust.blockers", "must be an array");
    } else {
      trust.blockers.forEach((entry, index) => text(entry, `$.trust.blockers[${index}]`, { max: 1000 }));
      if (trust.status === "pass" && trust.blockers.length > 0) issue("$.trust.blockers", "must be empty when trust status is pass");
      if (trust.status === "blocked" && trust.blockers.length === 0) issue("$.trust.blockers", "must explain why trust is blocked");
    }
  }

  const metric = (value, path, { uniqueTicks = false } = {}) => {
    if (!plainObject(value)) {
      issue(path, "must be a metric object");
      return null;
    }
    onlyKeys(value, path, new Set(["label", "total", "passed", "failed", "blocked", "status", ...(uniqueTicks ? ["uniqueTicks"] : [])]), "metric contract");
    text(value.label, `${path}.label`, { max: 80 });
    const validCounts = ["total", "passed", "failed", "blocked"].every((key) => count(value[key], `${path}.${key}`));
    if (validCounts && value.total !== value.passed + value.failed + value.blocked) {
      issue(path, "total must equal passed + failed + blocked");
    }
    if (uniqueTicks) count(value.uniqueTicks, `${path}.uniqueTicks`);
    return value;
  };

  let runsMetric = null;
  let fieldsMetric = null;
  let framesMetric = null;
  if (!plainObject(payload.summary)) {
    issue("$.summary", "must be an object");
  } else {
    runsMetric = metric(payload.summary.runs, "$.summary.runs");
    fieldsMetric = metric(payload.summary.fields, "$.summary.fields");
    framesMetric = metric(payload.summary.frames, "$.summary.frames", { uniqueTicks: true });
  }

  const validateResultRows = (rows, path, { reverse = false } = {}) => {
    if (!Array.isArray(rows)) {
      issue(path, "must be an array");
      return [];
    }
    let previousTime = null;
    rows.forEach((row, index) => {
      const rowPath = `${path}[${index}]`;
      if (!plainObject(row)) {
        issue(rowPath, "must be an object");
        return;
      }
      onlyKeys(row, rowPath, new Set(["timestamp", "result", "value", "delta", "fieldCount", "failedFieldCount", "frames", "firstFailingTick", "firstFailingLabel", "gateId", "scenarioId", "reportSha256", "runtimeTreeSha256", "contractSha256"]), "result-row contract");
      if (!validTimestamp(row.timestamp)) {
        issue(`${rowPath}.timestamp`, "must be a parseable timestamp");
      } else {
        const currentTime = Date.parse(row.timestamp);
        if (previousTime !== null && (reverse ? currentTime > previousTime : currentTime < previousTime)) {
          issue(`${rowPath}.timestamp`, reverse ? "must not be newer than the preceding row" : "must not be older than the preceding row");
        }
        previousTime = currentTime;
      }
      if (!resultValues.has(row.result)) issue(`${rowPath}.result`, "uses an unsupported result");
      finite(row.value, `${rowPath}.value`, { minimum: 0 });
      if (Object.hasOwn(row, "delta")) finite(row.delta, `${rowPath}.delta`, { nullable: true });
      if (Object.hasOwn(row, "failedFieldCount")) count(row.failedFieldCount, `${rowPath}.failedFieldCount`);
      if (Object.hasOwn(row, "fieldCount")) count(row.fieldCount, `${rowPath}.fieldCount`);
      if (Object.hasOwn(row, "frames")) count(row.frames, `${rowPath}.frames`);
      if (Object.hasOwn(row, "firstFailingTick")) finite(row.firstFailingTick, `${rowPath}.firstFailingTick`, { nullable: true });
      if (Object.hasOwn(row, "firstFailingLabel") && row.firstFailingLabel !== null) text(row.firstFailingLabel, `${rowPath}.firstFailingLabel`, { max: 160 });
      if (Object.hasOwn(row, "gateId")) text(row.gateId, `${rowPath}.gateId`, { max: 160 });
      if (Object.hasOwn(row, "scenarioId")) text(row.scenarioId, `${rowPath}.scenarioId`, { max: 160 });
      if (Object.hasOwn(row, "reportSha256")) sha256(row.reportSha256, `${rowPath}.reportSha256`);
      if (Object.hasOwn(row, "runtimeTreeSha256")) sha256(row.runtimeTreeSha256, `${rowPath}.runtimeTreeSha256`);
      if (Object.hasOwn(row, "contractSha256")) sha256(row.contractSha256, `${rowPath}.contractSha256`);
    });
    return rows;
  };

  const progressRows = validateResultRows(payload.progress, "$.progress");
  const log = validateResultRows(payload.log, "$.log", { reverse: true });
  if (runsMetric && Array.isArray(log)) {
    const runCounts = { passed: 0, failed: 0, blocked: 0 };
    for (const entry of log) {
      if (entry?.result === "pass") runCounts.passed += 1;
      else if (entry?.result === "blocked") runCounts.blocked += 1;
      else if (resultValues.has(entry?.result)) runCounts.failed += 1;
    }
    if (runsMetric.total !== log.length) issue("$.summary.runs.total", "must equal the number of log rows");
    for (const key of Object.keys(runCounts)) {
      if (runsMetric[key] !== runCounts[key]) issue(`$.summary.runs.${key}`, `does not reconcile with log results; expected ${runCounts[key]}`);
    }
  }

  if (!Array.isArray(payload.fields)) {
    issue("$.fields", "must be an array");
    return { ok: issues.length === 0, issues };
  }

  const ids = new Set();
  let canonicalTicks = null;
  let passedFields = 0;
  let failedFields = 0;
  let blockedFields = 0;
  let passedSamples = 0;
  let failedSamples = 0;
  let blockedSamples = 0;
  const collectTelemetryRecords = plainObject(payload.telemetry) && payload.telemetry.status === "comparable";
  const fieldRecords = new Map();

  payload.fields.forEach((field, fieldIndex) => {
    const path = `$.fields[${fieldIndex}]`;
    if (!plainObject(field)) {
      issue(path, "must be an object");
      return;
    }
    if (text(field.id, `${path}.id`, { max: 160 })) {
      if (ids.has(field.id)) issue(`${path}.id`, `duplicates field id ${field.id}`);
      ids.add(field.id);
    }
    text(field.label, `${path}.label`, { max: 160 });
    text(field.sourceOwner, `${path}.sourceOwner`, { max: 500 });
    if (!plainObject(field.semantics)) {
      issue(`${path}.semantics`, "must be an object");
    } else {
      text(field.semantics.meaning, `${path}.semantics.meaning`, { max: 2000 });
    }
    if (field.unit !== null) text(field.unit, `${path}.unit`, { max: 80 });
    const toleranceValid = finite(field.tolerance, `${path}.tolerance`, { minimum: 0 });
    if (!trustValues.has(field.trustStatus)) issue(`${path}.trustStatus`, "must be pass or blocked");
    if (field.driftClass !== null) text(field.driftClass, `${path}.driftClass`, { max: 120 });
    if (field.driftReason !== null) text(field.driftReason, `${path}.driftReason`, { max: 2000 });
    count(field.sampleCount, `${path}.sampleCount`);
    count(field.failedSampleCount, `${path}.failedSampleCount`);
    count(field.missingSampleCount, `${path}.missingSampleCount`);
    finite(field.firstFailingTick, `${path}.firstFailingTick`, { nullable: true });
    finite(field.maxDelta, `${path}.maxDelta`, { nullable: true, minimum: 0 });
    if (!Array.isArray(field.samples)) {
      issue(`${path}.samples`, "must be an array");
      return;
    }
    if (field.sampleCount !== field.samples.length) issue(`${path}.sampleCount`, `must equal samples.length (${field.samples.length})`);

    let previousTick = -Infinity;
    let rowFailed = 0;
    let rowMissing = 0;
    let firstNonPass = null;
    let rowMaxDelta = null;
    const ticks = [];
    const sampleStatesByTick = collectTelemetryRecords ? new Map() : null;
    field.samples.forEach((sample, sampleIndex) => {
      const samplePath = `${path}.samples[${sampleIndex}]`;
      if (!Array.isArray(sample) || sample.length !== 4) {
        issue(samplePath, "must be [tick, reference, candidate, state]");
        return;
      }
      const [tick, reference, candidate, state] = sample;
      if (typeof tick !== "number" || !Number.isFinite(tick) || tick <= previousTick) {
        issue(`${samplePath}[0]`, "must be a finite tick greater than the previous tick");
      }
      previousTick = tick;
      ticks.push(tick);
      if (sampleStatesByTick && typeof tick === "number" && Number.isFinite(tick)) sampleStatesByTick.set(tick, state);
      if (!scalar(reference)) issue(`${samplePath}[1]`, "must be a JSON scalar or null");
      if (!scalar(candidate)) issue(`${samplePath}[2]`, "must be a JSON scalar or null");
      if (![0, 1, 2, 3, 4].includes(state)) {
        issue(`${samplePath}[3]`, "must be an integer sample state from 0 to 4");
        return;
      }
      if (state !== 0 && firstNonPass === null) firstNonPass = tick;
      if (state === DIFFERENTIAL_SAMPLE_STATES.mismatch) rowFailed += 1;
      if (state >= DIFFERENTIAL_SAMPLE_STATES.referenceMissing) rowMissing += 1;
      if ((state === DIFFERENTIAL_SAMPLE_STATES.referenceMissing || state === DIFFERENTIAL_SAMPLE_STATES.bothMissing) && reference !== null) {
        issue(`${samplePath}[1]`, "must be null when the reference sample is missing");
      }
      if ((state === DIFFERENTIAL_SAMPLE_STATES.candidateMissing || state === DIFFERENTIAL_SAMPLE_STATES.bothMissing) && candidate !== null) {
        issue(`${samplePath}[2]`, "must be null when the candidate sample is missing");
      }
      if (state <= DIFFERENTIAL_SAMPLE_STATES.mismatch && scalar(reference) && scalar(candidate) && toleranceValid) {
        const matches = valuesMatch(reference, candidate, field.tolerance);
        if (matches !== (state === DIFFERENTIAL_SAMPLE_STATES.match)) issue(`${samplePath}[3]`, "disagrees with the values and tolerance");
        const delta = valueDelta(reference, candidate);
        rowMaxDelta = Math.max(rowMaxDelta ?? 0, delta);
      }
    });

    if (canonicalTicks === null) canonicalTicks = ticks;
    else if (ticks.length !== canonicalTicks.length || ticks.some((tick, index) => tick !== canonicalTicks[index])) {
      issue(`${path}.samples`, "tick identities must match every other field exactly");
    }
    if (field.failedSampleCount !== rowFailed) issue(`${path}.failedSampleCount`, `does not reconcile with mismatch states; expected ${rowFailed}`);
    if (field.missingSampleCount !== rowMissing) issue(`${path}.missingSampleCount`, `does not reconcile with missing states; expected ${rowMissing}`);
    if (field.firstFailingTick !== firstNonPass) issue(`${path}.firstFailingTick`, `does not match the first non-pass tick ${String(firstNonPass)}`);
    if (!nearlyEqual(field.maxDelta, rowMaxDelta)) issue(`${path}.maxDelta`, `does not reconcile with present samples; expected ${String(rowMaxDelta)}`);
    if (rowMissing > 0 && field.trustStatus !== "blocked") issue(`${path}.trustStatus`, "must be blocked when samples are missing");
    if (field.trustStatus === "blocked" || rowMissing > 0) blockedFields += 1;
    else if (rowFailed > 0) failedFields += 1;
    else passedFields += 1;
    passedSamples += field.samples.length - rowFailed - rowMissing;
    failedSamples += rowFailed;
    blockedSamples += rowMissing;
    if (sampleStatesByTick && typeof field.id === "string" && !fieldRecords.has(field.id)) {
      fieldRecords.set(field.id, { field, sampleStatesByTick });
    }
  });

  if (trust?.status === "pass" && blockedFields > 0) issue("$.trust.status", "must be blocked when any field is blocked");
  if (payload.fields.length > 0 && fieldsMetric) {
    const expected = { total: payload.fields.length, passed: passedFields, failed: failedFields, blocked: blockedFields };
    for (const [key, value] of Object.entries(expected)) {
      if (fieldsMetric[key] !== value) issue(`$.summary.fields.${key}`, `does not reconcile with fields; expected ${value}`);
    }
  } else if (trust?.status === "blocked" && fieldsMetric && fieldsMetric.passed + fieldsMetric.failed !== 0) {
    issue("$.summary.fields", "an unavailable blocked payload cannot claim passed or failed fields");
  }
  if (framesMetric) {
    const expected = { total: passedSamples + failedSamples + blockedSamples, passed: passedSamples, failed: failedSamples, blocked: blockedSamples };
    for (const [key, value] of Object.entries(expected)) {
      if (framesMetric[key] !== value) issue(`$.summary.frames.${key}`, `does not reconcile with samples; expected ${value}`);
    }
    const expectedUniqueTicks = canonicalTicks?.length ?? 0;
    if (framesMetric.uniqueTicks !== expectedUniqueTicks) issue("$.summary.frames.uniqueTicks", `does not reconcile with aligned ticks; expected ${expectedUniqueTicks}`);
  }

  if (payload.telemetry !== undefined) {
    const telemetry = payload.telemetry;
    const telemetryPath = "$.telemetry";
    const comparison = (value, path) => {
      if (!plainObject(value)) {
        issue(path, "must bind the trusted reference, scenario, and alignment");
        return null;
      }
      onlyKeys(value, path, new Set(["referenceId", "referenceSha256", "scenarioId", "alignmentKey"]), "telemetry contract");
      text(value.referenceId, `${path}.referenceId`, { max: 160 });
      sha256(value.referenceSha256, `${path}.referenceSha256`);
      text(value.scenarioId, `${path}.scenarioId`, { max: 160 });
      text(value.alignmentKey, `${path}.alignmentKey`, { max: 160 });
      return value;
    };
    const artifact = (value, path) => {
      if (!plainObject(value)) {
        issue(path, "must be a sealed artifact object");
        return null;
      }
      onlyKeys(value, path, new Set(["id", "generatedAt", "artifactSha256", "contractSha256", "failedSampleCount", "check", "stateVectorSha256", "stateVectorCheck"]), "telemetry contract");
      text(value.id, `${path}.id`, { max: 160 });
      if (!validTimestamp(value.generatedAt)) issue(`${path}.generatedAt`, "must be a parseable timestamp");
      sha256(value.artifactSha256, `${path}.artifactSha256`);
      sha256(value.contractSha256, `${path}.contractSha256`);
      count(value.failedSampleCount, `${path}.failedSampleCount`);
      checkerAttestation(value.check, `${path}.check`);
      if (value.check?.subjectSha256 !== value.artifactSha256) issue(`${path}.check.subjectSha256`, "must equal the checked artifact SHA-256");
      sha256(value.stateVectorSha256, `${path}.stateVectorSha256`);
      stateVectorAttestation(value.stateVectorCheck, `${path}.stateVectorCheck`);
      if (value.stateVectorCheck?.subjectSha256 !== value.stateVectorSha256) issue(`${path}.stateVectorCheck.subjectSha256`, "must equal the normalized state-vector SHA-256");
      if (value.stateVectorCheck?.artifactSha256 !== value.artifactSha256) issue(`${path}.stateVectorCheck.artifactSha256`, "must bind the state vector to the checked artifact SHA-256");
      return value;
    };

    if (!plainObject(telemetry)) {
      issue(telemetryPath, "must be an object");
    } else {
      onlyKeys(telemetry, telemetryPath, new Set(["status", "authority", "blockers", "comparison", "baseline", "candidate", "summary", "fields"]), "telemetry contract");
      if (!telemetryStatusValues.has(telemetry.status)) issue(`${telemetryPath}.status`, "must be comparable or blocked");
      if (telemetry.authority !== DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY) {
        issue(`${telemetryPath}.authority`, `must equal ${DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY}`);
      }
      const blockers = Array.isArray(telemetry.blockers) ? telemetry.blockers : [];
      if (!Array.isArray(telemetry.blockers)) {
        issue(`${telemetryPath}.blockers`, "must be an array");
      } else {
        blockers.forEach((entry, index) => text(entry, `${telemetryPath}.blockers[${index}]`, { max: 1000 }));
      }

      if (telemetry.status === "blocked") {
        if (blockers.length === 0) issue(`${telemetryPath}.blockers`, "must explain why transition telemetry is blocked");
        if (Object.hasOwn(telemetry, "summary")) issue(`${telemetryPath}.summary`, "must be absent when transition telemetry is blocked");
        if (Object.hasOwn(telemetry, "fields")) issue(`${telemetryPath}.fields`, "must be absent when transition telemetry is blocked");
        if (Object.hasOwn(telemetry, "comparison")) comparison(telemetry.comparison, `${telemetryPath}.comparison`);
        if (Object.hasOwn(telemetry, "baseline")) artifact(telemetry.baseline, `${telemetryPath}.baseline`);
        if (Object.hasOwn(telemetry, "candidate")) artifact(telemetry.candidate, `${telemetryPath}.candidate`);
      } else if (telemetry.status === "comparable") {
        if (blockers.length > 0) issue(`${telemetryPath}.blockers`, "must be empty when transition telemetry is comparable");
        if (trust?.status !== "pass") issue("$.trust.status", "must be pass when transition telemetry is comparable");
        if (blockedFields > 0 || blockedSamples > 0) {
          issue(telemetryPath, "cannot be comparable while primary fields or samples are blocked");
        }

        comparison(telemetry.comparison, `${telemetryPath}.comparison`);
        const baseline = artifact(telemetry.baseline, `${telemetryPath}.baseline`);
        const candidate = artifact(telemetry.candidate, `${telemetryPath}.candidate`);
        if (baseline?.check?.status !== "pass") issue(`${telemetryPath}.baseline.check.status`, "must pass for comparable transition telemetry");
        if (candidate?.check?.status !== "pass") issue(`${telemetryPath}.candidate.check.status`, "must pass for comparable transition telemetry");
        if (baseline?.stateVectorCheck?.status !== "pass") issue(`${telemetryPath}.baseline.stateVectorCheck.status`, "must pass for comparable transition telemetry");
        if (candidate?.stateVectorCheck?.status !== "pass") issue(`${telemetryPath}.candidate.stateVectorCheck.status`, "must pass for comparable transition telemetry");
        if (baseline && candidate && baseline.contractSha256 !== candidate.contractSha256) {
          issue(`${telemetryPath}.candidate.contractSha256`, "must equal the baseline contract SHA-256");
        }
        if (candidate && candidate.failedSampleCount !== failedSamples) {
          issue(`${telemetryPath}.candidate.failedSampleCount`, `must equal the primary failed sample total ${failedSamples}`);
        }

        const summary = telemetry.summary;
        if (!plainObject(summary)) {
          issue(`${telemetryPath}.summary`, "must be a telemetry summary object");
        } else {
          onlyKeys(summary, `${telemetryPath}.summary`, new Set(["failToPassCount", "passToFailCount", "stayedPassCount", "stayedFailCount", "netFailedSampleDelta", "residualCount", "reconciliation"]), "telemetry contract");
          count(summary.failToPassCount, `${telemetryPath}.summary.failToPassCount`);
          count(summary.passToFailCount, `${telemetryPath}.summary.passToFailCount`);
          count(summary.stayedPassCount, `${telemetryPath}.summary.stayedPassCount`);
          count(summary.stayedFailCount, `${telemetryPath}.summary.stayedFailCount`);
          integer(summary.netFailedSampleDelta, `${telemetryPath}.summary.netFailedSampleDelta`);
          integer(summary.residualCount, `${telemetryPath}.summary.residualCount`);
          if (summary.reconciliation !== "reconciled") issue(`${telemetryPath}.summary.reconciliation`, "must equal reconciled");
          if (Number.isSafeInteger(summary.failToPassCount) && Number.isSafeInteger(summary.passToFailCount)
            && summary.netFailedSampleDelta !== summary.passToFailCount - summary.failToPassCount) {
            issue(`${telemetryPath}.summary.netFailedSampleDelta`, "must equal passToFailCount - failToPassCount");
          }
          if (summary.residualCount !== 0) issue(`${telemetryPath}.summary.residualCount`, "must be zero for a reconciled comparable telemetry");
        }

        const telemetryFields = telemetry.fields;
        let fieldBaselineFailures = 0;
        let fieldCandidateFailures = 0;
        let fieldFailToPass = 0;
        let fieldPassToFail = 0;
        let fieldStayedPass = 0;
        let fieldStayedFail = 0;
        let fieldNetDelta = 0;
        let fieldResidual = 0;
        const baselineStateVectorRecords = [];
        const seenTelemetryFieldIds = new Set();
        if (!Array.isArray(telemetryFields)) {
          issue(`${telemetryPath}.fields`, "must be an array covering every primary field id");
        } else {
          if (telemetryFields.length !== payload.fields.length) {
            issue(`${telemetryPath}.fields`, `must contain exactly one entry for every primary field (${payload.fields.length})`);
          }
          telemetryFields.forEach((entry, fieldIndex) => {
            const path = `${telemetryPath}.fields[${fieldIndex}]`;
            if (!plainObject(entry)) {
              issue(path, "must be a telemetry field object");
              return;
            }
            onlyKeys(entry, path, new Set(["id", "baselineFailedSampleCount", "candidateFailedSampleCount", "failToPassCount", "passToFailCount", "stayedPassCount", "stayedFailCount", "netFailedSampleDelta", "residualCount", "reconciliation", "baselineStates", "transitions"]), "telemetry contract");
            const idValid = text(entry.id, `${path}.id`, { max: 160 });
            if (idValid) {
              if (seenTelemetryFieldIds.has(entry.id)) issue(`${path}.id`, `duplicates telemetry field id ${entry.id}`);
              seenTelemetryFieldIds.add(entry.id);
            }
            const primary = fieldRecords.get(entry.id);
            if (!primary) issue(`${path}.id`, "does not identify a primary payload field");
            count(entry.baselineFailedSampleCount, `${path}.baselineFailedSampleCount`);
            count(entry.candidateFailedSampleCount, `${path}.candidateFailedSampleCount`);
            count(entry.failToPassCount, `${path}.failToPassCount`);
            count(entry.passToFailCount, `${path}.passToFailCount`);
            count(entry.stayedPassCount, `${path}.stayedPassCount`);
            count(entry.stayedFailCount, `${path}.stayedFailCount`);
            integer(entry.netFailedSampleDelta, `${path}.netFailedSampleDelta`);
            integer(entry.residualCount, `${path}.residualCount`);
            if (entry.reconciliation !== "reconciled") issue(`${path}.reconciliation`, "must equal reconciled");

            if (primary && entry.candidateFailedSampleCount !== primary.field.failedSampleCount) {
              issue(`${path}.candidateFailedSampleCount`, `must equal primary field failedSampleCount ${primary.field.failedSampleCount}`);
            }
            if (Number.isSafeInteger(entry.baselineFailedSampleCount) && Number.isSafeInteger(entry.candidateFailedSampleCount)
              && entry.netFailedSampleDelta !== entry.candidateFailedSampleCount - entry.baselineFailedSampleCount) {
              issue(`${path}.netFailedSampleDelta`, "must equal candidateFailedSampleCount - baselineFailedSampleCount");
            }
            if (Number.isSafeInteger(entry.failToPassCount) && Number.isSafeInteger(entry.passToFailCount)
              && entry.netFailedSampleDelta !== entry.passToFailCount - entry.failToPassCount) {
              issue(`${path}.netFailedSampleDelta`, "must equal passToFailCount - failToPassCount");
            }
            if (Number.isSafeInteger(entry.baselineFailedSampleCount) && Number.isSafeInteger(entry.failToPassCount)
              && entry.stayedFailCount !== entry.baselineFailedSampleCount - entry.failToPassCount) {
              issue(`${path}.stayedFailCount`, "must equal baselineFailedSampleCount - failToPassCount");
            }
            if (Number.isSafeInteger(entry.candidateFailedSampleCount) && Number.isSafeInteger(entry.passToFailCount)
              && entry.stayedFailCount !== entry.candidateFailedSampleCount - entry.passToFailCount) {
              issue(`${path}.stayedFailCount`, "must equal candidateFailedSampleCount - passToFailCount");
            }
            if (primary && [entry.failToPassCount, entry.passToFailCount, entry.stayedPassCount, entry.stayedFailCount].every(Number.isSafeInteger)
              && entry.failToPassCount + entry.passToFailCount + entry.stayedPassCount + entry.stayedFailCount !== primary.field.sampleCount) {
              issue(path, `transition classes must partition all ${primary.field.sampleCount} comparable samples`);
            }
            const expectedResidual = Number.isSafeInteger(entry.candidateFailedSampleCount) && Number.isSafeInteger(entry.baselineFailedSampleCount)
              && Number.isSafeInteger(entry.passToFailCount) && Number.isSafeInteger(entry.failToPassCount)
              ? entry.candidateFailedSampleCount - entry.baselineFailedSampleCount - (entry.passToFailCount - entry.failToPassCount)
              : null;
            if (expectedResidual !== null && entry.residualCount !== expectedResidual) {
              issue(`${path}.residualCount`, `must reconcile the failed-sample delta; expected ${expectedResidual}`);
            }
            if (entry.residualCount !== 0) issue(`${path}.residualCount`, "must be zero for a reconciled comparable field");

            const expectedTransitions = [];
            let actualFailToPass = 0;
            let actualPassToFail = 0;
            if (!Array.isArray(entry.baselineStates)) {
              issue(`${path}.baselineStates`, "must be an array aligned one-to-one with the primary field samples");
            } else if (primary) {
              if (entry.baselineStates.length !== primary.field.sampleCount) {
                issue(`${path}.baselineStates`, `must contain exactly ${primary.field.sampleCount} aligned baseline states`);
              }
              primary.field.samples.forEach((sample, sampleIndex) => {
                const beforeState = entry.baselineStates[sampleIndex];
                const afterState = sample[3];
                if (![0, 1].includes(beforeState)) {
                  issue(`${path}.baselineStates[${sampleIndex}]`, "must be 0 or 1 for a comparable baseline sample");
                  return;
                }
                if (![0, 1].includes(afterState)) return;
                if (beforeState !== afterState) expectedTransitions.push([sample[0], beforeState, afterState]);
              });
              baselineStateVectorRecords.push({
                id: entry.id,
                samples: primary.field.samples.map((sample, sampleIndex) => [sample[0], entry.baselineStates[sampleIndex]]),
              });
            }
            let previousTransitionTick = -Infinity;
            if (!Array.isArray(entry.transitions)) {
              issue(`${path}.transitions`, "must be an array");
            } else {
              entry.transitions.forEach((transition, transitionIndex) => {
                const transitionPath = `${path}.transitions[${transitionIndex}]`;
                if (!Array.isArray(transition) || transition.length !== 3) {
                  issue(transitionPath, "must be [tick, baselineState, candidateState]");
                  return;
                }
                const [tick, beforeState, afterState] = transition;
                if (typeof tick !== "number" || !Number.isFinite(tick) || tick <= previousTransitionTick) {
                  issue(`${transitionPath}[0]`, "must be a finite tick greater than the previous transition tick");
                }
                previousTransitionTick = tick;
                if (beforeState === 1 && afterState === 0) actualFailToPass += 1;
                else if (beforeState === 0 && afterState === 1) actualPassToFail += 1;
                else issue(transitionPath, "must describe only a 1-to-0 or 0-to-1 transition");
                const primaryState = primary?.sampleStatesByTick.get(tick);
                if (primaryState === undefined) issue(`${transitionPath}[0]`, "does not identify a primary field sample tick");
                else if (primaryState !== afterState) issue(`${transitionPath}[2]`, `must equal the primary candidate state ${primaryState}`);
              });
            }
            if (entry.failToPassCount !== actualFailToPass) {
              issue(`${path}.failToPassCount`, `does not reconcile with transitions; expected ${actualFailToPass}`);
            }
            if (entry.passToFailCount !== actualPassToFail) {
              issue(`${path}.passToFailCount`, `does not reconcile with transitions; expected ${actualPassToFail}`);
            }
            if (primary && Array.isArray(entry.baselineStates) && !exactJsonEqual(entry.transitions, expectedTransitions)) {
              issue(`${path}.transitions`, "must equal the transitions reconstructed from baselineStates and primary candidate states");
            }

            if (Number.isSafeInteger(entry.baselineFailedSampleCount) && entry.baselineFailedSampleCount >= 0) fieldBaselineFailures += entry.baselineFailedSampleCount;
            if (Number.isSafeInteger(entry.candidateFailedSampleCount) && entry.candidateFailedSampleCount >= 0) fieldCandidateFailures += entry.candidateFailedSampleCount;
            if (Number.isSafeInteger(entry.failToPassCount) && entry.failToPassCount >= 0) fieldFailToPass += entry.failToPassCount;
            if (Number.isSafeInteger(entry.passToFailCount) && entry.passToFailCount >= 0) fieldPassToFail += entry.passToFailCount;
            if (Number.isSafeInteger(entry.stayedPassCount) && entry.stayedPassCount >= 0) fieldStayedPass += entry.stayedPassCount;
            if (Number.isSafeInteger(entry.stayedFailCount) && entry.stayedFailCount >= 0) fieldStayedFail += entry.stayedFailCount;
            if (Number.isSafeInteger(entry.netFailedSampleDelta)) fieldNetDelta += entry.netFailedSampleDelta;
            if (Number.isSafeInteger(entry.residualCount)) fieldResidual += entry.residualCount;
          });
          for (const id of fieldRecords.keys()) {
            if (!seenTelemetryFieldIds.has(id)) issue(`${telemetryPath}.fields`, `is missing primary field id ${id}`);
          }
        }

        if (baseline && baseline.failedSampleCount !== fieldBaselineFailures) {
          issue(`${telemetryPath}.baseline.failedSampleCount`, `does not reconcile with telemetry fields; expected ${fieldBaselineFailures}`);
        }
        if (candidate && candidate.failedSampleCount !== fieldCandidateFailures) {
          issue(`${telemetryPath}.candidate.failedSampleCount`, `does not reconcile with telemetry fields; expected ${fieldCandidateFailures}`);
        }
        if (baseline) {
          const expectedBaselineStateVectorSha256 = canonicalSha256(normalizedStateVectorRecords(baselineStateVectorRecords));
          if (baseline.stateVectorSha256 !== expectedBaselineStateVectorSha256) issue(`${telemetryPath}.baseline.stateVectorSha256`, "must equal the canonical tick/state vector reconstructed from baselineStates");
        }
        if (candidate) {
          const expectedCandidateStateVectorSha256 = differentialStateVectorSha256(payload);
          if (candidate.stateVectorSha256 !== expectedCandidateStateVectorSha256) issue(`${telemetryPath}.candidate.stateVectorSha256`, "must equal the canonical tick/state vector reconstructed from primary fields");
        }
        if (summary) {
          if (summary.failToPassCount !== fieldFailToPass) issue(`${telemetryPath}.summary.failToPassCount`, `does not reconcile with telemetry fields; expected ${fieldFailToPass}`);
          if (summary.passToFailCount !== fieldPassToFail) issue(`${telemetryPath}.summary.passToFailCount`, `does not reconcile with telemetry fields; expected ${fieldPassToFail}`);
          if (summary.stayedPassCount !== fieldStayedPass) issue(`${telemetryPath}.summary.stayedPassCount`, `does not reconcile with telemetry fields; expected ${fieldStayedPass}`);
          if (summary.stayedFailCount !== fieldStayedFail) issue(`${telemetryPath}.summary.stayedFailCount`, `does not reconcile with telemetry fields; expected ${fieldStayedFail}`);
          if (summary.netFailedSampleDelta !== fieldNetDelta) issue(`${telemetryPath}.summary.netFailedSampleDelta`, `does not reconcile with telemetry fields; expected ${fieldNetDelta}`);
          if (summary.residualCount !== fieldResidual) issue(`${telemetryPath}.summary.residualCount`, `does not reconcile with telemetry fields; expected ${fieldResidual}`);
        }
        if (baseline && candidate && summary && summary.netFailedSampleDelta !== candidate.failedSampleCount - baseline.failedSampleCount) {
          issue(`${telemetryPath}.summary.netFailedSampleDelta`, "must equal candidate.failedSampleCount - baseline.failedSampleCount");
        }
      }
    }
  }

  if (payload.telemetryGate !== undefined) {
    const gate = payload.telemetryGate;
    const gatePath = "$.telemetryGate";
    if (!plainObject(gate)) {
      issue(gatePath, "must be an automatic configured-scenario telemetry gate record");
    } else {
      onlyKeys(gate, gatePath, new Set(["status", "authority", "blockers", "configuredScenario", "clearedPrefixFrames", "completedBoundary", "nextBoundary", "gateId", "report"]), "telemetry-gate contract");
      if (!["not-due", "current", "blocked"].includes(gate.status)) issue(`${gatePath}.status`, "must be not-due, current, or blocked");
      if (gate.authority !== DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY) issue(`${gatePath}.authority`, `must equal ${DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY}`);
      const gateBlockers = Array.isArray(gate.blockers) ? gate.blockers : [];
      if (!Array.isArray(gate.blockers)) issue(`${gatePath}.blockers`, "must be an array");
      else gateBlockers.forEach((entry, index) => text(entry, `${gatePath}.blockers[${index}]`, { max: 1000 }));

      const scenario = gate.configuredScenario;
      if (!plainObject(scenario)) {
        issue(`${gatePath}.configuredScenario`, "must describe the complete configured scenario and cadence");
      } else {
        onlyKeys(scenario, `${gatePath}.configuredScenario`, new Set(["id", "frameCount", "cadenceFrames", "replaySha256", "profileSha256", "contractSha256"]), "telemetry-gate contract");
        text(scenario.id, `${gatePath}.configuredScenario.id`, { max: 160 });
        count(scenario.frameCount, `${gatePath}.configuredScenario.frameCount`);
        count(scenario.cadenceFrames, `${gatePath}.configuredScenario.cadenceFrames`);
        sha256(scenario.replaySha256, `${gatePath}.configuredScenario.replaySha256`);
        sha256(scenario.profileSha256, `${gatePath}.configuredScenario.profileSha256`);
        sha256(scenario.contractSha256, `${gatePath}.configuredScenario.contractSha256`);
        if (scenario.frameCount === 0) issue(`${gatePath}.configuredScenario.frameCount`, "must be greater than zero");
        if (scenario.cadenceFrames !== DIFFERENTIAL_TESTING_CADENCE_FRAMES) issue(`${gatePath}.configuredScenario.cadenceFrames`, `must equal the fixed workflow cadence of ${DIFFERENTIAL_TESTING_CADENCE_FRAMES} frames`);
      }
      count(gate.clearedPrefixFrames, `${gatePath}.clearedPrefixFrames`);
      count(gate.completedBoundary, `${gatePath}.completedBoundary`);
      if (gate.nextBoundary !== null) {
        count(gate.nextBoundary, `${gatePath}.nextBoundary`);
        if (gate.nextBoundary === 0) issue(`${gatePath}.nextBoundary`, "must be greater than zero");
      }
      if (gate.gateId !== null) text(gate.gateId, `${gatePath}.gateId`, { max: 160 });
      if (Number.isSafeInteger(gate.completedBoundary) && Number.isSafeInteger(gate.clearedPrefixFrames) && gate.completedBoundary > gate.clearedPrefixFrames) {
        issue(`${gatePath}.completedBoundary`, "cannot exceed clearedPrefixFrames");
      }
      if (plainObject(scenario) && Number.isSafeInteger(scenario.frameCount) && scenario.frameCount > 0) {
        if (Number.isSafeInteger(gate.clearedPrefixFrames) && gate.clearedPrefixFrames > scenario.frameCount) issue(`${gatePath}.clearedPrefixFrames`, "cannot exceed the configured scenario frameCount");
        if (Number.isSafeInteger(gate.completedBoundary) && gate.completedBoundary > scenario.frameCount) issue(`${gatePath}.completedBoundary`, "cannot exceed the configured scenario frameCount");
        if (gate.completedBoundary === scenario.frameCount) {
          if (gate.nextBoundary !== null) issue(`${gatePath}.nextBoundary`, "must be null after the terminal scenario boundary");
        } else if (gate.nextBoundary === null) {
          issue(`${gatePath}.nextBoundary`, "must identify the next automatic boundary before the scenario is complete");
        } else if (Number.isSafeInteger(gate.nextBoundary) && gate.nextBoundary > scenario.frameCount) {
          issue(`${gatePath}.nextBoundary`, "cannot exceed the configured scenario frameCount");
        }
      }
      if (plainObject(scenario)) {
        const terminalBoundary = gate.completedBoundary === scenario.frameCount;
        if (Number.isSafeInteger(gate.completedBoundary) && !terminalBoundary && gate.completedBoundary % DIFFERENTIAL_TESTING_CADENCE_FRAMES !== 0) issue(`${gatePath}.completedBoundary`, "must align to the fixed 10-frame cadence unless it is the terminal scenario boundary");
        const nextIsTerminal = gate.nextBoundary === scenario.frameCount;
        if (Number.isSafeInteger(gate.nextBoundary) && !nextIsTerminal && gate.nextBoundary % DIFFERENTIAL_TESTING_CADENCE_FRAMES !== 0) issue(`${gatePath}.nextBoundary`, "must align to the fixed 10-frame cadence unless it is the terminal scenario boundary");
        if (Number.isSafeInteger(gate.nextBoundary) && Number.isSafeInteger(gate.completedBoundary) && gate.nextBoundary <= gate.completedBoundary) issue(`${gatePath}.nextBoundary`, "must be later than completedBoundary");
        if (Number.isSafeInteger(gate.completedBoundary) && Number.isSafeInteger(scenario.frameCount) && scenario.frameCount > 0) {
          const expectedNextBoundary = gate.completedBoundary >= scenario.frameCount
            ? null
            : Math.min(gate.completedBoundary + DIFFERENTIAL_TESTING_CADENCE_FRAMES, scenario.frameCount);
          if (gate.nextBoundary !== expectedNextBoundary) issue(`${gatePath}.nextBoundary`, "must be derived from completedBoundary and the fixed 10-frame cadence");
        }
      }

      let gateReport = null;
      if (gate.report !== undefined) {
        if (!plainObject(gate.report)) {
          issue(`${gatePath}.report`, "must be a checked full-scenario telemetry report");
        } else {
          gateReport = gate.report;
          onlyKeys(gateReport, `${gatePath}.report`, new Set(["id", "generatedAt", "artifactSha256", "runtimeTreeSha256", "contractSha256", "scenarioId", "frameCount", "completedBoundary", "replaySha256", "profileSha256", "result", "check"]), "telemetry-gate contract");
          text(gateReport.id, `${gatePath}.report.id`, { max: 160 });
          if (!validTimestamp(gateReport.generatedAt)) issue(`${gatePath}.report.generatedAt`, "must be a parseable timestamp");
          sha256(gateReport.artifactSha256, `${gatePath}.report.artifactSha256`);
          sha256(gateReport.runtimeTreeSha256, `${gatePath}.report.runtimeTreeSha256`);
          sha256(gateReport.contractSha256, `${gatePath}.report.contractSha256`);
          text(gateReport.scenarioId, `${gatePath}.report.scenarioId`, { max: 160 });
          count(gateReport.frameCount, `${gatePath}.report.frameCount`);
          count(gateReport.completedBoundary, `${gatePath}.report.completedBoundary`);
          sha256(gateReport.replaySha256, `${gatePath}.report.replaySha256`);
          sha256(gateReport.profileSha256, `${gatePath}.report.profileSha256`);
          if (!resultValues.has(gateReport.result)) issue(`${gatePath}.report.result`, "uses an unsupported telemetry result");
          checkerAttestation(gateReport.check, `${gatePath}.report.check`);
          if (gateReport.check?.subjectSha256 !== gateReport.artifactSha256) issue(`${gatePath}.report.check.subjectSha256`, "must equal the telemetry report SHA-256");
          if (plainObject(scenario)) {
            if (gateReport.scenarioId !== scenario.id) issue(`${gatePath}.report.scenarioId`, "must equal the configured scenario id");
            if (gateReport.frameCount !== scenario.frameCount) issue(`${gatePath}.report.frameCount`, "must prove the report covers the full configured scenario");
            if (gateReport.replaySha256 !== scenario.replaySha256) issue(`${gatePath}.report.replaySha256`, "must equal the configured replay SHA-256");
            if (gateReport.profileSha256 !== scenario.profileSha256) issue(`${gatePath}.report.profileSha256`, "must equal the configured profile SHA-256");
            if (gateReport.contractSha256 !== scenario.contractSha256) issue(`${gatePath}.report.contractSha256`, "must equal the configured contract SHA-256");
          }
          if (gateReport.completedBoundary !== gate.completedBoundary) issue(`${gatePath}.report.completedBoundary`, "must equal the recorded completed cadence boundary");
        }
      }

      if (gate.status === "current") {
        if (gateBlockers.length > 0) issue(`${gatePath}.blockers`, "must be empty for a current telemetry gate");
        if (!gate.gateId) issue(`${gatePath}.gateId`, "must identify the current telemetry gate");
        if (!gateReport) issue(`${gatePath}.report`, "is required for a current telemetry gate");
        if (gateReport?.check?.status !== "pass") issue(`${gatePath}.report.check.status`, "must pass for a current telemetry gate");
        if (gate.completedBoundary === 0) issue(`${gatePath}.completedBoundary`, "must identify a crossed configured cadence boundary for a current telemetry gate");
        if (plainObject(scenario) && Number.isSafeInteger(scenario.frameCount) && Number.isSafeInteger(gate.clearedPrefixFrames)) {
          const highestCrossedBoundary = gate.clearedPrefixFrames >= scenario.frameCount
            ? scenario.frameCount
            : Math.floor(gate.clearedPrefixFrames / DIFFERENTIAL_TESTING_CADENCE_FRAMES) * DIFFERENTIAL_TESTING_CADENCE_FRAMES;
          if (gate.completedBoundary !== highestCrossedBoundary) issue(`${gatePath}.completedBoundary`, "must equal the highest fixed 10-frame boundary crossed by clearedPrefixFrames");
        }
        const validateGateRow = (row, path) => {
          if (!plainObject(row)) {
            issue(path, "must contain the current configured-scenario telemetry result");
            return;
          }
          const expected = {
            gateId: gate.gateId,
            scenarioId: scenario?.id,
            reportSha256: gateReport?.artifactSha256,
            runtimeTreeSha256: gateReport?.runtimeTreeSha256,
            contractSha256: gateReport?.contractSha256,
          };
          for (const [key, expectedValue] of Object.entries(expected)) {
            if (row[key] !== expectedValue) issue(`${path}.${key}`, `must bind the current telemetry gate ${key}`);
          }
          if (gateReport && row.result !== gateReport.result) issue(`${path}.result`, "must equal the current telemetry gate result");
          if (gateReport && row.timestamp !== gateReport.generatedAt) issue(`${path}.timestamp`, "must equal the current telemetry report timestamp");
        };
        validateGateRow(log[0], "$.log[0]");
        validateGateRow(progressRows.at(-1), `$.progress[${Math.max(0, progressRows.length - 1)}]`);
      } else if (gate.status === "not-due") {
        if (gateBlockers.length > 0) issue(`${gatePath}.blockers`, "must be empty when the automatic telemetry gate is not due");
        if (gate.gateId !== null) issue(`${gatePath}.gateId`, "must be null when no telemetry gate is due");
        if (gateReport) issue(`${gatePath}.report`, "must be absent when no telemetry gate is due");
        if (gate.completedBoundary !== 0) issue(`${gatePath}.completedBoundary`, "must be zero before the first configured cadence boundary is due");
        if (plainObject(scenario) && Number.isSafeInteger(gate.clearedPrefixFrames) && Number.isSafeInteger(gate.nextBoundary) && gate.clearedPrefixFrames >= gate.nextBoundary) issue(`${gatePath}.clearedPrefixFrames`, "cannot cross nextBoundary while telemetry gate status is not-due");
      } else if (gate.status === "blocked") {
        if (gateBlockers.length === 0) issue(`${gatePath}.blockers`, "must explain why automatic telemetry is blocked");
      }
    }
  }

  if (payload.exactSession !== undefined) {
    const exact = payload.exactSession;
    const exactPath = "$.exactSession";
    const validateNullableCount = (entry, path) => entry === null || count(entry, path);
    const validateNullableText = (entry, path, max) => text(entry, path, { nullable: true, max });

    if (!plainObject(exact)) {
      issue(exactPath, "must be an object");
    } else {
      onlyKeys(exact, exactPath, new Set(["strategy", "status", "authority", "blockers", "result", "session", "contract", "frontier", "producer", "decision"]), "exact-session contract");
      if (exact.strategy !== "exact-first") issue(`${exactPath}.strategy`, "must equal exact-first");
      if (!exactStatusValues.has(exact.status)) issue(`${exactPath}.status`, "must be ready, complete, or blocked");
      if (exact.authority !== DIFFERENTIAL_TESTING_EXACT_AUTHORITY) issue(`${exactPath}.authority`, `must equal ${DIFFERENTIAL_TESTING_EXACT_AUTHORITY}`);
      if (!exactResultValues.has(exact.result)) issue(`${exactPath}.result`, "must be advanced, complete, rejected, evidence-only, or blocked");
      const blockers = Array.isArray(exact.blockers) ? exact.blockers : [];
      if (!Array.isArray(exact.blockers)) issue(`${exactPath}.blockers`, "must be an array");
      else blockers.forEach((entry, index) => text(entry, `${exactPath}.blockers[${index}]`, { max: 1000 }));

      let session = null;
      if (exact.session !== undefined) {
        if (!plainObject(exact.session)) {
          issue(`${exactPath}.session`, "must identify the retained exact session");
        } else {
          session = exact.session;
          onlyKeys(session, `${exactPath}.session`, new Set([
            "id", "generatedAt", "scenarioId", "scenarioFrameCount", "profileId", "runtimeSide",
            "reportSha256", "stateSha256", "referenceSha256", "runtimeTreeSha256",
            "replaySha256", "profileSha256", "contractSha256", "clearedPrefixFrames", "nextBoundary",
          ]), "exact-session contract");
          text(session.id, `${exactPath}.session.id`, { max: 160 });
          if (!validTimestamp(session.generatedAt)) issue(`${exactPath}.session.generatedAt`, "must be a parseable timestamp");
          text(session.scenarioId, `${exactPath}.session.scenarioId`, { max: 160 });
          count(session.scenarioFrameCount, `${exactPath}.session.scenarioFrameCount`);
          if (session.scenarioFrameCount === 0) issue(`${exactPath}.session.scenarioFrameCount`, "must be greater than zero");
          text(session.profileId, `${exactPath}.session.profileId`, { max: 160 });
          text(session.runtimeSide, `${exactPath}.session.runtimeSide`, { max: 80 });
          for (const key of ["reportSha256", "stateSha256", "referenceSha256", "runtimeTreeSha256", "replaySha256", "profileSha256", "contractSha256"]) {
            sha256(session[key], `${exactPath}.session.${key}`);
          }
          count(session.clearedPrefixFrames, `${exactPath}.session.clearedPrefixFrames`);
          if (session.nextBoundary !== null) {
            count(session.nextBoundary, `${exactPath}.session.nextBoundary`);
            if (session.nextBoundary === 0) issue(`${exactPath}.session.nextBoundary`, "must be greater than zero");
          }
          if (Number.isSafeInteger(session.scenarioFrameCount) && Number.isSafeInteger(session.clearedPrefixFrames)) {
            if (session.clearedPrefixFrames > session.scenarioFrameCount) issue(`${exactPath}.session.clearedPrefixFrames`, "cannot exceed scenarioFrameCount");
            const expectedNextBoundary = session.clearedPrefixFrames >= session.scenarioFrameCount
              ? null
              : Math.min((Math.floor(session.clearedPrefixFrames / DIFFERENTIAL_TESTING_CADENCE_FRAMES) + 1) * DIFFERENTIAL_TESTING_CADENCE_FRAMES, session.scenarioFrameCount);
            if (session.nextBoundary !== expectedNextBoundary) issue(`${exactPath}.session.nextBoundary`, "must identify the next fixed 10-frame boundary after clearedPrefixFrames");
          }
        }
      }

      let exactContract = null;
      if (exact.contract !== undefined) {
        if (!plainObject(exact.contract)) {
          issue(`${exactPath}.contract`, "must describe the exact ordering contract");
        } else {
          exactContract = exact.contract;
          onlyKeys(exactContract, `${exactPath}.contract`, new Set(["schema", "sha256", "scope", "order", "numericAuthority", "retentionScope"]), "exact-session contract");
          text(exactContract.schema, `${exactPath}.contract.schema`, { max: 160 });
          sha256(exactContract.sha256, `${exactPath}.contract.sha256`);
          text(exactContract.scope, `${exactPath}.contract.scope`, { max: 500 });
          if (!Array.isArray(exactContract.order)) {
            issue(`${exactPath}.contract.order`, "must be the canonical exact coordinate ordering array");
          } else if (!exactJsonEqual(exactContract.order, DIFFERENTIAL_TESTING_EXACT_COORDINATE_ORDER)) {
            issue(`${exactPath}.contract.order`, `must equal the canonical order ${DIFFERENTIAL_TESTING_EXACT_COORDINATE_ORDER.join(" -> ")}`);
          }
          text(exactContract.numericAuthority, `${exactPath}.contract.numericAuthority`, { max: 160 });
          text(exactContract.retentionScope, `${exactPath}.contract.retentionScope`, { max: 160 });
        }
      }

      let frontier = null;
      if (exact.frontier !== undefined) {
        if (!plainObject(exact.frontier)) {
          issue(`${exactPath}.frontier`, "must be a complete exact frontier coordinate");
        } else {
          frontier = exact.frontier;
          onlyKeys(frontier, `${exactPath}.frontier`, new Set(["kind", "frame", "control", "tick", "call", "phaseOrder", "phase", "fieldId", "label", "sourceOwner", "operationId", "reference", "candidate", "referenceBits", "candidateBits", "prefixCount", "prefixSha256"]), "exact-session contract");
          if (!["divergence", "complete"].includes(frontier.kind)) issue(`${exactPath}.frontier.kind`, "must be divergence or complete");
          count(frontier.frame, `${exactPath}.frontier.frame`);
          validateNullableCount(frontier.control, `${exactPath}.frontier.control`);
          finite(frontier.tick, `${exactPath}.frontier.tick`);
          validateNullableCount(frontier.call, `${exactPath}.frontier.call`);
          validateNullableCount(frontier.phaseOrder, `${exactPath}.frontier.phaseOrder`);
          for (const [key, max] of [["phase", 160], ["fieldId", 160], ["label", 160], ["sourceOwner", 500], ["operationId", 160], ["referenceBits", 160], ["candidateBits", 160]]) {
            validateNullableText(frontier[key], `${exactPath}.frontier.${key}`, max);
          }
          if (!scalar(frontier.reference)) issue(`${exactPath}.frontier.reference`, "must be a JSON scalar or null");
          if (!scalar(frontier.candidate)) issue(`${exactPath}.frontier.candidate`, "must be a JSON scalar or null");
          count(frontier.prefixCount, `${exactPath}.frontier.prefixCount`);
          sha256(frontier.prefixSha256, `${exactPath}.frontier.prefixSha256`);
          if (frontier.kind === "divergence") {
            for (const key of ["phase", "fieldId", "label", "sourceOwner"]) {
              if (frontier[key] === null || frontier[key] === undefined) issue(`${exactPath}.frontier.${key}`, "must be present for a divergence frontier");
            }
          } else {
            for (const key of ["phase", "fieldId", "label", "sourceOwner", "operationId", "reference", "candidate", "referenceBits", "candidateBits"]) {
              if (frontier[key] !== null) issue(`${exactPath}.frontier.${key}`, "must be null for a complete frontier");
            }
          }
        }
      }

      let producer = null;
      if (exact.producer !== undefined) {
        if (!plainObject(exact.producer)) {
          issue(`${exactPath}.producer`, "must be a surfaced source-owned producer");
        } else {
          producer = exact.producer;
          onlyKeys(producer, `${exactPath}.producer`, new Set(["fieldId", "label", "sourceOwner", "sourceAnchor", "operationId", "frame", "tick", "phase", "candidateClass", "verdict", "lifecycle", "inputProof", "provenance", "dependencyCoverage", "oracleMode", "sourceOrder", "changeScope"]), "exact-session contract");
          text(producer.fieldId, `${exactPath}.producer.fieldId`, { max: 160 });
          text(producer.label, `${exactPath}.producer.label`, { max: 160 });
          text(producer.sourceOwner, `${exactPath}.producer.sourceOwner`, { max: 500 });
          validateNullableText(producer.sourceAnchor, `${exactPath}.producer.sourceAnchor`, 1000);
          validateNullableText(producer.operationId, `${exactPath}.producer.operationId`, 160);
          count(producer.frame, `${exactPath}.producer.frame`);
          finite(producer.tick, `${exactPath}.producer.tick`);
          text(producer.phase, `${exactPath}.producer.phase`, { max: 160 });
          if (!exactCandidateClasses.has(producer.candidateClass)) issue(`${exactPath}.producer.candidateClass`, "uses an unsupported producer class");
          if (!exactProducerVerdicts.has(producer.verdict)) issue(`${exactPath}.producer.verdict`, "uses an unsupported producer verdict");
          if (!exactProducerLifecycles.has(producer.lifecycle)) issue(`${exactPath}.producer.lifecycle`, "uses an unsupported source lifecycle");
          if (!exactInputProofStates.has(producer.inputProof)) issue(`${exactPath}.producer.inputProof`, "uses an unsupported same-frame input proof state");
          if (!exactProvenanceStates.has(producer.provenance)) issue(`${exactPath}.producer.provenance`, "uses an unsupported source-input provenance state");
          if (!exactCoverageStates.has(producer.dependencyCoverage)) issue(`${exactPath}.producer.dependencyCoverage`, "uses an unsupported dependency coverage state");
          if (!exactOracleModes.has(producer.oracleMode)) issue(`${exactPath}.producer.oracleMode`, "uses an unsupported oracle mode");
          if (!exactSourceOrderStates.has(producer.sourceOrder)) issue(`${exactPath}.producer.sourceOrder`, "uses an unsupported source-order readiness state");
          if (!exactChangeScopeStates.has(producer.changeScope)) issue(`${exactPath}.producer.changeScope`, "uses an unsupported source-change scope");
        }
      }

      let decision = null;
      if (!plainObject(exact.decision)) {
        issue(`${exactPath}.decision`, "must contain one fail-closed next decision");
      } else {
        decision = exact.decision;
        onlyKeys(decision, `${exactPath}.decision`, new Set(["kind", "targetFieldId", "targetLabel", "nextAction", "blockers", "retainedSessionId", "candidateSessionId"]), "exact-session contract");
        if (!exactDecisionKinds.has(decision.kind)) issue(`${exactPath}.decision.kind`, "uses an unsupported exact decision");
        validateNullableText(decision.targetFieldId, `${exactPath}.decision.targetFieldId`, 160);
        validateNullableText(decision.targetLabel, `${exactPath}.decision.targetLabel`, 160);
        text(decision.nextAction, `${exactPath}.decision.nextAction`, { max: 1000 });
        if (!Array.isArray(decision.blockers)) issue(`${exactPath}.decision.blockers`, "must be an array");
        else decision.blockers.forEach((entry, index) => text(entry, `${exactPath}.decision.blockers[${index}]`, { max: 1000 }));
        validateNullableText(decision.retainedSessionId, `${exactPath}.decision.retainedSessionId`, 160);
        validateNullableText(decision.candidateSessionId, `${exactPath}.decision.candidateSessionId`, 160);
      }

      if (session && exactContract && session.contractSha256 !== exactContract.sha256) {
        issue(`${exactPath}.session.contractSha256`, "must equal the retained exact contract SHA-256");
      }
      if (session && frontier) {
        if (frontier.kind === "divergence" && frontier.frame !== session.clearedPrefixFrames) {
          issue(`${exactPath}.frontier.frame`, "must identify the first frame after clearedPrefixFrames");
        }
        if (frontier.kind === "complete") {
          if (session.clearedPrefixFrames !== session.scenarioFrameCount) issue(`${exactPath}.session.clearedPrefixFrames`, "must equal scenarioFrameCount for a complete frontier");
          if (frontier.frame !== session.scenarioFrameCount) issue(`${exactPath}.frontier.frame`, "must equal scenarioFrameCount for a complete frontier");
        }
      }
      if (session && decision?.retainedSessionId !== session.id) {
        issue(`${exactPath}.decision.retainedSessionId`, "must equal the retained session id");
      }
      if (!session && decision?.retainedSessionId !== null) {
        issue(`${exactPath}.decision.retainedSessionId`, "must be null when no retained session is available");
      }

      if (["advanced", "complete"].includes(exact.result)) {
        if (!session) issue(`${exactPath}.session`, `is required for an ${exact.result} result`);
        if (session && decision?.candidateSessionId !== session.id) issue(`${exactPath}.decision.candidateSessionId`, "must equal the retained session id when the candidate is kept");
      } else if (exact.result === "rejected") {
        if (!session) issue(`${exactPath}.session`, "is required for a rejected result");
        if (decision?.candidateSessionId === null || decision?.candidateSessionId === undefined) issue(`${exactPath}.decision.candidateSessionId`, "must identify the rejected candidate session");
        else if (session && decision.candidateSessionId === session.id) issue(`${exactPath}.decision.candidateSessionId`, "must differ from the retained session id when the candidate is rejected");
      } else if (["evidence-only", "blocked"].includes(exact.result) && decision?.candidateSessionId !== null) {
        issue(`${exactPath}.decision.candidateSessionId`, `must be null for an ${exact.result} result`);
      }

      if (exact.status === "ready") {
        if (!session) issue(`${exactPath}.session`, "is required when exact-session status is ready");
        if (!exactContract) issue(`${exactPath}.contract`, "is required when exact-session status is ready");
        if (!frontier) issue(`${exactPath}.frontier`, "is required when exact-session status is ready");
        if (!producer) issue(`${exactPath}.producer`, "is required when exact-session status is ready");
        if (!["advanced", "rejected", "evidence-only"].includes(exact.result)) issue(`${exactPath}.result`, "must be advanced, rejected, or evidence-only when ready");
        if (blockers.length > 0) issue(`${exactPath}.blockers`, "must be empty when exact-session status is ready");
        if (frontier?.kind !== "divergence") issue(`${exactPath}.frontier.kind`, "must be divergence when exact-session status is ready");
        if (!["runtime-change", "evidence-change"].includes(decision?.kind)) issue(`${exactPath}.decision.kind`, "must be runtime-change or evidence-change when ready");
        if (decision?.blockers?.length > 0) issue(`${exactPath}.decision.blockers`, "must be empty when exact-session status is ready");
        if (producer && frontier && (producer.frame !== frontier.frame || producer.tick !== frontier.tick || producer.phase !== frontier.phase)) {
          issue(`${exactPath}.producer`, "must bind the active frontier frame, tick, and phase");
        }
        if (exact.result === "rejected" && decision?.kind !== "runtime-change") issue(`${exactPath}.decision.kind`, "must remain runtime-change after a rejected candidate");
        if (decision?.kind === "runtime-change") {
          if (!decision.targetFieldId || !decision.targetLabel) issue(`${exactPath}.decision`, "must name one exact runtime target");
          if (producer && decision.targetFieldId !== producer.fieldId) issue(`${exactPath}.decision.targetFieldId`, "must equal the surfaced producer field id");
          if (producer && decision.targetLabel !== producer.label) issue(`${exactPath}.decision.targetLabel`, "must equal the surfaced producer label");
          if (producer?.candidateClass !== "edit-candidate") issue(`${exactPath}.producer.candidateClass`, "must be edit-candidate for a runtime-change decision");
          if (producer?.verdict !== "actionable") issue(`${exactPath}.producer.verdict`, "must be actionable for a runtime-change decision");
          if (!producer?.sourceAnchor) issue(`${exactPath}.producer.sourceAnchor`, "must name the source anchor for a runtime-change decision");
          if (!producer?.operationId) issue(`${exactPath}.producer.operationId`, "must name the source operation for a runtime-change decision");
          if (!new Set(["source-phase", "mechanics", "contact"]).has(producer?.lifecycle)) issue(`${exactPath}.producer.lifecycle`, "must identify an edit-ready source lifecycle");
          if (!new Set(["proven", "not-applicable"]).has(producer?.inputProof)) issue(`${exactPath}.producer.inputProof`, "must be proven or not-applicable");
          if (!new Set(["source-provided", "not-applicable"]).has(producer?.provenance)) issue(`${exactPath}.producer.provenance`, "must be source-provided or not-applicable");
          if (!new Set(["covered", "not-applicable"]).has(producer?.dependencyCoverage)) issue(`${exactPath}.producer.dependencyCoverage`, "must be covered or not-applicable");
          if (!new Set(["strict", "numeric-toleranced"]).has(producer?.oracleMode)) issue(`${exactPath}.producer.oracleMode`, "must be strict or numeric-toleranced");
          if (!new Set(["single-operation", "atomic-proven"]).has(producer?.sourceOrder)) issue(`${exactPath}.producer.sourceOrder`, "must prove one operation or an atomic source-order bundle");
          if (!new Set(["single-source-coherent", "atomic-source-order"]).has(producer?.changeScope)) issue(`${exactPath}.producer.changeScope`, "must be one source-coherent change or an atomic source-order bundle");
          if (producer?.sourceOrder === "single-operation" && producer?.changeScope !== "single-source-coherent") issue(`${exactPath}.producer.changeScope`, "must match single-operation readiness");
          if (producer?.sourceOrder === "atomic-proven" && producer?.changeScope !== "atomic-source-order") issue(`${exactPath}.producer.changeScope`, "must match atomic-proven readiness");
        } else if (decision?.kind === "evidence-change") {
          if (decision.targetFieldId !== null || decision.targetLabel !== null) issue(`${exactPath}.decision`, "evidence-change must not name a runtime target");
          if (!["trace-first", "evidence-gap"].includes(producer?.verdict)) issue(`${exactPath}.producer.verdict`, "must identify a concrete evidence gap");
        }
      } else if (exact.status === "complete") {
        if (!session) issue(`${exactPath}.session`, "is required when exact-session status is complete");
        if (!exactContract) issue(`${exactPath}.contract`, "is required when exact-session status is complete");
        if (!frontier) issue(`${exactPath}.frontier`, "is required when exact-session status is complete");
        if (exact.result !== "complete") issue(`${exactPath}.result`, "must be complete when exact-session status is complete");
        if (blockers.length > 0) issue(`${exactPath}.blockers`, "must be empty when exact-session status is complete");
        if (producer) issue(`${exactPath}.producer`, "must be absent when exact comparison is complete");
        if (frontier?.kind !== "complete") issue(`${exactPath}.frontier.kind`, "must be complete when exact-session status is complete");
        if (decision?.kind !== "complete") issue(`${exactPath}.decision.kind`, "must be complete when exact-session status is complete");
        if (decision && (decision.targetFieldId !== null || decision.targetLabel !== null || decision.blockers?.length > 0)) issue(`${exactPath}.decision`, "complete must not name a target or blockers");
      } else if (exact.status === "blocked") {
        if (exact.result !== "blocked") issue(`${exactPath}.result`, "must be blocked when exact-session status is blocked");
        if (blockers.length === 0) issue(`${exactPath}.blockers`, "must explain why exact selection is blocked");
        if (producer) issue(`${exactPath}.producer`, "must be absent while exact selection is blocked");
        if (decision?.kind !== "blocked") issue(`${exactPath}.decision.kind`, "must be blocked while exact selection is blocked");
        if (decision && (decision.targetFieldId !== null || decision.targetLabel !== null)) issue(`${exactPath}.decision`, "blocked must not name a target");
        if (!Array.isArray(decision?.blockers) || decision.blockers.length === 0) issue(`${exactPath}.decision.blockers`, "must explain the blocked decision");
        else if (!exactJsonEqual(decision.blockers, blockers)) issue(`${exactPath}.decision.blockers`, "must equal the exact-session blockers");
      }

      if (plainObject(payload.telemetryGate) && session) {
        const gate = payload.telemetryGate;
        const scenario = gate.configuredScenario;
        if (plainObject(scenario)) {
          if (scenario.id !== session.scenarioId) issue("$.telemetryGate.configuredScenario.id", "must equal the retained exact-session scenario id");
          if (scenario.frameCount !== session.scenarioFrameCount) issue("$.telemetryGate.configuredScenario.frameCount", "must equal the retained exact-session scenario frame count");
          if (scenario.replaySha256 !== session.replaySha256) issue("$.telemetryGate.configuredScenario.replaySha256", "must equal the retained exact-session replay SHA-256");
          if (scenario.profileSha256 !== session.profileSha256) issue("$.telemetryGate.configuredScenario.profileSha256", "must equal the retained exact-session profile SHA-256");
          if (scenario.contractSha256 !== session.contractSha256) issue("$.telemetryGate.configuredScenario.contractSha256", "must equal the retained exact-session contract SHA-256");
        }
        if (gate.clearedPrefixFrames !== session.clearedPrefixFrames) issue("$.telemetryGate.clearedPrefixFrames", "must equal the retained exact-session clearedPrefixFrames");
        if (gate.nextBoundary !== session.nextBoundary) issue("$.telemetryGate.nextBoundary", "must equal the retained exact-session nextBoundary");
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function assertDifferentialTestingData(payload, options) {
  const result = validateDifferentialTestingData(payload, options);
  if (!result.ok) throw new DifferentialTestingDataValidationError(result.issues);
  return payload;
}

export function buildDifferentialTelemetry(baselinePayload, candidatePayload, provenance) {
  assertDifferentialTestingData(baselinePayload);
  assertDifferentialTestingData(candidatePayload);
  buildAssert(baselinePayload.trust?.status === "pass", "baseline primary trust must pass");
  buildAssert(candidatePayload.trust?.status === "pass", "candidate primary trust must pass");
  buildAssert(baselinePayload.summary?.frames?.blocked === 0, "baseline cannot contain missing or blocked samples");
  buildAssert(candidatePayload.summary?.frames?.blocked === 0, "candidate cannot contain missing or blocked samples");
  buildAssert(plainObject(provenance), "provenance must contain baseline and candidate seals");

  const comparison = buildComparison(provenance.comparison);
  const baselineSeal = buildSeal(baselinePayload, provenance.baseline, "baseline");
  const candidateSeal = buildSeal(candidatePayload, provenance.candidate, "candidate");
  buildAssert(baselineSeal.contractSha256 === candidateSeal.contractSha256, "baseline and candidate contract SHA-256 digests must match exactly");

  const baselineFields = new Map(baselinePayload.fields.map((field) => [field.id, field]));
  buildAssert(baselineFields.size === baselinePayload.fields.length, "baseline field ids must be unique");
  buildAssert(candidatePayload.fields.length === baselinePayload.fields.length, "baseline and candidate field id sets differ");
  const fields = candidatePayload.fields.map((candidateField) => {
    const baselineField = baselineFields.get(candidateField.id);
    buildAssert(baselineField, `baseline is missing field id ${candidateField.id}`);
    buildAssert(exactJsonEqual(fieldContract(baselineField), fieldContract(candidateField)), `field contract differs for ${candidateField.id}`);
    buildAssert(baselineField.samples.length === candidateField.samples.length, `sample count differs for ${candidateField.id}`);

    const transitions = [];
    const baselineStates = [];
    for (let index = 0; index < candidateField.samples.length; index += 1) {
      const baselineSample = baselineField.samples[index];
      const candidateSample = candidateField.samples[index];
      const tick = candidateSample[0];
      buildAssert(Object.is(baselineSample[0], tick), `tick identity differs for ${candidateField.id} at sample ${index}`);
      buildAssert(Object.is(baselineSample[1], candidateSample[1]), `reference value differs for ${candidateField.id} at tick ${tick}`);
      const beforeState = baselineSample[3];
      const afterState = candidateSample[3];
      buildAssert((beforeState === 0 || beforeState === 1) && (afterState === 0 || afterState === 1), `missing sample state prevents telemetry comparison for ${candidateField.id} at tick ${tick}`);
      baselineStates.push(beforeState);
      if (beforeState !== afterState) transitions.push([tick, beforeState, afterState]);
    }

    const failToPassCount = transitions.filter(([, beforeState, afterState]) => beforeState === 1 && afterState === 0).length;
    const passToFailCount = transitions.length - failToPassCount;
    const baselineFailedSampleCount = baselineField.failedSampleCount;
    const candidateFailedSampleCount = candidateField.failedSampleCount;
    const stayedFailCount = baselineFailedSampleCount - failToPassCount;
    const stayedPassCount = candidateField.sampleCount - failToPassCount - passToFailCount - stayedFailCount;
    const netFailedSampleDelta = candidateFailedSampleCount - baselineFailedSampleCount;
    const residualCount = netFailedSampleDelta - (passToFailCount - failToPassCount);
    buildAssert(netFailedSampleDelta === passToFailCount - failToPassCount, `transition counts do not reconcile for ${candidateField.id}`);
    buildAssert(stayedPassCount >= 0 && stayedFailCount >= 0, `transition classes do not partition comparable samples for ${candidateField.id}`);
    buildAssert(residualCount === 0, `transition residual is non-zero for ${candidateField.id}`);
    return {
      id: candidateField.id,
      baselineFailedSampleCount,
      candidateFailedSampleCount,
      failToPassCount,
      passToFailCount,
      stayedPassCount,
      stayedFailCount,
      netFailedSampleDelta,
      residualCount,
      reconciliation: "reconciled",
      baselineStates,
      transitions,
    };
  });

  for (const baselineField of baselinePayload.fields) {
    buildAssert(candidatePayload.fields.some((field) => field.id === baselineField.id), `candidate is missing field id ${baselineField.id}`);
  }
  const failToPassCount = fields.reduce((total, field) => total + field.failToPassCount, 0);
  const passToFailCount = fields.reduce((total, field) => total + field.passToFailCount, 0);
  const stayedPassCount = fields.reduce((total, field) => total + field.stayedPassCount, 0);
  const stayedFailCount = fields.reduce((total, field) => total + field.stayedFailCount, 0);
  const netFailedSampleDelta = candidatePayload.summary.frames.failed - baselinePayload.summary.frames.failed;
  const residualCount = netFailedSampleDelta - (passToFailCount - failToPassCount);
  buildAssert(netFailedSampleDelta === passToFailCount - failToPassCount, "top-level transition counts do not reconcile with failed sample totals");
  buildAssert(residualCount === 0, "top-level telemetry residual is non-zero");

  const telemetry = {
    status: "comparable",
    authority: DIFFERENTIAL_TESTING_TELEMETRY_AUTHORITY,
    blockers: [],
    comparison,
    baseline: {
      ...baselineSeal,
      failedSampleCount: baselinePayload.summary.frames.failed,
    },
    candidate: {
      ...candidateSeal,
      failedSampleCount: candidatePayload.summary.frames.failed,
    },
    summary: {
      failToPassCount,
      passToFailCount,
      stayedPassCount,
      stayedFailCount,
      netFailedSampleDelta,
      residualCount,
      reconciliation: "reconciled",
    },
    fields,
  };
  assertDifferentialTestingData({ ...candidatePayload, telemetry });
  return telemetry;
}

function buildComparison(value) {
  buildAssert(plainObject(value), "comparison provenance must bind the trusted reference, scenario, and alignment");
  const expectedKeys = ["alignmentKey", "referenceId", "referenceSha256", "scenarioId"];
  const actualKeys = Object.keys(value).sort();
  buildAssert(exactJsonEqual(actualKeys, expectedKeys), "comparison provenance must contain exactly referenceId, referenceSha256, scenarioId, and alignmentKey");
  buildAssert(typeof value.referenceId === "string" && value.referenceId.trim().length > 0 && value.referenceId.length <= 160, "comparison referenceId must be a non-empty string of at most 160 characters");
  buildAssert(typeof value.referenceSha256 === "string" && sha256Pattern.test(value.referenceSha256), "comparison referenceSha256 must be a lowercase 64-character SHA-256 digest");
  buildAssert(typeof value.scenarioId === "string" && value.scenarioId.trim().length > 0 && value.scenarioId.length <= 160, "comparison scenarioId must be a non-empty string of at most 160 characters");
  buildAssert(typeof value.alignmentKey === "string" && value.alignmentKey.trim().length > 0 && value.alignmentKey.length <= 160, "comparison alignmentKey must be a non-empty string of at most 160 characters");
  return {
    referenceId: value.referenceId,
    referenceSha256: value.referenceSha256,
    scenarioId: value.scenarioId,
    alignmentKey: value.alignmentKey,
  };
}

function buildSeal(payload, value, label) {
  buildAssert(plainObject(value), `${label} provenance seal must be an object`);
  const allowedKeys = new Set(["id", "generatedAt", "artifactSha256", "contractSha256", "check", "stateVectorSha256", "stateVectorCheck"]);
  buildAssert(Object.keys(value).every((key) => allowedKeys.has(key)), `${label} provenance seal contains unsupported keys`);
  buildAssert(typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 160, `${label} provenance id must be a non-empty string`);
  buildAssert(typeof value.artifactSha256 === "string" && sha256Pattern.test(value.artifactSha256), `${label} artifactSha256 must be a lowercase 64-character SHA-256 digest`);
  buildAssert(typeof value.contractSha256 === "string" && sha256Pattern.test(value.contractSha256), `${label} contractSha256 must be a lowercase 64-character SHA-256 digest`);
  if (value.generatedAt !== undefined) buildAssert(validTimestamp(value.generatedAt), `${label} provenance generatedAt must be a parseable timestamp`);
  const check = buildCheckerAttestation(value.check, label, value.artifactSha256);
  const expectedStateVectorSha256 = differentialStateVectorSha256(payload);
  buildAssert(value.stateVectorSha256 === expectedStateVectorSha256, `${label} stateVectorSha256 must equal the canonical normalized tick/state vector`);
  const stateVectorCheck = buildStateVectorAttestation(value.stateVectorCheck, label, value.stateVectorSha256, value.artifactSha256);
  const declaredArtifactSha256 = payload.adapter?.artifactSha256 ?? payload.adapter?.reportSha256;
  if (declaredArtifactSha256 !== undefined && declaredArtifactSha256 !== null) {
    buildAssert(declaredArtifactSha256 === value.artifactSha256, `${label} artifact SHA-256 does not match payload adapter provenance`);
  }
  const declaredContractSha256 = payload.adapter?.contractSha256 ?? payload.adapter?.rowContractSha256;
  if (declaredContractSha256 !== undefined && declaredContractSha256 !== null) {
    buildAssert(declaredContractSha256 === value.contractSha256, `${label} contract SHA-256 does not match payload adapter provenance`);
  }
  return {
    id: value.id,
    generatedAt: value.generatedAt ?? payload.publishedAt,
    artifactSha256: value.artifactSha256,
    contractSha256: value.contractSha256,
    check,
    stateVectorSha256: value.stateVectorSha256,
    stateVectorCheck,
  };
}

function buildCheckerAttestation(value, label, subjectSha256) {
  buildAssert(plainObject(value), `${label} checker attestation must be an object`);
  buildAssert(exactJsonEqual(Object.keys(value).sort(), ["id", "sha256", "status", "subjectSha256"]), `${label} checker attestation must contain exactly status, id, sha256, and subjectSha256`);
  buildAssert(value.status === "pass", `${label} checker attestation must pass`);
  buildAssert(typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 160, `${label} checker id must be a non-empty string`);
  buildAssert(typeof value.sha256 === "string" && sha256Pattern.test(value.sha256), `${label} checker sha256 must be a lowercase 64-character SHA-256 digest`);
  buildAssert(value.subjectSha256 === subjectSha256, `${label} checker subjectSha256 must equal the checked artifact SHA-256`);
  return { status: value.status, id: value.id, sha256: value.sha256, subjectSha256: value.subjectSha256 };
}

function buildStateVectorAttestation(value, label, subjectSha256, artifactSha256) {
  buildAssert(plainObject(value), `${label} state-vector checker attestation must be an object`);
  buildAssert(exactJsonEqual(Object.keys(value).sort(), ["artifactSha256", "id", "sha256", "status", "subjectSha256"]), `${label} state-vector checker attestation must contain exactly status, id, sha256, subjectSha256, and artifactSha256`);
  buildAssert(value.status === "pass", `${label} state-vector checker attestation must pass`);
  buildAssert(typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 160, `${label} state-vector checker id must be a non-empty string`);
  buildAssert(typeof value.sha256 === "string" && sha256Pattern.test(value.sha256), `${label} state-vector checker sha256 must be a lowercase 64-character SHA-256 digest`);
  buildAssert(value.subjectSha256 === subjectSha256, `${label} state-vector checker subjectSha256 must equal the canonical state-vector SHA-256`);
  buildAssert(value.artifactSha256 === artifactSha256, `${label} state-vector checker artifactSha256 must equal the checked artifact SHA-256`);
  return { status: value.status, id: value.id, sha256: value.sha256, subjectSha256: value.subjectSha256, artifactSha256: value.artifactSha256 };
}

function fieldContract(field) {
  return {
    id: field.id,
    label: field.label,
    sourceOwner: field.sourceOwner,
    semantics: field.semantics,
    unit: field.unit,
    tolerance: field.tolerance,
  };
}

function exactJsonEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => exactJsonEqual(entry, right[index]));
  }
  if (!plainObject(left) || !plainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && exactJsonEqual(left[key], right[key]));
}

function buildAssert(condition, message) {
  if (!condition) throw new Error(`Cannot build Differential Testing telemetry: ${message}.`);
}
