import assert from "node:assert/strict";
import test from "node:test";
import {
  recommendOperationalProfile,
  renderOperationalRecommendation,
  REVIEW_PRIORITIES,
} from "./recommendation.mjs";

const item = (title, action, files = "src/main.mjs") => ({
  id: "B1", title, fields: {
    Action: action,
    "Files/search": files,
    "Done/delete when": "The declared outcome passes.",
    Validate: "npm test",
  },
});

test("recommendations stay advisory and choose the lightest fitting control", () => {
  const direct = recommendOperationalProfile(item("Tighten wording", "Clarify the guide.", "README.md"));
  assert.equal(direct.loop, "direct");
  assert.equal(direct.modelClass, "fast");
  assert.equal(direct.effort, "low");
  assert.equal(direct.advisory, true);

  const gate = recommendOperationalProfile(item("Fix parser", "Implement the bounded parser fix."));
  assert.equal(gate.loop, "gate");
  assert.equal(gate.modelClass, "standard");
  assert.match(gate.review, /P0-P1 block/u);

  const review = recommendOperationalProfile(item("Harden authorization", "Implement public API permission checks."));
  assert.equal(review.loop, "review");
  assert.equal(review.effort, "xhigh");
  assert.match(review.review, /P0-P2 block/u);
});

test("branch and task-fit Oven recommendations require explicit outcome proof", () => {
  const recommendation = recommendOperationalProfile(item(
    "Build responsive dashboard",
    "Implement independent frontend and backend workstreams across the UI.",
    "dashboard/src/ src/server/ src/cli/ tests/ ovens/",
  ));
  assert.equal(recommendation.loop, "branch");
  assert.equal(recommendation.metric.oven, "visual-parity");
  assert.equal(recommendation.metric.visualVerificationRequired, true);
  assert.match(recommendation.metric.signal, /User-approved/u);
  assert.match(recommendation.sequence, /end-to-end path first/u);
  assert.deepEqual(recommendation.optimize, [
    "host-visible commands", "agent turns", "wall time", "reported tokens when available",
    "check and review retries",
  ]);
});

test("P0-P4 handling and human output are concise and closed", () => {
  assert.deepEqual(REVIEW_PRIORITIES.map((entry) => entry.priority), ["P0", "P1", "P2", "P3", "P4"]);
  const recommendation = recommendOperationalProfile(item("Fix parser", "Implement the parser fix."));
  const output = renderOperationalRecommendation("260725-001#B1", recommendation);
  assert.match(output, /advisory; user choice remains authoritative/u);
  assert.match(output, /Loop: loop:builtin:gate/u);
  assert.match(output, /Optimize observed: host-visible commands; agent turns; wall time/u);
  assert.doesNotMatch(output, /\$|cost/u);
});
