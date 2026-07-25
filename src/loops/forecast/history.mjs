import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { containedJoin, withRepoStateLock } from "../../server/repo-state.mjs";
import { writeAtomicText } from "../../cli/local-exclude.mjs";

const SCHEMA = "burnlist-loop-forecast-history@1";
const MAX_OBSERVATIONS = 256;
const MAX_BYTES = 256 * 1024;
const BANDS = new Set(["low", "medium", "high"]);
const safe = (value, maximum = 128) => typeof value === "string" && value.length > 0
  && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
const optional = (value, maximum) => value === null || safe(value, maximum);
const measurement = (value) => value === null
  || Number.isSafeInteger(value) && value >= 0;
const historyPath = (repoRoot) => containedJoin(repoRoot, "loop-forecast-history.json");

function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key, index) => Object.keys(value)[index] === key);
}
function validate(value) {
  const keys = ["id", "role", "provider", "model", "effort", "complexityBand",
    "completedAt", "wallMilliseconds", "workMilliseconds", "inputTokens",
    "outputTokens", "parallelObserved", "provenance"];
  if (!exact(value, keys) || !/^fo1-sha256:[a-f0-9]{64}$/u.test(value.id)
    || !safe(value.role, 64) || !optional(value.provider, 64)
    || !optional(value.model, 128) || !optional(value.effort, 32)
    || !BANDS.has(value.complexityBand) || !Number.isSafeInteger(value.completedAt)
    || value.completedAt < 0 || !measurement(value.wallMilliseconds)
    || !measurement(value.workMilliseconds) || !measurement(value.inputTokens)
    || !measurement(value.outputTokens) || typeof value.parallelObserved !== "boolean"
    || !Array.isArray(value.provenance) || value.provenance.length < 1
    || value.provenance.length > 4 || value.provenance.some((entry) => !safe(entry, 32)))
    throw new Error("Loop forecast observation is invalid.");
  return value;
}
function empty() { return { schema: SCHEMA, observations: [] }; }
export function readForecastHistory(repoRoot) {
  const path = historyPath(repoRoot);
  if (!existsSync(path)) return empty();
  const bytes = readFileSync(path);
  if (bytes.length < 2 || bytes.length > MAX_BYTES) throw new Error("Loop forecast history exceeds bounds.");
  let value;
  try { value = JSON.parse(bytes); } catch { throw new Error("Loop forecast history is malformed."); }
  if (!exact(value, ["schema", "observations"]) || value.schema !== SCHEMA
    || !Array.isArray(value.observations) || value.observations.length > MAX_OBSERVATIONS)
    throw new Error("Loop forecast history is invalid.");
  value.observations.forEach(validate);
  if (!Buffer.from(`${JSON.stringify(value)}\n`).equals(bytes))
    throw new Error("Loop forecast history is not canonical.");
  return value;
}
export function forecastObservationId(value) {
  const identity = [value.correlation, value.completedAt].join("\0");
  return `fo1-sha256:${createHash("sha256").update(identity).digest("hex")}`;
}
export function appendForecastObservation(repoRoot, input) {
  const observation = validate({
    id: input.id ?? forecastObservationId(input),
    role: input.role,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    complexityBand: input.complexityBand,
    completedAt: input.completedAt,
    wallMilliseconds: input.wallMilliseconds,
    workMilliseconds: input.workMilliseconds,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    parallelObserved: input.parallelObserved,
    provenance: input.provenance,
  });
  return withRepoStateLock(repoRoot, () => {
    const history = readForecastHistory(repoRoot);
    const prior = history.observations.find((entry) => entry.id === observation.id);
    if (prior) return { observation: prior, created: false };
    const observations = [...history.observations, observation].slice(-MAX_OBSERVATIONS);
    const value = { schema: SCHEMA, observations };
    const text = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Loop forecast history exceeds bounds.");
    writeAtomicText(historyPath(repoRoot), text);
    return { observation, created: true };
  });
}

export const FORECAST_HISTORY_LIMIT = MAX_OBSERVATIONS;
