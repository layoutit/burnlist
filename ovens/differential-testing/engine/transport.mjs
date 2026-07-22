import { createHash } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  DIFFERENTIAL_TESTING_DATA_SCHEMA,
  assertDifferentialTestingData,
} from "./data-contract.mjs";

export const DIFFERENTIAL_TESTING_BUNDLE_SCHEMA = "burnlist-differential-testing-bundle@1";
export const DIFFERENTIAL_TESTING_SCENARIO_SCHEMA = "burnlist-differential-testing-scenario@1";
export const DIFFERENTIAL_TESTING_FIELD_RECORD_SCHEMA = "burnlist-differential-testing-field-record@1";
export const DIFFERENTIAL_TESTING_PAGE_SCHEMA = "burnlist-differential-testing-page@1";

const SHA256 = /^[a-f0-9]{64}$/u;
const SCENARIO_ID = /^[a-f0-9]{16}$/u;
const PAGE_SIZES = new Set([25, 50, 100, 200]);
const DEFAULT_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_RECORDS_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_RECORD_BYTES = 8 * 1024 * 1024;
const FIELD_KEYS = new Set([
  "id", "label", "sourceOwner", "semantics", "unit", "tolerance", "trustStatus",
  "driftClass", "driftReason", "sampleCount", "failedSampleCount", "missingSampleCount",
  "firstFailingTick", "maxDelta", "samples",
]);
const TELEMETRY_FIELD_KEYS = new Set([
  "id", "baselineFailedSampleCount", "candidateFailedSampleCount", "failToPassCount",
  "passToFailCount", "stayedPassCount", "stayedFailCount", "netFailedSampleDelta",
  "residualCount", "reconciliation", "baselineStates", "transitions",
]);

export class DifferentialTestingTransportError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "DifferentialTestingTransportError";
    this.status = status;
  }
}

export function isDifferentialTestingBundle(value) {
  return value?.schema === DIFFERENTIAL_TESTING_BUNDLE_SCHEMA;
}

