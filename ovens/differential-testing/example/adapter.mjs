#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertDifferentialTestingData, DIFFERENTIAL_TESTING_DATA_SCHEMA } from "../data-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const referencePath = resolve(process.argv[2] ?? resolve(here, "reference.json"));
  const candidatePath = resolve(process.argv[3] ?? resolve(here, "candidate.json"));
  const outputPath = resolve(process.argv[4] ?? resolve(process.cwd(), "differential-testing.example.json"));
  const reference = JSON.parse(readFileSync(referencePath, "utf8"));
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  const payload = buildPayload(reference, candidate, { referencePath, candidatePath });
  assertDifferentialTestingData(payload);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporaryPath, outputPath);
  console.log(outputPath);
}

export function buildPayload(referenceCapture, candidateCapture, provenance = {}) {
  assertCapture(referenceCapture, "reference");
  assertCapture(candidateCapture, "candidate", { fieldsRequired: false });
  const referenceByTick = indexedSamples(referenceCapture.samples, "reference");
  const candidateByTick = indexedSamples(candidateCapture.samples, "candidate");
  const ticks = [...referenceByTick.keys()];
  if (ticks.length !== candidateByTick.size || ticks.some((tick) => !candidateByTick.has(tick))) {
    throw new Error("Reference and candidate tick identities differ.");
  }

  const fields = referenceCapture.fields.map((definition) => {
    const samples = ticks.map((tick) => {
      const referenceValues = referenceByTick.get(tick).values;
      const candidateValues = candidateByTick.get(tick).values;
      const referencePresent = Object.hasOwn(referenceValues, definition.id);
      const candidatePresent = Object.hasOwn(candidateValues, definition.id);
      const referenceValue = referencePresent ? referenceValues[definition.id] : null;
      const candidateValue = candidatePresent ? candidateValues[definition.id] : null;
      let state = 0;
      if (!referencePresent && !candidatePresent) state = 4;
      else if (!referencePresent) state = 2;
      else if (!candidatePresent) state = 3;
      else if (!matches(referenceValue, candidateValue, definition.tolerance)) state = 1;
      return [tick, referenceValue, candidateValue, state];
    });
    const failedSampleCount = samples.filter((sample) => sample[3] === 1).length;
    const missingSampleCount = samples.filter((sample) => sample[3] >= 2).length;
    const firstNonPass = samples.find((sample) => sample[3] !== 0)?.[0] ?? null;
    const deltas = samples.filter((sample) => sample[3] <= 1).map((sample) => delta(sample[1], sample[2]));
    return {
      id: definition.id,
      label: definition.label,
      sourceOwner: definition.sourceOwner,
      semantics: { meaning: definition.meaning },
      unit: definition.unit,
      tolerance: definition.tolerance,
      trustStatus: missingSampleCount ? "blocked" : "pass",
      driftClass: missingSampleCount ? "missing" : failedSampleCount ? "mismatch" : "pass",
      driftReason: missingSampleCount ? "One or more aligned samples are unavailable." : failedSampleCount ? "One or more values exceed tolerance." : "All aligned values match.",
      sampleCount: samples.length,
      failedSampleCount,
      missingSampleCount,
      firstFailingTick: firstNonPass,
      maxDelta: deltas.length ? Math.max(...deltas) : null,
      samples,
    };
  });

  const blocked = fields.some((field) => field.trustStatus === "blocked");
  const fieldSummary = partitionFields(fields);
  const frameSummary = partitionSamples(fields);
  const hasComparison = fields.length > 0;
  const result = hasComparison ? (blocked ? "blocked" : frameSummary.failed ? "unchanged" : "pass") : null;
  const failureValue = frameSummary.failed + frameSummary.blocked;
  const timestamp = candidateCapture.generatedAt;
  const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
  const scenarioId = digest(referenceCapture.captureId).slice(0, 16);
  const replaySha256 = digest(referenceCapture);
  const profileSha256 = digest("differential-testing-example-profile");
  const contractSha256 = digest(referenceCapture.fields);
  const artifactSha256 = digest(candidateCapture);
  const runtimeTreeSha256 = digest(candidateCapture.samples);
  const refreshId = `refresh-${artifactSha256.slice(0, 16)}`;
  const rowBinding = { refreshId, scenarioId, reportSha256: artifactSha256, runtimeTreeSha256, contractSha256 };
  return {
    schema: DIFFERENTIAL_TESTING_DATA_SCHEMA,
    publishedAt: timestamp,
    title: "Differential Testing example",
    subtitle: `${referenceCapture.captureId} / ${candidateCapture.captureId}`,
    adapter: { id: "differential-testing-example", ...provenance },
    trust: { status: blocked ? "blocked" : "pass", reportStatus: result, blockers: blocked ? ["At least one aligned sample is missing."] : [] },
    scenarioCatalog: hasComparison ? {
      selectedScenarioId: scenarioId,
      scenarios: [{
        id: scenarioId,
        label: referenceCapture.captureId,
        frameCount: Math.max(1, ticks.length),
        replaySha256,
        profileSha256,
        contractSha256,
        updatedAt: timestamp,
      }],
    } : { selectedScenarioId: null, scenarios: [] },
    refresh: hasComparison ? {
      id: refreshId,
      status: "complete",
      scenarioId,
      event: { kind: "comparison-published", revision: artifactSha256, occurredAt: timestamp },
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      error: null,
      report: {
        id: candidateCapture.captureId,
        generatedAt: timestamp,
        artifactSha256,
        runtimeTreeSha256,
        contractSha256,
        scenarioId,
        frameCount: Math.max(1, ticks.length),
        replaySha256,
        profileSha256,
        result,
        check: { status: "pass", id: "differential-testing-example-check@1", sha256: digest(`check:${artifactSha256}`), subjectSha256: artifactSha256 },
      },
    } : null,
    summary: {
      runs: { label: "Runs", total: hasComparison ? 1 : 0, passed: result === "pass" ? 1 : 0, failed: result !== null && result !== "pass" && result !== "blocked" ? 1 : 0, blocked: result === "blocked" ? 1 : 0 },
      fields: { label: "Fields", ...fieldSummary },
      frames: { label: "Samples", ...frameSummary, uniqueTicks: hasComparison ? ticks.length : 0 },
    },
    progress: hasComparison ? [{ timestamp, result, value: failureValue, fieldCount: fields.length, failedFieldCount: fieldSummary.failed, frames: ticks.length, ...rowBinding }] : [],
    log: hasComparison ? [{ timestamp, result, value: failureValue, delta: null, failedFieldCount: fieldSummary.failed, firstFailingTick: fields.map((field) => field.firstFailingTick).filter((tick) => tick !== null).sort((a, b) => a - b)[0] ?? null, firstFailingLabel: fields.find((field) => field.firstFailingTick !== null)?.label ?? null, ...rowBinding }] : [],
    fields,
  };
}

