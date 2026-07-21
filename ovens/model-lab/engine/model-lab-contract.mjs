export const MODEL_LAB_SCHEMA = "burnlist-model-lab-data@1";
export const MODEL_LAB_RUNTIME_SCHEMA = "polycss-model-lab-state@1";
export const MODEL_LAB_COMPARISON_SCHEMA = "burnlist-model-lab-comparison@1";

const SHA256 = /^[a-f0-9]{64}$/u;
const RUNTIME_CONSTRUCTION_KEYS = Object.freeze([
  "assetBuildCount",
  "geometryBuildCount",
  "materialBuildCount",
  "sourceParseCount",
  "topologyBuildCount",
]);

export function assertModelLabData(value, label = "Model Lab data") {
  if (!plainObject(value) || value.schema !== MODEL_LAB_SCHEMA) {
    throw new Error(`${label} must use ${MODEL_LAB_SCHEMA}.`);
  }
  timestamp(value.generatedAt, `${label}.generatedAt`);
  project(value.project, `${label}.project`);
  surface(value.surface, `${label}.surface`);
  model(value.model, `${label}.model`);
  evidence(value.evidence, `${label}.evidence`);
  if (value.comparison !== undefined) {
    comparison(value.comparison, value.model, `${label}.comparison`);
  }
  return value;
}

function project(value, label) {
  if (!plainObject(value)
      || !shortString(value.id, 80)
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.id)
      || !shortString(value.label, 120)) {
    throw new Error(`${label} must identify one project.`);
  }
}

function surface(value, label) {
  if (!plainObject(value) || !shortString(value.title, 160) || !shortString(value.url, 2048)) {
    throw new Error(`${label} must identify one live surface.`);
  }
  let parsed;
  try {
    parsed = new URL(value.url);
  } catch {
    throw new Error(`${label}.url must be an absolute URL.`);
  }
  const loopback = parsed.hostname === "127.0.0.1"
    || parsed.hostname === "localhost"
    || parsed.hostname === "[::1]";
  if (parsed.protocol !== "http:" || !loopback || parsed.username || parsed.password) {
    throw new Error(`${label}.url must be an unauthenticated loopback HTTP URL.`);
  }
}

function model(value, label) {
  if (!plainObject(value)
      || !shortString(value.id, 160)
      || !actor(value.actor, `${label}.actor`)
      || !animations(value.animations, value.frameCount, `${label}.animations`)
      || !shortString(value.frameId, 160)
      || !integer(value.frameIndex, 0)
      || !integer(value.frameCount, 1)
      || value.frameIndex >= value.frameCount
      || !integer(value.polygonCount, 1)
      || !integer(value.leafCount, 1)
      || value.leafTag !== "s"
      || value.topologyMode !== "stable-frame-set"
      || value.lodCount !== 1
      || !integer(value.droppedSourcePolygonCount, 0)
      || !SHA256.test(value.topologyHash ?? "")
      || !SHA256.test(value.frameSetHash ?? "")) {
    throw new Error(`${label} must bind one stable prepared <s> frameset with lodCount 1.`);
  }
  if (!plainObject(value.runtimeConstruction)
      || Object.keys(value.runtimeConstruction).sort().join("\n") !== [...RUNTIME_CONSTRUCTION_KEYS].sort().join("\n")
      || RUNTIME_CONSTRUCTION_KEYS.some((key) => value.runtimeConstruction[key] !== 0)) {
    throw new Error(`${label}.runtimeConstruction must contain only zero prepare-boundary counters.`);
  }
}

function actor(value, label) {
  if (!plainObject(value)
      || !shortString(value.id, 160)
      || !shortString(value.name, 160)
      || !shortString(value.country, 80)
      || !integer(value.shirtNumber, 1)
      || value.shirtNumber > 99
      || !["A", "B"].includes(value.sourceTeamSlot)) {
    throw new Error(`${label} must bind one prepared player identity.`);
  }
  return true;
}

function animations(value, frameCount, label) {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error(`${label} must bind the prepared frame-set animations.`);
  }
  let previousEnd = 0;
  for (const [index, animation] of value.entries()) {
    if (!plainObject(animation)
        || !/^mc-\d{3}$/u.test(animation.id ?? "")
        || !integer(animation.slotId, 0)
        || !shortString(animation.symbol, 80)
        || !integer(animation.firstFrameIndex, 0)
        || !shortString(animation.firstFrameId, 160)
        || !integer(animation.frameCount, 1)
        || animation.firstFrameIndex !== previousEnd
        || animation.firstFrameIndex + animation.frameCount > frameCount) {
      throw new Error(`${label}[${index}] must bind one contiguous prepared animation range.`);
    }
    previousEnd += animation.frameCount;
  }
  if (previousEnd !== frameCount) {
    throw new Error(`${label} must cover the complete prepared frame set.`);
  }
  return true;
}

function evidence(value, label) {
  if (!plainObject(value)
      || !SHA256.test(value.manifestSha256 ?? "")
      || !SHA256.test(value.renderPublicationSha256 ?? "")
      || !SHA256.test(value.prepareInputsSha256 ?? "")) {
    throw new Error(`${label} must bind the manifest, render publication, and prepare inputs.`);
  }
}

function comparison(value, boundModel, label) {
  if (!plainObject(value)
      || value.schema !== MODEL_LAB_COMPARISON_SCHEMA
      || value.frameId !== boundModel.frameId
      || value.referenceLabel !== "Native"
      || value.candidateLabel !== "Model Lab"
      || typeof value.pass !== "boolean"
      || !integer(value.channelThreshold, 0)
      || !SHA256.test(value.reportSha256 ?? "")
      || !Array.isArray(value.angles)
      || value.angles.length !== 3
      || value.angles.map((entry) => entry?.angle).join(",") !== "0,45,180") {
    throw new Error(`${label} must bind the Native/Model Lab 0,45,180 comparison.`);
  }
  for (const [index, entry] of value.angles.entries()) {
    const entryLabel = `${label}.angles[${index}]`;
    if (!plainObject(entry)
        || ![0, 45, 180].includes(entry.angle)
        || !comparisonImage(entry.native, `${entryLabel}.native`)
        || !comparisonImage(entry.candidate, `${entryLabel}.candidate`)
        || !comparisonImage(entry.diff, `${entryLabel}.diff`)
        || !plainObject(entry.metrics)
        || !finite(entry.metrics.meanAbsDelta, 0)
        || !finite(entry.metrics.rmsDelta, 0)
        || !integer(entry.metrics.maxAbsDelta, 0)
        || entry.metrics.maxAbsDelta > 255
        || !finite(entry.metrics.changedPixelRatio, 0)
        || entry.metrics.changedPixelRatio > 1
        || typeof entry.metrics.pass !== "boolean") {
      throw new Error(`${entryLabel} must bind three PNGs and one measured diff.`);
    }
  }
  if (value.pass !== value.angles.every(({ metrics }) => metrics.pass)) {
    throw new Error(`${label}.pass must summarize all measured angle diffs.`);
  }
}

function comparisonImage(value, label) {
  if (!plainObject(value)
      || !SHA256.test(value.sha256 ?? "")
      || !integer(value.width, 1)
      || !integer(value.height, 1)
      || !shortString(value.url, 2048)) {
    return false;
  }
  try {
    const parsed = new URL(value.url);
    return parsed.protocol === "http:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && parsed.pathname.endsWith(".png");
  } catch {
    throw new Error(`${label}.url must be a loopback PNG URL.`);
  }
}

function timestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shortString(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function integer(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function finite(value, minimum) {
  return Number.isFinite(value) && value >= minimum;
}