export function readDifferentialTestingBundleManifest(path, {
  maxDocumentBytes = DEFAULT_MAX_DOCUMENT_BYTES, readSource = readBoundedFile,
} = {}) {
  const readPath = regularContainedFile(resolve(path), dirname(resolve(path)), "Differential Testing bundle manifest");
  const bytes = readSource(readPath, maxDocumentBytes, "Differential Testing bundle manifest");
  if (!Buffer.isBuffer(bytes) || bytes.length > maxDocumentBytes) fail(`Differential Testing bundle manifest exceeds ${maxDocumentBytes} bytes`, 413);
  const manifest = parseJson(bytes, "Differential Testing bundle manifest");
  assertOnlyKeys(manifest, new Set(["schema", "publishedAt", "scenarioCatalog", "scenarioBindings", "emptyData"]), "bundle manifest");
  if (manifest.schema !== DIFFERENTIAL_TESTING_BUNDLE_SCHEMA) fail(`bundle schema must equal ${DIFFERENTIAL_TESTING_BUNDLE_SCHEMA}`);
  timestamp(manifest.publishedAt, "bundle publishedAt");
  const catalog = validateScenarioCatalog(manifest.scenarioCatalog, "bundle scenarioCatalog");
  if (!Array.isArray(manifest.scenarioBindings)) fail("bundle scenarioBindings must be an array");
  if (manifest.scenarioBindings.length !== catalog.scenarios.length) fail("bundle scenarioBindings must cover every catalog scenario exactly once");
  const byId = new Map();
  let previousId = "";
  for (const [index, binding] of manifest.scenarioBindings.entries()) {
    const label = `bundle scenarioBindings[${index}]`;
    assertOnlyKeys(binding, new Set(["scenarioId", "path", "size", "sha256"]), label);
    scenarioId(binding.scenarioId, `${label}.scenarioId`);
    if (binding.scenarioId <= previousId) fail("bundle scenarioBindings must be ordered by scenarioId");
    previousId = binding.scenarioId;
    if (binding.path !== `scenarios/${binding.scenarioId}/scenario.json`) fail(`${label}.path must use the canonical contained scenario path`);
    positiveCount(binding.size, `${label}.size`);
    digest(binding.sha256, `${label}.sha256`);
    if (byId.has(binding.scenarioId)) fail(`${label}.scenarioId is duplicated`);
    byId.set(binding.scenarioId, binding);
  }
  for (const entry of catalog.scenarios) if (!byId.has(entry.id)) fail(`bundle has no scenario binding for ${entry.id}`);
  if (catalog.scenarios.length === 0) {
    if (!manifest.emptyData || manifest.emptyData.schema !== DIFFERENTIAL_TESTING_DATA_SCHEMA) fail("an empty bundle must carry emptyData");
    assertDifferentialTestingData(manifest.emptyData);
    if (manifest.emptyData.publishedAt !== manifest.publishedAt) fail("emptyData publishedAt must equal the bundle publishedAt");
    if (manifest.emptyData.scenarioCatalog.selectedScenarioId !== null || manifest.emptyData.scenarioCatalog.scenarios.length !== 0) fail("emptyData must have an empty scenario catalog");
  } else if (manifest.emptyData !== null) {
    fail("a non-empty bundle must set emptyData to null");
  }
  return {
    schema: manifest.schema,
    manifest,
    readPath,
    root: realpathSync(dirname(readPath)),
    sourceBytes: bytes.length,
    sha256: sha256(bytes),
    selectedScenarioId: catalog.selectedScenarioId,
    scenarios: catalog.scenarios,
    scenarioBindings: byId,
  };
}
export function readDifferentialTestingBundleScenario(bundle, requestedScenarioId, {
  maxDocumentBytes = DEFAULT_MAX_DOCUMENT_BYTES,
  maxRecordsBytes = DEFAULT_MAX_RECORDS_BYTES,
  maxRecordBytes = DEFAULT_MAX_RECORD_BYTES, readSource = readBoundedFile,
} = {}) {
  const id = scenarioId(requestedScenarioId, "requested scenario id");
  const binding = bundle.scenarioBindings.get(id);
  if (!binding) throw new DifferentialTestingTransportError(`scenario ${id} is not in the published bundle`, 404);
  const scenarioPath = regularContainedFile(resolveRelative(bundle.root, binding.path, "scenario binding"), bundle.root, `scenario ${id}`);
  const scenarioBytes = readSource(scenarioPath, maxDocumentBytes, `Differential Testing scenario ${id}`);
  if (!Buffer.isBuffer(scenarioBytes) || scenarioBytes.length > maxDocumentBytes) fail(`Differential Testing scenario ${id} exceeds ${maxDocumentBytes} bytes`, 413);
  if (scenarioBytes.length !== binding.size || sha256(scenarioBytes) !== binding.sha256) fail(`scenario binding changed for ${id}`);
  const scenario = parseJson(scenarioBytes, `Differential Testing scenario ${id}`);
  assertOnlyKeys(scenario, new Set(["schema", "scenarioId", "data", "frameDelta", "fieldIndex", "records"]), `scenario ${id}`);
  if (scenario.schema !== DIFFERENTIAL_TESTING_SCENARIO_SCHEMA) fail(`scenario ${id} schema must equal ${DIFFERENTIAL_TESTING_SCENARIO_SCHEMA}`);
  if (scenario.scenarioId !== id) fail(`scenario ${id} identity changed`);
  const catalogEntry = bundle.scenarios.find((entry) => entry.id === id);
  validateScenarioEnvelope(scenario.data, id, catalogEntry, bundle.manifest.publishedAt);
  const frameDelta = validateFrameDeltaShape(scenario.frameDelta, `scenario ${id}.frameDelta`);
  if (!Array.isArray(scenario.fieldIndex)) fail(`scenario ${id}.fieldIndex must be an array`);
  assertOnlyKeys(scenario.records, new Set(["path", "size", "sha256", "count"]), `scenario ${id}.records`);
  if (scenario.records.path !== "fields.ndjson") fail(`scenario ${id}.records.path must equal fields.ndjson`);
  count(scenario.records.size, `scenario ${id}.records.size`);
  if (scenario.records.size > maxRecordsBytes) fail(`scenario ${id} records exceed ${maxRecordsBytes} bytes`, 413);
  digest(scenario.records.sha256, `scenario ${id}.records.sha256`);
  count(scenario.records.count, `scenario ${id}.records.count`);
  if (scenario.records.count !== scenario.fieldIndex.length) fail(`scenario ${id} records count must equal fieldIndex length`);
  const recordsPath = regularContainedFile(resolveRelative(dirname(scenarioPath), scenario.records.path, "records binding"), dirname(scenarioPath), `scenario ${id} records`);
  const recordsStat = statSync(recordsPath);
  if (recordsStat.size !== scenario.records.size) fail(`scenario ${id} records size changed`);
  if (hashFile(recordsPath) !== scenario.records.sha256) fail(`scenario ${id} records SHA-256 changed`);

  const validation = validateRecords({
    id,
    data: scenario.data,
    fieldIndex: scenario.fieldIndex,
    frameDelta,
    recordsPath,
    recordsSize: recordsStat.size,
    maxRecordBytes,
  });
  return {
    schema: scenario.schema,
    scenarioId: id,
    data: {
      ...scenario.data,
      scenarioCatalog: { selectedScenarioId: id, scenarios: bundle.scenarios },
    },
    frameDeltaMetrics: validation.frameDeltaMetrics,
    fieldIndex: validation.fieldIndex,
    recordsPath,
    recordsSignature: differentialTestingRecordsSignature(recordsPath),
    scenarioSha256: binding.sha256,
  };
}
export function assertDifferentialTestingBundle(path, options = {}) {
  const bundle = readDifferentialTestingBundleManifest(path, options);
  for (const scenario of bundle.scenarios) readDifferentialTestingBundleScenario(bundle, scenario.id, options);
  return bundle;
}

