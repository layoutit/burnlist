import assert from "node:assert/strict";
import test from "node:test";
import { buildPayload } from "../../differential-testing/example/adapter.mjs";
import { assertVisualParityData } from "./visual-parity-contract.mjs";

test("Visual Parity qualifies target domains without hiding failing context", () => {
  const payload = fixture();
  assert.equal(assertVisualParityData(payload), payload);
  assert.equal(payload.comparisons[0].status, "pass");
  assert.equal(payload.comparisons[0].domains.world.status, "fail");
});

test("Visual Parity rejects target verdicts that context contamination flips", () => {
  const payload = fixture();
  payload.comparisons[0].status = "fail";
  assert.throws(() => assertVisualParityData(payload), /qualifying target domains/u);
});

test("Visual Parity enforces every calibrated tolerance dimension", () => {
  const payload = fixture();
  payload.domains[1].tolerance.channelDelta = 0;
  assert.throws(() => assertVisualParityData(payload), /does not reconcile/u);
});

test("Visual Parity accepts a bounded subset of scenario frames", () => {
  const payload = fixture();
  payload.differentialTesting.scenarioCatalog.scenarios[0].frameCount = 10;
  payload.differentialTesting.refresh.report.frameCount = 10;
  payload.comparisons[0].frame = 9;
  assert.doesNotThrow(() => assertVisualParityData(payload));

  payload.comparisons[0].frame = 10;
  assert.throws(() => assertVisualParityData(payload), /frame comparisons/u);
});

function fixture() {
  const generatedAt = "2026-07-16T12:00:00.000Z";
  const differentialTesting = buildPayload({
    captureId: "reference-fixture",
    generatedAt,
    fields: [{
      id: "position",
      label: "Position",
      sourceOwner: "fixture/state",
      meaning: "One retained position.",
      unit: "units",
      tolerance: 0,
    }],
    samples: [{ tick: 0, values: { position: 1 } }],
  }, {
    captureId: "candidate-fixture",
    generatedAt,
    samples: [{ tick: 0, values: { position: 1 } }],
  });
  const image = (label) => ({ label, src: "data:image/png;base64,AA==", width: 1, height: 1 });
  const difference = { changedPixels: 1, totalPixels: 1, ratio: 1, meanAbsoluteDelta: 1, maximumAbsoluteDelta: 1 };
  return {
    schema: "burnlist-visual-parity-data@1",
    differentialTesting,
    domains: [
      { id: "world", label: "World", isolation: "render-pass", qualification: "context" },
      {
        id: "cars",
        label: "Cars",
        isolation: "render-pass",
        qualification: "target",
        tolerance: {
          schema: "fixture-visual-parity-tolerance@1",
          channelDelta: 1,
          meanAbsoluteDelta: 1,
          changedPixelRatio: 1,
          rationale: "Fixture-only deterministic raster allowance.",
        },
      },
    ],
    comparisons: [{
      id: differentialTesting.scenarioCatalog.selectedScenarioId + "-frame-0",
      label: "Fixture frame 0",
      frame: 0,
      status: "pass",
      domains: {
        world: {
          label: "World",
          status: "fail",
          reference: image("Reference"),
          candidate: image("Candidate"),
          diff: image("Diff"),
          difference: { ...difference },
        },
        cars: {
          label: "Cars",
          status: "pass",
          reference: image("Reference"),
          candidate: image("Candidate"),
          diff: image("Diff"),
          difference: { ...difference },
        },
      },
    }],
  };
}
