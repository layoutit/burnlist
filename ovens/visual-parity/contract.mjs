import { assertDifferentialTestingData } from "../differential-testing/data-contract.mjs";

export const VISUAL_PARITY_SCHEMA = "burnlist-visual-parity-data@1";

export function assertVisualParityData(value, label = "Visual Parity data") {
  if (!value || value.schema !== VISUAL_PARITY_SCHEMA) {
    throw new Error(label + " must use " + VISUAL_PARITY_SCHEMA + ".");
  }
  assertDifferentialTestingData(value.differentialTesting);
  const scenarioId = value.differentialTesting.scenarioCatalog.selectedScenarioId;
  const scenario = value.differentialTesting.scenarioCatalog.scenarios
    .find((entry) => entry.id === scenarioId);
  if (!scenario) throw new Error(label + " must retain one selected Differential Testing scenario.");
  if (!Array.isArray(value.domains) || value.domains.length < 1 || value.domains.length > 12) {
    throw new Error(label + " must define 1-12 isolated render domains.");
  }
  const domainIds = new Set();
  const domains = new Map();
  for (const domain of value.domains) {
    if (!domain?.id || !/^[a-z][a-z0-9-]*$/u.test(domain.id) || domainIds.has(domain.id)
      || !domain.label || domain.isolation !== "render-pass"
      || !["target", "context"].includes(domain.qualification)) {
      throw new Error(label + " contains an invalid, duplicate, or unqualified render domain.");
    }
    domainIds.add(domain.id);
    domains.set(domain.id, domain);
    if (domain.tolerance !== undefined) assertTolerance(domain.tolerance, label + ".domains." + domain.id);
  }
  if (![...domains.values()].some((domain) => domain.qualification === "target")) {
    throw new Error(label + " must identify at least one qualifying target domain.");
  }
  if (!Array.isArray(value.comparisons) || value.comparisons.length < 1 || value.comparisons.length > 10_000) {
    throw new Error(label + " must retain 1-10000 frame comparisons.");
  }
  let previousFrame = -1;
  const comparisonIds = new Set();
  const capturedDomains = new Set();
  for (const comparison of value.comparisons) {
    if (!comparison?.id || comparisonIds.has(comparison.id) || !comparison.label
      || !Number.isSafeInteger(comparison.frame) || comparison.frame <= previousFrame
      || comparison.frame < 0 || comparison.frame >= scenario.frameCount
      || !["pass", "fail"].includes(comparison.status)) {
      throw new Error(label + " contains invalid, duplicate, or unordered frame comparisons.");
    }
    comparisonIds.add(comparison.id);
    previousFrame = comparison.frame;
    const entries = comparison.domains;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)
      || Object.keys(entries).length !== domains.size
      || Object.keys(entries).some((id) => !domains.has(id))) {
      throw new Error(label + " frame comparisons must contain every declared domain exactly once.");
    }
    for (const [id, domain] of domains) {
      const entry = entries[id];
      assertDomainComparison(entry, domain, label + `.comparisons.${comparison.frame}.${id}`);
      if (entry.reference.src !== null) capturedDomains.add(id);
    }
    const expected = [...domains].filter(([, domain]) => domain.qualification === "target")
      .every(([id]) => entries[id].status === "pass") ? "pass" : "fail";
    if (comparison.status !== expected) {
      throw new Error(label + " frame status must reconcile only the qualifying target domains.");
    }
  }
  if ([...domainIds].some((id) => !capturedDomains.has(id))) {
    throw new Error(label + " must retain one complete screenshot triplet for every domain.");
  }
  return value;
}

function assertTolerance(value, label) {
  if (!value || !/^[a-z][a-z0-9-]*-visual-parity-tolerance@1$/u.test(value.schema)
    || !Number.isSafeInteger(value.channelDelta) || value.channelDelta < 0 || value.channelDelta > 255
    || !finiteRange(value.meanAbsoluteDelta, 0, 255)
    || !finiteRange(value.changedPixelRatio, 0, 1)
    || typeof value.rationale !== "string" || !value.rationale.trim() || value.rationale.length > 320) {
    throw new Error(label + " contains an invalid calibrated tolerance.");
  }
}

function assertDomainComparison(value, domain, label) {
  if (!value || value.label !== domain.label || !["pass", "fail"].includes(value.status)) {
    throw new Error(label + " must retain the declared domain label and pass/fail status.");
  }
  const images = [value.reference, value.candidate, value.diff];
  for (const image of images) {
    if (!image?.label || !Number.isSafeInteger(image.width) || image.width < 1 || image.width > 16_384
      || !Number.isSafeInteger(image.height) || image.height < 1 || image.height > 16_384
      || !(image.src === null || (typeof image.src === "string" && image.src.startsWith("data:image/png;base64,")))) {
      throw new Error(label + " contains an invalid screenshot descriptor.");
    }
  }
  if (!images.every((image) => image.width === images[0].width && image.height === images[0].height)
    || !([0, 3].includes(images.filter((image) => image.src !== null).length))) {
    throw new Error(label + " screenshot triplets must be complete and dimension-aligned.");
  }
  const difference = value.difference;
  const totalPixels = images[0].width * images[0].height;
  if (!difference || difference.totalPixels !== totalPixels
    || !Number.isSafeInteger(difference.changedPixels) || difference.changedPixels < 0
    || difference.changedPixels > totalPixels
    || difference.ratio !== difference.changedPixels / totalPixels
    || !finiteRange(difference.meanAbsoluteDelta, 0, 255)
    || !finiteRange(difference.maximumAbsoluteDelta, 0, 255)
    || difference.maximumAbsoluteDelta < difference.meanAbsoluteDelta) {
    throw new Error(label + " contains contradictory difference metrics.");
  }
  const tolerance = domain.tolerance ?? {
    channelDelta: 0,
    meanAbsoluteDelta: 0,
    changedPixelRatio: 0,
  };
  const expected = difference.maximumAbsoluteDelta <= tolerance.channelDelta
    && difference.meanAbsoluteDelta <= tolerance.meanAbsoluteDelta
    && difference.ratio <= tolerance.changedPixelRatio ? "pass" : "fail";
  if (value.status !== expected) {
    throw new Error(label + " status does not reconcile with its declared domain tolerance.");
  }
}

function finiteRange(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