export function queryDifferentialTestingFieldPage(scenario, {
  search = "",
  filter = "all",
  sort = "default",
  page = 0,
  pageSize = 25,
} = {}) {
  const query = String(search ?? "");
  if (query.length > 200) throw new DifferentialTestingTransportError("search must be at most 200 characters", 400);
  if (!new Set(["all", "failing"]).has(filter)) throw new DifferentialTestingTransportError("filter must be all or failing", 400);
  if (!new Set(["default", "changed"]).has(sort)) throw new DifferentialTestingTransportError("sort must be default or changed", 400);
  if (!Number.isSafeInteger(page) || page < 0) throw new DifferentialTestingTransportError("page must be a non-negative integer", 400);
  if (!PAGE_SIZES.has(pageSize)) throw new DifferentialTestingTransportError("pageSize must be 25, 50, 100, or 200", 400);
  const needle = query.trim().toLowerCase();
  let matches = scenario.fieldIndex.filter((entry) => {
    const field = entry.field;
    if (filter === "failing" && nonPass(field) === 0) return false;
    if (!needle) return true;
    return [field.label, field.sourceOwner, field.driftClass, field.semantics?.kind]
      .some((value) => String(value || "").toLowerCase().includes(needle));
  });
  if (sort === "changed") {
    matches = matches.filter((entry) => telemetryChange(entry.telemetry) > 0)
      .sort((left, right) => telemetryChange(right.telemetry) - telemetryChange(left.telemetry)
        || telemetryImprovement(right.telemetry) - telemetryImprovement(left.telemetry)
        || left.ordinal - right.ordinal);
  } else {
    matches.sort((left, right) => left.ordinal - right.ordinal);
  }
  const total = matches.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Math.min(page, pageCount - 1);
  const selected = matches.slice(normalizedPage * pageSize, normalizedPage * pageSize + pageSize);
  if (differentialTestingRecordsSignature(scenario.recordsPath) !== scenario.recordsSignature) fail(`scenario ${scenario.scenarioId} records changed after validation`);
  const records = selected.map((entry) => readBoundRecord(scenario.recordsPath, scenario.scenarioId, entry));
  return {
    search: query,
    filter,
    sort,
    page: normalizedPage,
    pageSize,
    pageCount,
    total,
    fields: records.map((record) => record.field),
    telemetryFields: records.map((record) => record.telemetry).filter(Boolean),
  };
}

function validateRecords({ id, data, fieldIndex, frameDelta, recordsPath, recordsSize, maxRecordBytes }) {
  if (fieldIndex.length === 0 && frameDelta.ticks.length !== 0) fail(`scenario ${id}.frameDelta arrays must be empty when fieldIndex is empty`);
  const telemetryComparable = data.telemetry?.status === "comparable";
  const indexes = [];
  const ordinals = new Set();
  let expectedOffset = 0;
  let previousId = "";
  let canonicalTicks = null;
  let passedFields = 0;
  let failedFields = 0;
  let blockedFields = 0;
  let passedSamples = 0;
  let failedSamples = 0;
  let blockedSamples = 0;
  let baselineFailed = 0;
  let candidateFailed = 0;
  const telemetryTotals = { failToPassCount: 0, passToFailCount: 0, stayedPassCount: 0, stayedFailCount: 0, netFailedSampleDelta: 0, residualCount: 0 };
  const candidateStateHash = createHash("sha256");
  const baselineStateHash = createHash("sha256");
  candidateStateHash.update("[");
  baselineStateHash.update("[");
  const activeCounts = Array(frameDelta.ticks.length).fill(0);
  const nonPassCounts = Array(frameDelta.ticks.length).fill(0);

  for (const [index, entry] of fieldIndex.entries()) {
    const label = `scenario ${id}.fieldIndex[${index}]`;
    assertOnlyKeys(entry, new Set(["id", "ordinal", "field", "telemetry", "record"]), label);
    text(entry.id, `${label}.id`, 160);
    if (previousId && entry.id.localeCompare(previousId) <= 0) fail(`scenario ${id} fieldIndex must be ordered lexicographically by id`);
    previousId = entry.id;
    count(entry.ordinal, `${label}.ordinal`);
    if (entry.ordinal >= fieldIndex.length || ordinals.has(entry.ordinal)) fail(`${label}.ordinal must uniquely cover 0 through ${Math.max(0, fieldIndex.length - 1)}`);
    ordinals.add(entry.ordinal);
    assertOnlyKeys(entry.record, new Set(["offset", "size", "sha256"]), `${label}.record`);
    count(entry.record.offset, `${label}.record.offset`);
    positiveCount(entry.record.size, `${label}.record.size`);
    if (entry.record.size > maxRecordBytes) fail(`${label}.record.size exceeds ${maxRecordBytes}`, 413);
    digest(entry.record.sha256, `${label}.record.sha256`);
    if (entry.record.offset !== expectedOffset) fail(`${label}.record.offset must be contiguous; expected ${expectedOffset}`);
    if (entry.record.offset + entry.record.size + 1 > recordsSize) fail(`${label}.record escapes fields.ndjson`);
    const record = readBoundRecord(recordsPath, id, entry);
    expectedOffset += entry.record.size + 1;
    const fieldProjection = omit(record.field, "samples");
    const telemetryProjection = record.telemetry ? omit(record.telemetry, "baselineStates", "transitions") : null;
    if (canonicalJson(entry.field) !== canonicalJson(fieldProjection)) fail(`${label}.field does not match its record projection`);
    if (canonicalJson(entry.telemetry) !== canonicalJson(telemetryProjection)) fail(`${label}.telemetry does not match its record projection`);
    const fieldResult = validateField(record.field, `${label}.field`);
    if (canonicalTicks === null) canonicalTicks = fieldResult.ticks;
    else if (!sameArray(canonicalTicks, fieldResult.ticks)) fail(`${label}.field sample ticks differ from the canonical tick sequence`);
    if (!sameArray(frameDelta.ticks, fieldResult.ticks)) fail(`${label}.field sample ticks differ from frameDelta.ticks`);
    if (fieldResult.blocked) blockedFields += 1;
    else if (fieldResult.failed > 0) failedFields += 1;
    else passedFields += 1;
    passedSamples += fieldResult.passed;
    failedSamples += fieldResult.failed;
    blockedSamples += fieldResult.missing;
    fieldResult.states.forEach((state, sampleIndex) => {
      if (state === 4) return;
      activeCounts[sampleIndex] += 1;
      if (state !== 0) nonPassCounts[sampleIndex] += 1;
    });
    candidateStateHash.update(index ? "," : "");
    candidateStateHash.update(canonicalJson({ id: entry.id, samples: fieldResult.ticks.map((tick, sampleIndex) => [tick, fieldResult.states[sampleIndex]]) }));
    if (telemetryComparable) {
      if (!record.telemetry) fail(`${label}.telemetry is required for comparable telemetry`);
      const telemetry = validateTelemetryField(record.telemetry, record.field, `${label}.telemetry`);
      baselineStateHash.update(index ? "," : "");
      baselineStateHash.update(canonicalJson({ id: entry.id, samples: fieldResult.ticks.map((tick, sampleIndex) => [tick, telemetry.baselineStates[sampleIndex]]) }));
      baselineFailed += record.telemetry.baselineFailedSampleCount;
      candidateFailed += record.telemetry.candidateFailedSampleCount;
      for (const key of Object.keys(telemetryTotals)) telemetryTotals[key] += record.telemetry[key];
    } else if (record.telemetry !== null) {
      fail(`${label}.telemetry must be null unless aggregate telemetry is comparable`);
    }
    indexes.push({ ...entry, field: fieldProjection, telemetry: telemetryProjection });
  }
  if (expectedOffset !== recordsSize) fail(`scenario ${id} records contain trailing or unindexed bytes`);
  candidateStateHash.update("]");
  baselineStateHash.update("]");
  if (!sameArray(frameDelta.activeCounts, activeCounts)) fail(`scenario ${id}.frameDelta.activeCounts do not reconcile with records`);
  if (!sameArray(frameDelta.nonPassCounts, nonPassCounts)) fail(`scenario ${id}.frameDelta.nonPassCounts do not reconcile with records`);
  reconcileMetric(data.summary?.fields, { total: fieldIndex.length, passed: passedFields, failed: failedFields, blocked: blockedFields }, `scenario ${id}.data.summary.fields`);
  reconcileMetric(data.summary?.frames, { total: passedSamples + failedSamples + blockedSamples, passed: passedSamples, failed: failedSamples, blocked: blockedSamples, uniqueTicks: canonicalTicks?.length ?? 0 }, `scenario ${id}.data.summary.frames`);
  if (data.trust?.status === "pass" && blockedFields > 0) fail(`scenario ${id}.data.trust must be blocked when a field is blocked`);
  if (telemetryComparable) validateTelemetryAggregate({ data, baselineFailed, candidateFailed, telemetryTotals, candidateStateHash: candidateStateHash.digest("hex"), baselineStateHash: baselineStateHash.digest("hex"), failedSamples, id });
  const frameDeviationRatios = nonPassCounts.map((value, index) => activeCounts[index] ? value / activeCounts[index] : 0);
  return {
    fieldIndex: indexes,
    frameDeltaMetrics: { frameDeviationRatios, firstFailingFrame: nonPassCounts.findIndex((value) => value > 0) },
  };
}

