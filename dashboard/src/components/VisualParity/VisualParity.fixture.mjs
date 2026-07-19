import { buildPayload } from "../../../../ovens/differential-testing/example/adapter.mjs";

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

export const visualParityFixture = {
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
