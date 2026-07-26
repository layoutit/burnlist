import { createHash } from "node:crypto";
import { appendForecastObservation, readForecastHistory } from "./history.mjs";

const PRIOR = {
  low: { wall: [30_000, 300_000], work: [30_000, 300_000], tokens: [1_000, 12_000] },
  medium: { wall: [120_000, 900_000], work: [120_000, 900_000], tokens: [4_000, 32_000] },
  high: { wall: [300_000, 2_700_000], work: [300_000, 2_700_000], tokens: [10_000, 96_000] },
};
const safeKey = (value) => value === null || typeof value === "string";
const clamp = (value) => Math.max(0, Math.round(value));
const quantile = (sorted, ratio) => sorted[Math.min(sorted.length - 1,
  Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
const range = (samples, prior) => {
  if (!samples.length) return { low: prior[0], high: prior[1], sampleCount: 0 };
  const sorted = [...samples].sort((left, right) => left - right);
  if (sorted.length === 1) return {
    low: clamp(Math.min(prior[0], sorted[0] * 0.7)),
    high: clamp(Math.max(prior[1], sorted[0] * 1.3)), sampleCount: 1,
  };
  const low = quantile(sorted, 0.1), high = quantile(sorted, 0.9);
  return {
    low: clamp(low * 0.8), high: clamp(Math.max(low, high) * 1.2),
    sampleCount: sorted.length,
  };
};
export function complexityBand(node) {
  return node?.intelligence === "fast" ? "low"
    : ["strong", "critical"].includes(node?.intelligence) ? "high" : "medium";
}
function sameKey(entry, key) {
  return entry.role === key.role && entry.provider === key.provider
    && entry.model === key.model && entry.effort === key.effort
    && entry.complexityBand === key.complexityBand;
}
export function forecastForKey(history, key) {
  if (!key || typeof key.role !== "string" || !safeKey(key.provider)
    || !safeKey(key.model) || !safeKey(key.effort) || !PRIOR[key.complexityBand])
    throw new Error("Loop forecast key is invalid.");
  const matching = history.observations.filter((entry) => sameKey(entry, key));
  const prior = PRIOR[key.complexityBand];
  const wallTime = range(matching.flatMap((entry) =>
    entry.wallMilliseconds === null ? [] : [entry.wallMilliseconds]), prior.wall);
  const aggregateWork = range(matching.flatMap((entry) =>
    entry.workMilliseconds === null ? [] : [entry.workMilliseconds]), prior.work);
  const totalTokens = range(matching.flatMap((entry) =>
    entry.inputTokens === null || entry.outputTokens === null
      ? [] : [entry.inputTokens + entry.outputTokens]), prior.tokens);
  const measured = Math.min(wallTime.sampleCount, aggregateWork.sampleCount);
  const confidence = measured >= 8 ? "high" : measured >= 3 ? "medium" : "low";
  return Object.freeze({
    schema: "burnlist-loop-forecast@1",
    key: Object.freeze({ ...key }),
    wallTime: Object.freeze({ ...wallTime, unit: "milliseconds" }),
    aggregateWork: Object.freeze({ ...aggregateWork, unit: "milliseconds" }),
    totalTokens: Object.freeze({ ...totalTokens, unit: "tokens" }),
    confidence,
    provenance: Object.freeze({
      kind: matching.length ? "local-observations" : "built-in-prior",
      matchingObservations: matching.length,
      tokenObservations: totalTokens.sampleCount,
      parallelObservations: matching.filter((entry) => entry.parallelObserved).length,
    }),
    cost: null,
    costProvenance: "unavailable",
  });
}
function latestFact(records, key) {
  return [...records].reverse().find((entry) => entry[key] !== null
    && entry[key] !== undefined)?.[key] ?? null;
}
export function forecastLoopRun({ repoRoot, replay, optionalRecords = [] }) {
  if (replay?.execution?.terminal || replay?.execution?.node?.kind !== "agent") return null;
  const node = replay.execution.node;
  const route = replay.agentRoutes?.find((entry) => entry.route === node.route) ?? null;
  const key = {
    role: node.role,
    provider: latestFact(optionalRecords, "provider") ?? route?.adapter ?? null,
    model: latestFact(optionalRecords, "model") ?? route?.model ?? null,
    effort: latestFact(optionalRecords, "effort") ?? route?.effort ?? null,
    complexityBand: complexityBand(node),
  };
  try { return forecastForKey(readForecastHistory(repoRoot), key); }
  catch { return forecastForKey({ observations: [] }, key); }
}
function activityCorrelation(runId, nodeId, attempt, invocationId) {
  return `ac1-sha256:${createHash("sha256")
    .update(`${runId}\0${nodeId}\0${attempt}\0${invocationId}`).digest("hex")}`;
}
function measurements(records, telemetry) {
  const starts = records.filter((entry) => entry.kind.endsWith("-started")).map((entry) => entry.at);
  const finishes = records.filter((entry) =>
    entry.kind.endsWith("-finished") || entry.kind.endsWith("-failed")).map((entry) => entry.at);
  const hookWall = starts.length && finishes.length
    ? Math.max(0, Math.max(...finishes) - Math.min(...starts)) : null;
  const hostWall = telemetry?.startedAt !== null && telemetry?.startedAt !== undefined
    && telemetry?.completedAt !== null && telemetry?.completedAt !== undefined
    ? telemetry.completedAt - telemetry.startedAt : null;
  const wallMilliseconds = hostWall ?? hookWall;
  const durations = records.flatMap((entry) =>
    Number.isSafeInteger(entry.durationMilliseconds) ? [entry.durationMilliseconds] : []);
  const summedWork = durations.reduce((sum, value) => sum + value, 0);
  const workMilliseconds = durations.length && Number.isSafeInteger(summedWork)
    ? summedWork : wallMilliseconds;
  const nativeTokenRecords = records.filter((entry) =>
    entry.inputTokens !== null && entry.outputTokens !== null);
  const nativeInputTokens = nativeTokenRecords.reduce((sum, entry) => sum + entry.inputTokens, 0);
  const nativeOutputTokens = nativeTokenRecords.reduce((sum, entry) => sum + entry.outputTokens, 0);
  return {
    wallMilliseconds, workMilliseconds,
    inputTokens: telemetry?.inputTokens
      ?? (nativeTokenRecords.length && Number.isSafeInteger(nativeInputTokens) ? nativeInputTokens : null),
    outputTokens: telemetry?.outputTokens
      ?? (nativeTokenRecords.length && Number.isSafeInteger(nativeOutputTokens) ? nativeOutputTokens : null),
    parallelObserved: wallMilliseconds !== null && workMilliseconds !== null
      && workMilliseconds > wallMilliseconds,
  };
}

/** Learn only after a core-accepted semantic report exists in the Run journal. */
export function recordAcceptedLoopObservation({
  repoRoot, replay, claimId, optionalRecords = [], completedAt = null,
}) {
  const accepted = replay.journal.find((record) =>
    record.value.type === "external-report-accepted"
    && record.value.payload.claimId === claimId);
  const bound = replay.journal.find((record) =>
    record.value.type === "external-claim-bound"
    && record.value.payload.claim.claimId === claimId);
  if (!accepted || !bound) return null;
  const claim = bound.value.payload.claim;
  const node = replay.graph.nodes.find((entry) => entry.id === claim.nodeId);
  if (node?.kind !== "agent") return null;
  const expected = activityCorrelation(replay.runId, claim.nodeId, claim.attempt,
    bound.value.payload.invocationId);
  const records = optionalRecords.filter((entry) => entry.correlation === expected);
  const telemetry = accepted.value.payload.telemetry;
  const measured = measurements(records, telemetry);
  if (measured.wallMilliseconds === null && measured.workMilliseconds === null
    && measured.inputTokens === null && measured.outputTokens === null) return null;
  const provider = telemetry?.provider ?? latestFact(records, "provider");
  const model = telemetry?.model ?? latestFact(records, "model");
  const effort = telemetry?.effort ?? latestFact(records, "effort");
  const provenance = ["semantic-completion",
    ...(telemetry ? ["host-telemetry"] : []),
    ...(records.length ? ["native-hooks"] : [])];
  return appendForecastObservation(repoRoot, {
    correlation: `${expected}\0${accepted.value.payload.reportDigest}`,
    role: node.role, provider, model, effort, complexityBand: complexityBand(node),
    completedAt: completedAt ?? accepted.value.at, ...measured, provenance,
  });
}