function validateScenarioEnvelope(data, id, catalogEntry, bundlePublishedAt) {
  if (!plainObject(data)) fail(`scenario ${id}.data must be an object`);
  if (Object.hasOwn(data, "fields")) fail(`scenario ${id}.data.fields must be absent from the compact envelope`);
  if (data.telemetry?.status === "comparable" && Object.hasOwn(data.telemetry, "fields")) fail(`scenario ${id}.data.telemetry.fields must be absent from the compact envelope`);
  if (data.schema !== DIFFERENTIAL_TESTING_DATA_SCHEMA) fail(`scenario ${id}.data.schema must equal ${DIFFERENTIAL_TESTING_DATA_SCHEMA}`);
  if (data.publishedAt !== bundlePublishedAt) fail(`scenario ${id}.data.publishedAt must equal the bundle publishedAt`);
  const catalog = validateScenarioCatalog(data.scenarioCatalog, `scenario ${id}.data.scenarioCatalog`);
  if (catalog.selectedScenarioId !== id || catalog.scenarios.length !== 1 || canonicalJson(catalog.scenarios[0]) !== canonicalJson(catalogEntry)) fail(`scenario ${id} must carry exactly its matching catalog entry`);
  if (!plainObject(data.summary)) fail(`scenario ${id}.data.summary must be an object`);
  validateMetricShape(data.summary.fields, `scenario ${id}.data.summary.fields`, false);
  validateMetricShape(data.summary.frames, `scenario ${id}.data.summary.frames`, true);
  const standIn = structuredClone(data);
  delete standIn.telemetry;
  standIn.fields = [];
  standIn.summary.fields = zeroMetric(standIn.summary.fields);
  standIn.summary.frames = { ...zeroMetric(standIn.summary.frames), uniqueTicks: 0 };
  assertDifferentialTestingData(standIn);
  validateTelemetryEnvelope(data.telemetry, id);
  if (data.telemetry?.status === "comparable" && data.trust?.status !== "pass") fail(`scenario ${id}.data.trust must pass when telemetry is comparable`);
}