function assertCapture(capture, label, { fieldsRequired = true } = {}) {
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) throw new Error(`${label} capture must be an object.`);
  if (!capture.captureId || !Number.isFinite(Date.parse(capture.generatedAt))) throw new Error(`${label} capture provenance is incomplete.`);
  if (!Array.isArray(capture.samples)) throw new Error(`${label} samples must be an array.`);
  if (fieldsRequired && !Array.isArray(capture.fields)) throw new Error(`${label} fields must be an array.`);
}

function indexedSamples(samples, label) {
  const indexed = new Map();
  for (const sample of samples) {
    if (!Number.isFinite(sample?.tick) || !sample.values || typeof sample.values !== "object" || Array.isArray(sample.values)) throw new Error(`${label} contains a malformed sample.`);
    if (indexed.has(sample.tick)) throw new Error(`${label} repeats tick ${sample.tick}.`);
    indexed.set(sample.tick, sample);
  }
  return indexed;
}

function matches(left, right, tolerance) {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= tolerance;
  return Object.is(left, right);
}

function delta(left, right) {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right);
  return Object.is(left, right) ? 0 : 1;
}

function partitionFields(fields) {
  const blocked = fields.filter((field) => field.trustStatus === "blocked").length;
  const failed = fields.filter((field) => field.trustStatus !== "blocked" && field.failedSampleCount > 0).length;
  return { total: fields.length, passed: fields.length - failed - blocked, failed, blocked };
}

function partitionSamples(fields) {
  const total = fields.reduce((sum, field) => sum + field.sampleCount, 0);
  const failed = fields.reduce((sum, field) => sum + field.failedSampleCount, 0);
  const blocked = fields.reduce((sum, field) => sum + field.missingSampleCount, 0);
  return { total, passed: total - failed - blocked, failed, blocked };
}
