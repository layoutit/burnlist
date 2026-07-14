import { assertDifferentialTestingData } from "./differential-testing-data-contract.mjs";

export const VISUAL_PARITY_SCHEMA = "burnlist-visual-parity-data@1";

const comparisonStatuses = new Set(["pass", "fail"]);
const MAX_COMPARISONS = 10_000;
const MAX_SCREENSHOT_COMPARISONS = 10;
const SCREENSHOT_SAMPLE_INTERVAL = 100;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field "${key}".`);
  }
}

function text(value, label, maximum = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

function dimension(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16_384) throw new Error(`${label} must be an integer from 1 to 16384.`);
  return value;
}

function imageSource(value, label) {
  if (value === null) return null;
  text(value, label, 16_777_216);
  if (!value.startsWith("data:image/") && !value.startsWith("/") && !/^https?:\/\//u.test(value)) {
    throw new Error(`${label} must be an image data URL, an absolute dashboard path, or an HTTP URL.`);
  }
  return value;
}

function image(value, label) {
  const item = object(value, label);
  onlyKeys(item, new Set(["label", "src", "width", "height"]), label);
  text(item.label, `${label} label`);
  imageSource(item.src, `${label} src`);
  dimension(item.width, `${label} width`);
  dimension(item.height, `${label} height`);
  return item;
}

function difference(value, status) {
  const item = object(value, "Visual Parity difference");
  onlyKeys(item, new Set(["changedPixels", "totalPixels", "ratio", "meanAbsoluteDelta", "maximumAbsoluteDelta"]), "Visual Parity difference");
  if (!Number.isSafeInteger(item.totalPixels) || item.totalPixels < 1) throw new Error("Visual Parity totalPixels must be a positive integer.");
  if (!Number.isSafeInteger(item.changedPixels) || item.changedPixels < 0 || item.changedPixels > item.totalPixels) {
    throw new Error("Visual Parity changedPixels must be between zero and totalPixels.");
  }
  if (typeof item.ratio !== "number" || !Number.isFinite(item.ratio) || item.ratio < 0 || item.ratio > 1) {
    throw new Error("Visual Parity ratio must be from zero to one.");
  }
  if (Math.abs(item.ratio - item.changedPixels / item.totalPixels) > 1e-12) {
    throw new Error("Visual Parity ratio must equal changedPixels divided by totalPixels.");
  }
  for (const [key, label] of [["meanAbsoluteDelta", "meanAbsoluteDelta"], ["maximumAbsoluteDelta", "maximumAbsoluteDelta"]]) {
    if (typeof item[key] !== "number" || !Number.isFinite(item[key]) || item[key] < 0 || item[key] > 255) {
      throw new Error(`Visual Parity ${label} must be from zero to 255.`);
    }
  }
  if (item.maximumAbsoluteDelta < item.meanAbsoluteDelta) {
    throw new Error("Visual Parity maximumAbsoluteDelta cannot be lower than meanAbsoluteDelta.");
  }
  if (status === "pass" && item.changedPixels !== 0) throw new Error("A passing Visual Parity comparison cannot contain changed pixels.");
  if (status === "fail" && item.changedPixels === 0) throw new Error("A failing Visual Parity comparison must contain changed pixels.");
  return item;
}

export function assertVisualParityData(value) {
  const payload = object(value, "Visual Parity payload");
  onlyKeys(payload, new Set(["schema", "differentialTesting", "comparisons"]), "Visual Parity payload");
  if (payload.schema !== VISUAL_PARITY_SCHEMA) throw new Error(`Visual Parity schema must be ${VISUAL_PARITY_SCHEMA}.`);
  assertDifferentialTestingData(payload.differentialTesting);
  if (payload.differentialTesting.scenarioCatalog.selectedScenarioId === null) {
    throw new Error("Visual Parity requires one selected screenshot scenario.");
  }

  if (!Array.isArray(payload.comparisons) || payload.comparisons.length < 1 || payload.comparisons.length > MAX_COMPARISONS) {
    throw new Error(`Visual Parity comparisons must contain from 1 to ${MAX_COMPARISONS} frames.`);
  }
  const ids = new Set();
  let previousFrame = -1;
  const screenshotFrames = [];
  for (const [index, value] of payload.comparisons.entries()) {
    const label = `Visual Parity comparison ${index}`;
    const comparison = object(value, label);
    onlyKeys(comparison, new Set(["id", "label", "frame", "status", "reference", "candidate", "diff", "difference"]), label);
    text(comparison.id, `${label} id`);
    text(comparison.label, `${label} label`);
    if (ids.has(comparison.id)) throw new Error("Visual Parity comparison ids must be unique.");
    ids.add(comparison.id);
    if (!Number.isSafeInteger(comparison.frame) || comparison.frame < 0 || comparison.frame <= previousFrame) {
      throw new Error("Visual Parity comparison frames must be unique non-negative integers in ascending order.");
    }
    previousFrame = comparison.frame;
    if (!comparisonStatuses.has(comparison.status)) throw new Error("Visual Parity status must be pass or fail.");
    const reference = image(comparison.reference, `${label} reference`);
    const candidate = image(comparison.candidate, `${label} candidate`);
    const diff = image(comparison.diff, `${label} diff`);
    const comparisonDifference = difference(comparison.difference, comparison.status);
    if (
      reference.width !== candidate.width
      || reference.height !== candidate.height
      || reference.width !== diff.width
      || reference.height !== diff.height
    ) {
      throw new Error("Comparable Visual Parity screenshots and diff must have identical dimensions.");
    }
    if (comparisonDifference.totalPixels !== reference.width * reference.height) {
      throw new Error("Visual Parity totalPixels must equal screenshot width multiplied by height.");
    }
    const sourceCount = [reference.src, candidate.src, diff.src].filter(Boolean).length;
    if (sourceCount !== 0 && sourceCount !== 3) throw new Error("A captured Visual Parity frame requires its complete screenshot triplet.");
    if (sourceCount === 3) screenshotFrames.push(comparison.frame);
  }
  const expectedScreenshotFrames = payload.comparisons
    .filter((_comparison, index) => index % SCREENSHOT_SAMPLE_INTERVAL === 0)
    .slice(0, MAX_SCREENSHOT_COMPARISONS)
    .map((comparison) => comparison.frame);
  if (
    screenshotFrames.length !== expectedScreenshotFrames.length
    || screenshotFrames.some((frame, index) => frame !== expectedScreenshotFrames[index])
  ) throw new Error("Visual Parity screenshot cards must sample one frame every 100 frames, up to 10 cards.");
  return payload;
}

export function visualParityDeltaChartMetrics(comparisons) {
  if (!Array.isArray(comparisons) || comparisons.length === 0) {
    throw new Error("Visual Parity Delta chart requires frame comparisons.");
  }
  return {
    frameDeviationRatios: comparisons.map((comparison) => comparison.difference.ratio),
    frameSignedResiduals: comparisons.map((comparison) => comparison.difference.meanAbsoluteDelta),
    firstFailingFrame: comparisons.findIndex((comparison) => comparison.status === "fail"),
    ariaLabel: "Mean absolute RGB channel delta by frame; display capped at the 98th percentile with clipped values marked",
    valueLabel: "mean absolute RGB channel delta",
  };
}