function validateFrameDeltaShape(value, label) {
  assertOnlyKeys(value, new Set(["ticks", "activeCounts", "nonPassCounts"]), label);
  for (const key of ["ticks", "activeCounts", "nonPassCounts"]) if (!Array.isArray(value[key])) fail(`${label}.${key} must be an array`);
  if (value.ticks.length !== value.activeCounts.length || value.ticks.length !== value.nonPassCounts.length) fail(`${label} arrays must have equal lengths`);
  let previous = -Infinity;
  value.ticks.forEach((tick, index) => {
    finite(tick, `${label}.ticks[${index}]`);
    if (tick <= previous) fail(`${label}.ticks must increase strictly`);
    previous = tick;
    count(value.activeCounts[index], `${label}.activeCounts[${index}]`);
    count(value.nonPassCounts[index], `${label}.nonPassCounts[${index}]`);
    if (value.nonPassCounts[index] > value.activeCounts[index]) fail(`${label}.nonPassCounts[${index}] must not exceed activeCounts`);
  });
  return value;
}

function validateField(field, label) {
  assertOnlyKeys(field, FIELD_KEYS, label);
  text(field.id, `${label}.id`, 160);
  text(field.label, `${label}.label`, 160);
  text(field.sourceOwner, `${label}.sourceOwner`, 500);
  if (!plainObject(field.semantics)) fail(`${label}.semantics must be an object`);
  text(field.semantics.meaning, `${label}.semantics.meaning`, 2000);
  if (field.unit !== null) text(field.unit, `${label}.unit`, 80);
  finiteNonNegative(field.tolerance, `${label}.tolerance`);
  if (!new Set(["pass", "blocked"]).has(field.trustStatus)) fail(`${label}.trustStatus must be pass or blocked`);
  if (field.driftClass !== null) text(field.driftClass, `${label}.driftClass`, 120);
  if (field.driftReason !== null) text(field.driftReason, `${label}.driftReason`, 2000);
  count(field.sampleCount, `${label}.sampleCount`);
  count(field.failedSampleCount, `${label}.failedSampleCount`);
  count(field.missingSampleCount, `${label}.missingSampleCount`);
  if (field.firstFailingTick !== null) finite(field.firstFailingTick, `${label}.firstFailingTick`);
  if (field.maxDelta !== null) finiteNonNegative(field.maxDelta, `${label}.maxDelta`);
  if (!Array.isArray(field.samples) || field.samples.length !== field.sampleCount) fail(`${label}.samples must match sampleCount`);
  const ticks = [];
  const states = [];
  let previous = -Infinity;
  let failed = 0;
  let missing = 0;
  let first = null;
  let maxDelta = null;
  for (const [index, sample] of field.samples.entries()) {
    if (!Array.isArray(sample) || sample.length !== 4) fail(`${label}.samples[${index}] must be [tick, reference, candidate, state]`);
    const [tick, reference, candidate, state] = sample;
    finite(tick, `${label}.samples[${index}][0]`);
    if (tick <= previous) fail(`${label}.samples ticks must increase strictly`);
    previous = tick;
    if (!scalar(reference) || !scalar(candidate)) fail(`${label}.samples[${index}] values must be JSON scalars or null`);
    if (![0, 1, 2, 3, 4].includes(state)) fail(`${label}.samples[${index}] state must be 0 through 4`);
    if ([2, 4].includes(state) && reference !== null) fail(`${label}.samples[${index}] missing reference must be null`);
    if ([3, 4].includes(state) && candidate !== null) fail(`${label}.samples[${index}] missing candidate must be null`);
    if (state <= 1) {
      const matches = valuesMatch(reference, candidate, field.tolerance);
      if (matches !== (state === 0)) fail(`${label}.samples[${index}] state disagrees with values and tolerance`);
      maxDelta = Math.max(maxDelta ?? 0, valueDelta(reference, candidate));
    }
    if (state === 1) failed += 1;
    if (state >= 2) missing += 1;
    if (state !== 0 && first === null) first = tick;
    ticks.push(tick);
    states.push(state);
  }
  if (field.failedSampleCount !== failed || field.missingSampleCount !== missing || field.firstFailingTick !== first || !nearlyEqual(field.maxDelta, maxDelta)) fail(`${label} summary does not reconcile with samples`);
  if (missing > 0 && field.trustStatus !== "blocked") fail(`${label}.trustStatus must be blocked for missing samples`);
  return { ticks, states, failed, missing, passed: field.samples.length - failed - missing, blocked: field.trustStatus === "blocked" || missing > 0 };
}

