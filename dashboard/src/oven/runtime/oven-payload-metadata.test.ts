import assert from "node:assert/strict";
import test from "node:test";
import { differentialExactPrefixFrameDeltaMetrics } from "./oven-payload-metadata";

test("exact-prefix frame metrics accept source-frame completion over a larger aligned-tick series", () => {
  const payload = {
    progress: [{ frame: 2, frames: 2, firstFailingTick: null }],
    summary: { frames: { uniqueTicks: 4 } },
  };
  const result = differentialExactPrefixFrameDeltaMetrics(payload, {
    frameDeviationRatios: [0.1, 0.2, 0.3, 0.4],
    firstFailingFrame: 0,
  });

  assert.deepEqual(result?.frameDeviationRatios, [0, 0, 0, 0]);
  assert.equal(result?.firstFailingFrame, -1);
});

test("exact-prefix frame metrics use the published failing tick when frame and tick counts differ", () => {
  const payload = {
    progress: [{ frame: 1, frames: 2, firstFailingTick: 3 }],
    summary: { frames: { uniqueTicks: 4 } },
  };
  const result = differentialExactPrefixFrameDeltaMetrics(payload, {
    frameDeviationRatios: [0.1, 0.2, 0.3, 0.4],
    firstFailingFrame: 0,
  });

  assert.deepEqual(result?.frameDeviationRatios, [0, 0, 0, 0.4]);
  assert.equal(result?.firstFailingFrame, 3);
});

test("exact-prefix frame metrics reject an unbound frame-to-tick mismatch", () => {
  const payload = {
    progress: [{ frame: 1, frames: 2, firstFailingTick: 3 }],
    summary: { frames: { uniqueTicks: 5 } },
  };
  assert.equal(differentialExactPrefixFrameDeltaMetrics(payload, {
    frameDeviationRatios: [0.1, 0.2, 0.3, 0.4],
    firstFailingFrame: 0,
  }), null);
});
