import test from "node:test";
import assert from "node:assert/strict";
import {
  assertModelLabData,
  MODEL_LAB_COMPARISON_SCHEMA,
  MODEL_LAB_SCHEMA,
} from "./model-lab-contract.mjs";

function fixture() {
  return {
    schema: MODEL_LAB_SCHEMA,
    generatedAt: "2026-07-18T12:00:00.000Z",
    project: { id: "cssoccer", label: "css.soccer" },
    surface: { title: "css.soccer Player Model Lab", url: "http://127.0.0.1:5173/bench/model-lab/model-lab.html" },
    model: {
      id: "actor-player-f2",
      actor: {
        id: "argentina-player-10",
        name: "G. Batistuta",
        country: "argentina",
        shirtNumber: 10,
        sourceTeamSlot: "B",
      },
      animations: [{
        id: "mc-122",
        slotId: 122,
        symbol: "MC_122",
        firstFrameIndex: 0,
        firstFrameId: "mc-122-f-000",
        frameCount: 2450,
      }],
      frameIndex: 2356,
      frameId: "mc-122-f-107",
      frameCount: 2450,
      polygonCount: 13,
      leafCount: 13,
      leafTag: "s",
      topologyMode: "stable-frame-set",
      lodCount: 1,
      droppedSourcePolygonCount: 0,
      topologyHash: "a".repeat(64),
      frameSetHash: "b".repeat(64),
      runtimeConstruction: {
        assetBuildCount: 0,
        geometryBuildCount: 0,
        materialBuildCount: 0,
        sourceParseCount: 0,
        topologyBuildCount: 0,
      },
    },
    evidence: {
      manifestSha256: "c".repeat(64),
      renderPublicationSha256: "d".repeat(64),
      prepareInputsSha256: "e".repeat(64),
    },
  };
}

function comparisonFixture() {
  return {
    schema: MODEL_LAB_COMPARISON_SCHEMA,
    frameId: "mc-122-f-107",
    referenceLabel: "Native",
    candidateLabel: "Model Lab",
    channelThreshold: 8,
    pass: false,
    reportSha256: "f".repeat(64),
    angles: [0, 45, 180].map((angle) => ({
      angle,
      native: imageFixture(`native-${angle}`),
      candidate: imageFixture(`candidate-${angle}`),
      diff: imageFixture(`diff-${angle}`),
      metrics: {
        meanAbsDelta: 3.2,
        rmsDelta: 19.9,
        maxAbsDelta: 224,
        changedPixelRatio: 0.038,
        pass: false,
      },
    })),
  };
}

function imageFixture(name) {
  return {
    url: `http://127.0.0.1:5173/cssoccer/model-lab/comparison/${name}.png`,
    sha256: "a".repeat(64),
    width: 640,
    height: 400,
  };
}

test("accepts one prepared stable <s> frameset without LOD", () => {
  assert.equal(assertModelLabData(fixture()).model.lodCount, 1);
});

test("accepts the bound Native, Model Lab, and diff images at 0, 45, and 180 degrees", () => {
  const value = fixture();
  value.comparison = comparisonFixture();
  assert.deepEqual(assertModelLabData(value).comparison.angles.map(({ angle }) => angle), [0, 45, 180]);
});

test("rejects LOD and non-<s> model variants", () => {
  const lod = fixture();
  lod.model.lodCount = 2;
  assert.throws(() => assertModelLabData(lod), /lodCount 1/u);

  const leaf = fixture();
  leaf.model.leafTag = "b";
  assert.throws(() => assertModelLabData(leaf), /stable prepared <s>/u);
});

test("rejects incomplete animation ranges and missing player identity", () => {
  const animation = fixture();
  animation.model.animations[0].frameCount -= 1;
  assert.throws(() => assertModelLabData(animation), /complete prepared frame set/u);

  const actor = fixture();
  delete actor.model.actor.name;
  assert.throws(() => assertModelLabData(actor), /prepared player identity/u);
});

test("rejects remote surfaces and runtime construction", () => {
  const remote = fixture();
  remote.surface.url = "https://example.com/model-lab";
  assert.throws(() => assertModelLabData(remote), /loopback HTTP/u);

  const runtime = fixture();
  runtime.model.runtimeConstruction.geometryBuildCount = 1;
  assert.throws(() => assertModelLabData(runtime), /zero prepare-boundary/u);
});

test("rejects remote comparison images and incomplete angle sets", () => {
  const remote = fixture();
  remote.comparison = comparisonFixture();
  remote.comparison.angles[0].native.url = "https://example.com/native.png";
  assert.throws(() => assertModelLabData(remote), /three PNGs/u);

  const incomplete = fixture();
  incomplete.comparison = comparisonFixture();
  incomplete.comparison.angles.pop();
  assert.throws(() => assertModelLabData(incomplete), /0,45,180/u);
});