function validateTelemetryField(entry, field, label) {
  assertOnlyKeys(entry, TELEMETRY_FIELD_KEYS, label);
  if (entry.id !== field.id) fail(`${label}.id must equal the primary field id`);
  for (const key of ["baselineFailedSampleCount", "candidateFailedSampleCount", "failToPassCount", "passToFailCount", "stayedPassCount", "stayedFailCount"]) count(entry[key], `${label}.${key}`);
  for (const key of ["netFailedSampleDelta", "residualCount"]) integer(entry[key], `${label}.${key}`);
  if (entry.reconciliation !== "reconciled" || entry.residualCount !== 0) fail(`${label} must be reconciled with zero residual`);
  if (entry.candidateFailedSampleCount !== field.failedSampleCount) fail(`${label}.candidateFailedSampleCount must equal the primary field`);
  if (entry.netFailedSampleDelta !== entry.candidateFailedSampleCount - entry.baselineFailedSampleCount || entry.netFailedSampleDelta !== entry.passToFailCount - entry.failToPassCount) fail(`${label}.netFailedSampleDelta does not reconcile`);
  if (entry.stayedFailCount !== entry.baselineFailedSampleCount - entry.failToPassCount || entry.stayedFailCount !== entry.candidateFailedSampleCount - entry.passToFailCount) fail(`${label}.stayedFailCount does not reconcile`);
  if (entry.failToPassCount + entry.passToFailCount + entry.stayedPassCount + entry.stayedFailCount !== field.sampleCount) fail(`${label} transition classes do not partition samples`);
  if (!Array.isArray(entry.baselineStates) || entry.baselineStates.length !== field.sampleCount) fail(`${label}.baselineStates must align with samples`);
  const expected = [];
  field.samples.forEach((sample, index) => {
    const before = entry.baselineStates[index];
    if (![0, 1].includes(before) || ![0, 1].includes(sample[3])) fail(`${label} comparable states must be 0 or 1`);
    if (before !== sample[3]) expected.push([sample[0], before, sample[3]]);
  });
  if (!Array.isArray(entry.transitions) || canonicalJson(entry.transitions) !== canonicalJson(expected)) fail(`${label}.transitions do not match baselineStates and primary states`);
  const failToPass = expected.filter(([, before, after]) => before === 1 && after === 0).length;
  if (entry.failToPassCount !== failToPass || entry.passToFailCount !== expected.length - failToPass) fail(`${label} transition counts do not reconcile`);
  return { baselineStates: entry.baselineStates };
}

function validateTelemetryEnvelope(telemetry, id) {
  if (telemetry === undefined) return;
  if (!plainObject(telemetry)) fail(`scenario ${id}.data.telemetry must be an object`);
  assertOnlyKeys(telemetry, new Set(["status", "authority", "blockers", "comparison", "baseline", "candidate", "summary"]), `scenario ${id}.data.telemetry`);
  if (!new Set(["comparable", "blocked"]).has(telemetry.status)) fail(`scenario ${id}.data.telemetry.status is invalid`);
  if (telemetry.authority !== "telemetry-only") fail(`scenario ${id}.data.telemetry.authority must equal telemetry-only`);
  if (!Array.isArray(telemetry.blockers)) fail(`scenario ${id}.data.telemetry.blockers must be an array`);
  telemetry.blockers.forEach((blocker, index) => text(blocker, `scenario ${id}.data.telemetry.blockers[${index}]`, 1000));
  if (telemetry.status === "blocked") {
    if (telemetry.blockers.length === 0 || Object.hasOwn(telemetry, "summary")) fail(`scenario ${id} blocked telemetry must name blockers and omit claims`);
    if (Object.hasOwn(telemetry, "comparison")) validateTelemetryComparison(telemetry.comparison, id);
    if (Object.hasOwn(telemetry, "baseline")) validateTelemetryArtifact(telemetry.baseline, `scenario ${id}.data.telemetry.baseline`, false);
    if (Object.hasOwn(telemetry, "candidate")) validateTelemetryArtifact(telemetry.candidate, `scenario ${id}.data.telemetry.candidate`, false);
    return;
  }
  if (telemetry.blockers.length > 0) fail(`scenario ${id} comparable telemetry blockers must be empty`);
  validateTelemetryComparison(telemetry.comparison, id);
  for (const side of ["baseline", "candidate"]) {
    const artifact = telemetry[side];
    validateTelemetryArtifact(artifact, `scenario ${id}.data.telemetry.${side}`, true);
  }
  if (telemetry.baseline.contractSha256 !== telemetry.candidate.contractSha256) fail(`scenario ${id} telemetry contracts differ`);
  const summary = telemetry.summary;
  assertOnlyKeys(summary, new Set(["failToPassCount", "passToFailCount", "stayedPassCount", "stayedFailCount", "netFailedSampleDelta", "residualCount", "reconciliation"]), `scenario ${id}.data.telemetry.summary`);
  for (const key of ["failToPassCount", "passToFailCount", "stayedPassCount", "stayedFailCount"]) count(summary[key], `scenario ${id}.data.telemetry.summary.${key}`);
  for (const key of ["netFailedSampleDelta", "residualCount"]) integer(summary[key], `scenario ${id}.data.telemetry.summary.${key}`);
  if (summary.reconciliation !== "reconciled" || summary.residualCount !== 0 || summary.netFailedSampleDelta !== summary.passToFailCount - summary.failToPassCount) fail(`scenario ${id}.data.telemetry.summary is not reconciled`);
}

function validateTelemetryComparison(value, id) {
  const label = `scenario ${id}.data.telemetry.comparison`;
  assertOnlyKeys(value, new Set(["referenceId", "referenceSha256", "scenarioId", "alignmentKey"]), label);
  text(value.referenceId, `${label}.referenceId`, 160);
  digest(value.referenceSha256, `${label}.referenceSha256`);
  if (value.scenarioId !== id) fail(`${label}.scenarioId must equal ${id}`);
  text(value.alignmentKey, `${label}.alignmentKey`, 160);
}

