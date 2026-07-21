import assert from "node:assert/strict";
import test from "node:test";
import { buildChecklistProgressChart } from "./checklist-progress-chart";

const history = [
  { time: "2026-07-13T21:00:00Z", done: 3, remaining: 2, total: 5, percent: 60 },
  { time: "2026-07-13T20:05:00Z", done: 2, remaining: 3, total: 5, percent: 40 },
  { time: "2026-07-13T20:00:00Z", done: 1, remaining: 3, total: 4, percent: 25 },
];

test("checklist progress chart uses compact time and completion markers", () => {
  const chart = buildChecklistProgressChart(history, "done", { width: 640, height: 180 });
  assert.deepEqual(chart.points.map((point) => point.done), [1, 2, 3]);
  const firstGap = chart.points[1].x - chart.points[0].x;
  const compactedGap = chart.points[2].x - chart.points[1].x;
  assert.equal(compactedGap > firstGap && compactedGap < firstGap * 2, true);
  assert.equal(chart.timeScale, "compact");
  assert.equal(chart.plot.bottom, 156);
  assert.deepEqual(chart.yTicks.map((tick) => tick.label), ["0%", "25%", "50%", "75%", "100%"]);
  assert.deepEqual(chart.markers.map((marker) => marker.type), ["completion", "split", "completion", "completion"]);
});

test("burn mode plots remaining item counts", () => {
  const chart = buildChecklistProgressChart(history, "burn", { width: 640, height: 180 });
  assert.deepEqual(chart.points.map((point) => point.value), [3, 3, 2]);
  assert.equal(chart.last.value, 2);
  assert.deepEqual(chart.yTicks.map((tick) => tick.label), ["0", "1", "2", "3", "4"]);
});
