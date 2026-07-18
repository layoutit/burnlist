import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { waffleMetric } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import { createRecordingCanvas } from "../test-support/canvas-recorder";
import { assertDomEquivalent, extractFirstByClass } from "../test-support/dom-normalize";
import { WaffleCanvas } from "./WaffleCanvas";
import { paintWaffleCanvas, waffleCanvasSizing, waffleCellPlan, WAFFLE_EMPTY_COLOR, WAFFLE_FAIL_COLOR, WAFFLE_PASS_COLOR } from "./waffle-canvas-paint";

const box = { x: 10.2, y: 5.1, width: 42.6, height: 33.2 };

test("WaffleCanvas matches the DT oracle static canvas metadata", () => {
  const metrics = [
    { total: 0, failed: 0, blocked: 0 },
    { total: 6, failed: 1, blocked: 5 },
    { total: 1_000_000, failed: 999_999, blocked: 1 },
    { total: 100, failed: 0, blocked: 0 },
  ];
  for (const metric of metrics) {
    const actual = renderToStaticMarkup(createElement(WaffleCanvas, { metric }));
    const expected = extractFirstByClass(waffleMetric(metric, "Fields"), "driving-parity-kpi-waffle");
    assertDomEquivalent(actual, expected, `waffle mismatch for total ${metric.total}`);
  }
});

// Rasterized pixel/DPR visual parity requires the coordinator's headless-canvas
// pixel-diff; this suite verifies the paint command stream and DPR sizing arithmetic only.
test("WaffleCanvas paints the exact waffle command stream across states and DPRs", () => {
  const cases = [
    { failedCells: "0", empty: "true", scale: 1 },
    { failedCells: "0", empty: "false", scale: 2 },
    { failedCells: "40", empty: "false", scale: 1.5 },
    { failedCells: "80", empty: "false", scale: 1 },
  ];

  for (const item of cases) {
    const recorder = createRecordingCanvas(box, { failedCells: item.failedCells, empty: item.empty });
    const sizing = waffleCanvasSizing(box, item.scale);
    paintWaffleCanvas(recorder.canvas, { scale: item.scale, box });

    assert.equal(recorder.canvas.width, sizing.bitmapWidth);
    assert.equal(recorder.canvas.height, sizing.bitmapHeight);
    assert.equal(recorder.canvas.style.transform, sizing.transform);
    assert.deepEqual(recorder.operations.slice(0, 2), [
      ["setTransform", item.scale, 0, 0, item.scale, 0, 0],
      ["clearRect", 0, 0, sizing.cssWidth, sizing.cssHeight],
    ]);

    const expectedCells = waffleCellPlan(
      Number(item.failedCells),
      item.empty === "true",
      sizing.cssWidth,
      sizing.cssHeight,
      WAFFLE_PASS_COLOR,
      WAFFLE_FAIL_COLOR,
    );
    const fills = recorder.operations.filter((operation) => operation[0] === "fillRect");
    assert.equal(fills.length, 80);
    assert.deepEqual(fills, expectedCells.map((cell) => ["fillRect", cell.x, cell.y, 3, 3]));

    const cellOperations = recorder.operations.slice(2, 2 + 80 * 3);
    assert.deepEqual(cellOperations, expectedCells.flatMap((cell) => [
      ["globalAlpha", cell.globalAlpha],
      ["fillStyle", cell.fillStyle],
      ["fillRect", cell.x, cell.y, cell.width, cell.height],
    ]));
    assert.deepEqual(recorder.operations.slice(-2), [
      ["globalAlpha", 1],
      ["setTransform", 1, 0, 0, 1, 0, 0],
    ]);
  }
});

test("WaffleCanvas snaps DPR sizing and translates fractional canvas positions", () => {
  assert.deepEqual(waffleCanvasSizing(box, 1), {
    cssWidth: 43, cssHeight: 33, bitmapWidth: 43, bitmapHeight: 33,
    dx: -0.1999999999999993, dy: -0.09999999999999964, transform: "translate(-0.200px, -0.100px)",
  });
  assert.deepEqual(waffleCanvasSizing(box, 2), {
    cssWidth: 43, cssHeight: 33, bitmapWidth: 86, bitmapHeight: 66,
    dx: -0.1999999999999993, dy: -0.09999999999999964, transform: "translate(-0.200px, -0.100px)",
  });
  assert.deepEqual(waffleCanvasSizing(box, 1.5), {
    cssWidth: 43, cssHeight: 33, bitmapWidth: 65, bitmapHeight: 50,
    dx: -0.1999999999999993, dy: 0.2333333333333334, transform: "translate(-0.200px, 0.233px)",
  });
});

test("waffleCellPlan preserves the vanilla right-column failure order", () => {
  const cells = waffleCellPlan(40, false, 43, 33, WAFFLE_PASS_COLOR, WAFFLE_FAIL_COLOR);
  assert.deepEqual(cells[0], { x: 4, y: 1, width: 3, height: 3, globalAlpha: 0.34, fillStyle: WAFFLE_PASS_COLOR });
  assert.deepEqual(cells[9], { x: 40, y: 1, width: 3, height: 3, globalAlpha: 1, fillStyle: WAFFLE_FAIL_COLOR });
  assert.deepEqual(cells[70], { x: 4, y: 29, width: 3, height: 3, globalAlpha: 0.34, fillStyle: WAFFLE_PASS_COLOR });
  assert.deepEqual(cells[79], { x: 40, y: 29, width: 3, height: 3, globalAlpha: 1, fillStyle: WAFFLE_FAIL_COLOR });

  const empty = waffleCellPlan(80, true, 43, 33, WAFFLE_PASS_COLOR, WAFFLE_FAIL_COLOR);
  assert.equal(empty[0].globalAlpha, 0.2);
  assert.equal(empty[0].fillStyle, WAFFLE_EMPTY_COLOR);
});