function validateTelemetryArtifact(value, label, requirePass) {
  assertOnlyKeys(value, new Set(["id", "generatedAt", "artifactSha256", "contractSha256", "failedSampleCount", "check", "stateVectorSha256", "stateVectorCheck"]), label);
  text(value.id, `${label}.id`, 160);
  timestamp(value.generatedAt, `${label}.generatedAt`);
  for (const key of ["artifactSha256", "contractSha256", "stateVectorSha256"]) digest(value[key], `${label}.${key}`);
  count(value.failedSampleCount, `${label}.failedSampleCount`);
  assertOnlyKeys(value.check, new Set(["status", "id", "sha256", "subjectSha256"]), `${label}.check`);
  if (!new Set(["pass", "fail", "missing"]).has(value.check.status)) fail(`${label}.check.status is invalid`);
  text(value.check.id, `${label}.check.id`, 160);
  digest(value.check.sha256, `${label}.check.sha256`);
  digest(value.check.subjectSha256, `${label}.check.subjectSha256`);
  if (value.check.subjectSha256 !== value.artifactSha256 || (requirePass && value.check.status !== "pass")) fail(`${label}.check must attest the artifact${requirePass ? " and pass" : ""}`);
  assertOnlyKeys(value.stateVectorCheck, new Set(["status", "id", "sha256", "subjectSha256", "artifactSha256"]), `${label}.stateVectorCheck`);
  if (!new Set(["pass", "fail", "missing"]).has(value.stateVectorCheck.status)) fail(`${label}.stateVectorCheck.status is invalid`);
  text(value.stateVectorCheck.id, `${label}.stateVectorCheck.id`, 160);
  for (const key of ["sha256", "subjectSha256", "artifactSha256"]) digest(value.stateVectorCheck[key], `${label}.stateVectorCheck.${key}`);
  if (value.stateVectorCheck.subjectSha256 !== value.stateVectorSha256 || value.stateVectorCheck.artifactSha256 !== value.artifactSha256 || (requirePass && value.stateVectorCheck.status !== "pass")) fail(`${label}.stateVectorCheck must attest the state vector${requirePass ? " and pass" : ""}`);
}

function validateTelemetryAggregate({ data, baselineFailed, candidateFailed, telemetryTotals, candidateStateHash, baselineStateHash, failedSamples, id }) {
  const telemetry = data.telemetry;
  if (telemetry.baseline.failedSampleCount !== baselineFailed || telemetry.candidate.failedSampleCount !== candidateFailed || candidateFailed !== failedSamples) fail(`scenario ${id} telemetry failed-sample totals do not reconcile`);
  if (telemetry.baseline.stateVectorSha256 !== baselineStateHash || telemetry.candidate.stateVectorSha256 !== candidateStateHash) fail(`scenario ${id} telemetry state-vector digest does not reconcile`);
  for (const key of Object.keys(telemetryTotals)) if (telemetry.summary?.[key] !== telemetryTotals[key]) fail(`scenario ${id}.data.telemetry.summary.${key} does not reconcile with fields`);
  if (telemetry.summary.netFailedSampleDelta !== candidateFailed - baselineFailed) fail(`scenario ${id} telemetry aggregate delta does not reconcile`);
}

function readBoundRecord(path, scenarioIdValue, indexEntry) {
  const { offset, size, sha256: expectedSha } = indexEntry.record;
  const descriptor = openSync(path, "r");
  try {
    const bytes = Buffer.allocUnsafe(size + 1);
    const read = readSync(descriptor, bytes, 0, bytes.length, offset);
    if (read !== bytes.length || bytes[size] !== 0x0a) fail(`field record ${indexEntry.id} is not exactly LF terminated`);
    const jsonBytes = bytes.subarray(0, size);
    if (sha256(jsonBytes) !== expectedSha) fail(`field record ${indexEntry.id} SHA-256 changed`);
    const record = parseJson(jsonBytes, `field record ${indexEntry.id}`);
    assertOnlyKeys(record, new Set(["schema", "scenarioId", "id", "ordinal", "field", "telemetry"]), `field record ${indexEntry.id}`);
    if (record.schema !== DIFFERENTIAL_TESTING_FIELD_RECORD_SCHEMA || record.scenarioId !== scenarioIdValue || record.id !== indexEntry.id || record.ordinal !== indexEntry.ordinal || record.field?.id !== record.id || (record.telemetry && record.telemetry.id !== record.id)) fail(`field record ${indexEntry.id} identity changed`);
    return record;
  } finally {
    closeSync(descriptor);
  }
}

function validateScenarioCatalog(value, label) {
  assertOnlyKeys(value, new Set(["selectedScenarioId", "scenarios"]), label);
  if (!Array.isArray(value.scenarios)) fail(`${label}.scenarios must be an array`);
  if (value.scenarios.length === 0) {
    if (value.selectedScenarioId !== null) fail(`${label}.selectedScenarioId must be null when empty`);
    return value;
  }
  scenarioId(value.selectedScenarioId, `${label}.selectedScenarioId`);
  const ids = new Set();
  for (const [index, entry] of value.scenarios.entries()) {
    const entryLabel = `${label}.scenarios[${index}]`;
    assertOnlyKeys(entry, new Set(["id", "label", "engine", "frameCount", "replaySha256", "profileSha256", "contractSha256", "updatedAt"]), entryLabel);
    scenarioId(entry.id, `${entryLabel}.id`);
    if (ids.has(entry.id)) fail(`${entryLabel}.id is duplicated`);
    ids.add(entry.id);
    text(entry.label, `${entryLabel}.label`, 160);
    if (entry.engine !== undefined) validateScenarioEngine(entry.engine, `${entryLabel}.engine`);
    positiveCount(entry.frameCount, `${entryLabel}.frameCount`);
    for (const key of ["replaySha256", "profileSha256", "contractSha256"]) digest(entry[key], `${entryLabel}.${key}`);
    timestamp(entry.updatedAt, `${entryLabel}.updatedAt`);
  }
  if (!ids.has(value.selectedScenarioId)) fail(`${label}.selectedScenarioId is not in the catalog`);
  return value;
}

