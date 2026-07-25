const HIGH_RISK = /\b(auth(?:entication|orization)?|permission|security|secret|payment|billing|migration|schema|data[- ]?loss|atomic|concurren|race|public api|breaking|deploy|production)\b/u;
const BRANCHABLE = /\b(parallel|independent|lanes?|workstreams?|frontend and backend|client and server|multiple packages|fan[- ]?out)\b/u;
const IMPLEMENTATION = /\b(implement|build|change|fix|refactor|migrate|add|remove|replace|integrate|optimi[sz]e)\b/u;
const DOCUMENTATION = /\b(readme|documentation|docs?|copy|wording|guide|reference)\b/u;
const VISUAL = /\b(ui|ux|visual|layout|css|browser|responsive|dashboard|oven|screenshot|pixel)\b/u;
const PERFORMANCE = /\b(performance|latency|throughput|memory|cpu|benchmark|timing|budget)\b/u;
const DIFFERENTIAL = /\b(equivalence|golden|migration|legacy|candidate|reference|byte[- ]?diff|differential)\b/u;
const MODEL = /\b(model lab|mesh|geometry|animation|lod|three[- ]?d|3d)\b/u;

export const REVIEW_PRIORITIES = Object.freeze([
  Object.freeze({ priority: "P0", handling: "Stop and escalate: safety, security, data loss, or invalid authority." }),
  Object.freeze({ priority: "P1", handling: "Reject: high-impact correctness or contract defect." }),
  Object.freeze({ priority: "P2", handling: "Reject when acceptance or a material user outcome is affected." }),
  Object.freeze({ priority: "P3", handling: "Do not block completion; record a bounded follow-up." }),
  Object.freeze({ priority: "P4", handling: "Optional note or style preference; omit when it adds no value." }),
]);

function itemText(item) {
  return [item?.title, ...Object.values(item?.fields ?? {})].filter(Boolean).join(" ").toLowerCase();
}

function pathCount(item) {
  const value = item?.fields?.["Files/search"] ?? "";
  return new Set(value.split(/[\s,]+/u)
    .map((part) => part.replace(/^`|`$/gu, "").trim())
    .filter((part) => part.includes("/") || /\.[a-z0-9]+$/iu.test(part))).size;
}

function codeSurface(item) {
  return /\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|swift|css|scss|html)\b/iu
    .test(item?.fields?.["Files/search"] ?? "");
}

function metricRecommendation(text) {
  if (VISUAL.test(text)) return {
    oven: "visual-parity",
    signal: "User-approved task-fit screenshots with zero unexplained visual drift.",
    visualVerificationRequired: true,
  };
  if (PERFORMANCE.test(text)) return {
    oven: "performance-tracing",
    signal: "Measured timings stay within the user-approved baseline and budget.",
    visualVerificationRequired: true,
  };
  if (DIFFERENTIAL.test(text)) return {
    oven: "differential-testing",
    signal: "Reference-versus-candidate evidence reaches the user-approved exact or toleranced target.",
    visualVerificationRequired: true,
  };
  if (MODEL.test(text)) return {
    oven: "model-lab",
    signal: "The user-approved model contract and comparison evidence pass.",
    visualVerificationRequired: true,
  };
  return {
    oven: null,
    signal: "Use the declared repository check; add an Oven only for a user-approved objective outcome.",
    visualVerificationRequired: false,
  };
}

export function recommendOperationalProfile(item) {
  if (!item || typeof item.title !== "string" || !item.fields || typeof item.fields !== "object") {
    throw new Error("Operational recommendation requires one parsed Burnlist item.");
  }
  const text = itemText(item);
  const highRisk = HIGH_RISK.test(text);
  const branchable = BRANCHABLE.test(text) || (pathCount(item) >= 5 && /\bacross\b/u.test(text));
  const implementation = IMPLEMENTATION.test(text) || codeSurface(item);
  const docsOnly = DOCUMENTATION.test(text) && !implementation && !highRisk;
  const loop = branchable ? "branch" : highRisk ? "review" : implementation ? "gate" : "direct";
  const modelClass = loop === "branch" || loop === "review" ? "strong"
    : loop === "gate" ? "standard" : "fast";
  const effort = highRisk ? "xhigh" : loop === "branch" ? "high"
    : loop === "review" ? "high" : loop === "gate" ? "medium" : "low";
  const review = ["review", "branch"].includes(loop)
    ? "P0-P2 block; P3 follow-up; P4 optional note."
    : loop === "gate"
      ? "P0-P1 block; P2 blocks only when acceptance is materially affected; P3-P4 follow-up."
      : "Self-check; escalate any P0-P2 finding instead of silently accepting it.";
  const metric = metricRecommendation(text);
  return Object.freeze({
    schema: "burnlist-operational-recommendation@1",
    advisory: true,
    loop,
    modelClass,
    effort,
    review,
    metric,
    sequence: docsOnly
      ? "Make the smallest complete documentation change, verify links/examples, then refine wording."
      : "Establish the thinnest working end-to-end path first, prove it, then refine internals and edges.",
    optimize: Object.freeze([
      "host-visible commands",
      "agent turns",
      "wall time",
      "reported tokens when available",
      "check and review retries",
    ]),
    rationale: Object.freeze([
      branchable ? "The item names independently separable work." : null,
      highRisk ? "The item touches a high-impact boundary." : null,
      implementation && !highRisk ? "The item is bounded implementation with a deterministic gate." : null,
      docsOnly ? "The item appears documentation-only." : null,
    ].filter(Boolean)),
  });
}

export function renderOperationalRecommendation(itemRef, recommendation) {
  const loopRef = recommendation.loop === "direct" ? "direct" : `loop:builtin:${recommendation.loop}`;
  return [
    `Recommendation for ${itemRef} (advisory; user choice remains authoritative)`,
    `Loop: ${loopRef}`,
    `Model / effort: ${recommendation.modelClass} / ${recommendation.effort}`,
    `Review: ${recommendation.review}`,
    `Metric: ${recommendation.metric.oven
      ? `Oven ${recommendation.metric.oven} — ${recommendation.metric.signal}`
      : recommendation.metric.signal}`,
    `Sequence: ${recommendation.sequence}`,
    `Optimize observed: ${recommendation.optimize.join("; ")}.`,
  ].join("\n");
}
