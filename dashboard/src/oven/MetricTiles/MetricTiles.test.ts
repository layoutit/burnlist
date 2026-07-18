import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MetricTiles } from "./MetricTiles";

function referencePercent(value) {
  return `${(value * 100).toFixed(value < 0.01 ? 3 : 2)}%`;
}

function referenceDelta(value) {
  return value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

function FrozenMetricTiles({ passed, total, ratio, meanAbsoluteDelta, maximumAbsoluteDelta }) {
  return createElement(
    "div",
    { className: "visual-parity-metrics" },
    createElement("article", null, createElement("span", null, "Frames"), createElement("strong", null, passed, "/", total)),
    createElement("article", null, createElement("span", null, "Changed pixels"), createElement("strong", null, referencePercent(ratio))),
    createElement("article", null, createElement("span", null, "Mean RGB delta"), createElement("strong", null, referenceDelta(meanAbsoluteDelta))),
    createElement("article", null, createElement("span", null, "Maximum delta"), createElement("strong", null, maximumAbsoluteDelta)),
  );
}

test("MetricTiles matches its formatted metric snapshot", () => {
  const props = { passed: 2, total: 3, ratio: 0.001234, meanAbsoluteDelta: 0.12, maximumAbsoluteDelta: 7 };
  assert.equal(renderToString(createElement(MetricTiles, props)), renderToString(createElement(FrozenMetricTiles, props)));
});