function validateScenarioEngine(value, label) {
  assertOnlyKeys(value, new Set(["id", "runtimeRoot"]), label);
  text(value.id, `${label}.id`, 80);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(value.id)) fail(`${label}.id is invalid`);
  text(value.runtimeRoot, `${label}.runtimeRoot`, 400);
  if (value.runtimeRoot === ".") return;
  const parts = value.runtimeRoot.split("/");
  if (value.runtimeRoot.startsWith("/") || value.runtimeRoot.includes("\\")
    || parts.some((part) => !part || part === "." || part === "..")) {
    fail(`${label}.runtimeRoot must be a contained relative path`);
  }
}

function reconcileMetric(actual, expected, label) {
  if (!plainObject(actual)) fail(`${label} must be a metric`);
  for (const [key, value] of Object.entries(expected)) if (actual[key] !== value) fail(`${label}.${key} does not reconcile; expected ${value}`);
}

function validateMetricShape(value, label, uniqueTicks) {
  assertOnlyKeys(value, new Set(["label", "total", "passed", "failed", "blocked", "status", ...(uniqueTicks ? ["uniqueTicks"] : [])]), label);
  text(value.label, `${label}.label`, 80);
  for (const key of ["total", "passed", "failed", "blocked"]) count(value[key], `${label}.${key}`);
  if (value.total !== value.passed + value.failed + value.blocked) fail(`${label}.total must equal its partition`);
  if (uniqueTicks) count(value.uniqueTicks, `${label}.uniqueTicks`);
}

function zeroMetric(metric) {
  return { label: metric?.label || "Metric", total: 0, passed: 0, failed: 0, blocked: 0 };
}

function omit(value, ...keys) {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

function nonPass(field) { return Number(field.failedSampleCount || 0) + Number(field.missingSampleCount || 0); }
function telemetryChange(value) { return value ? Number(value.failToPassCount || 0) + Number(value.passToFailCount || 0) : 0; }
function telemetryImprovement(value) { return value ? Number(value.failToPassCount || 0) - Number(value.passToFailCount || 0) : 0; }

function regularContainedFile(path, root, label) {
  const target = resolve(path);
  const rootPath = realpathSync(resolve(root));
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  const realTarget = realpathSync(target);
  const targetRelative = relative(rootPath, realTarget);
  if (!targetRelative || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
    if (realTarget !== rootPath) fail(`${label} escapes its published generation`);
  }
  return realTarget;
}

function resolveRelative(root, path, label) {
  if (typeof path !== "string" || !path || isAbsolute(path)) fail(`${label} path must be relative`);
  const target = resolve(root, path);
  if (target !== resolve(root) && !target.startsWith(`${resolve(root)}${sep}`)) fail(`${label} path escapes its published generation`);
  return target;
}

function readBoundedFile(path, limit, label) {
  const size = statSync(path).size;
  if (size > limit) fail(`${label} exceeds ${limit} bytes`, 413);
  return readFileSync(path);
}

function hashFile(path) {
  const descriptor = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let offset = 0;
    for (;;) {
      const amount = readSync(descriptor, buffer, 0, buffer.length, offset);
      if (!amount) break;
      hash.update(buffer.subarray(0, amount));
      offset += amount;
    }
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

export function differentialTestingRecordsSignature(path) {
  const stat = statSync(path);
  return `${stat.dev}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`;
}

function parseJson(bytes, label) {
  try { return JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes)); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`); }
}

function assertOnlyKeys(value, allowed, label) {
  if (!plainObject(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}.${key} is not supported`);
}

function scenarioId(value, label) {
  if (typeof value !== "string" || !SCENARIO_ID.test(value)) fail(`${label} must be a lowercase 16-character hexadecimal id`);
  return value;
}
function digest(value, label) { if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a lowercase SHA-256 digest`); }
function count(value, label) { if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`); }
function positiveCount(value, label) { count(value, label); if (value === 0) fail(`${label} must be greater than zero`); }
function integer(value, label) { if (!Number.isSafeInteger(value)) fail(`${label} must be a safe integer`); }
function finite(value, label) { if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`); }
function finiteNonNegative(value, label) { finite(value, label); if (value < 0) fail(`${label} must not be negative`); }
function timestamp(value, label) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`${label} must be a parseable timestamp`); }
function text(value, label, max) { if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} must be a non-empty string of at most ${max} characters`); }
function scalar(value) { return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)); }
function plainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sameArray(left, right) { return left.length === right.length && left.every((value, index) => Object.is(value, right[index])); }
function nearlyEqual(left, right) { return left === right || (typeof left === "number" && typeof right === "number" && Math.abs(left - right) <= Math.max(1e-12, Math.abs(right) * 1e-12)); }
function valuesMatch(left, right, tolerance) {
  if (typeof left !== "number" || typeof right !== "number") return Object.is(left, right);
  const delta = Math.abs(left - right);
  if (delta <= tolerance) return true;
  if (tolerance === 0) return false;
  return delta - tolerance <= Number.EPSILON * Math.max(Math.abs(left), Math.abs(right), Math.abs(tolerance), Number.MIN_VALUE) * 4;
}
function valueDelta(left, right) { return typeof left === "number" && typeof right === "number" ? Math.abs(left - right) : Object.is(left, right) ? 0 : 1; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fail(message, status = 422) { throw new DifferentialTestingTransportError(message, status); }
