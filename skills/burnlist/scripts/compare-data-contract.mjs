export const COMPARE_DATA_SCHEMA = "burnlist-compare-data@1";

export const COMPARE_SAMPLE_STATES = Object.freeze({
  match: 0,
  mismatch: 1,
  referenceMissing: 2,
  candidateMissing: 3,
  bothMissing: 4,
});

const resultValues = new Set(["pass", "improved", "unchanged", "worsened", "blocked"]);
const trustValues = new Set(["pass", "blocked"]);
const scalarTypes = new Set(["string", "number", "boolean"]);

export class CompareDataValidationError extends Error {
  constructor(issues) {
    const shown = issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    const remainder = issues.length > 8 ? `; plus ${issues.length - 8} more` : "";
    super(`Compare data is invalid: ${shown}${remainder}`);
    this.name = "CompareDataValidationError";
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

export function validateCompareData(payload, { maxIssues = 50 } = {}) {
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

  if (!plainObject(payload)) {
    issue("$", "must be an object");
    return { ok: false, issues };
  }
  if (payload.schema !== COMPARE_DATA_SCHEMA) issue("$.schema", `must equal ${COMPARE_DATA_SCHEMA}`);
  if (!validTimestamp(payload.generatedAt)) issue("$.generatedAt", "must be a parseable timestamp");
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
    });
    return rows;
  };

  validateResultRows(payload.progress, "$.progress");
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
      if (!scalar(reference)) issue(`${samplePath}[1]`, "must be a JSON scalar or null");
      if (!scalar(candidate)) issue(`${samplePath}[2]`, "must be a JSON scalar or null");
      if (![0, 1, 2, 3, 4].includes(state)) {
        issue(`${samplePath}[3]`, "must be an integer sample state from 0 to 4");
        return;
      }
      if (state !== 0 && firstNonPass === null) firstNonPass = tick;
      if (state === COMPARE_SAMPLE_STATES.mismatch) rowFailed += 1;
      if (state >= COMPARE_SAMPLE_STATES.referenceMissing) rowMissing += 1;
      if ((state === COMPARE_SAMPLE_STATES.referenceMissing || state === COMPARE_SAMPLE_STATES.bothMissing) && reference !== null) {
        issue(`${samplePath}[1]`, "must be null when the reference sample is missing");
      }
      if ((state === COMPARE_SAMPLE_STATES.candidateMissing || state === COMPARE_SAMPLE_STATES.bothMissing) && candidate !== null) {
        issue(`${samplePath}[2]`, "must be null when the candidate sample is missing");
      }
      if (state <= COMPARE_SAMPLE_STATES.mismatch && scalar(reference) && scalar(candidate) && toleranceValid) {
        const matches = valuesMatch(reference, candidate, field.tolerance);
        if (matches !== (state === COMPARE_SAMPLE_STATES.match)) issue(`${samplePath}[3]`, "disagrees with the values and tolerance");
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

  return { ok: issues.length === 0, issues };
}

export function assertCompareData(payload, options) {
  const result = validateCompareData(payload, options);
  if (!result.ok) throw new CompareDataValidationError(result.issues);
  return payload;
}
