import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { waffleMetric } from "../differential-testing-render/differential-testing-render.js";
import { assertDomEquivalent, extractFirstByClass } from "../test-support/dom-normalize";
import { WaffleMetric } from "./WaffleMetric";

test("WaffleMetric matches the DT oracle static canvas metadata", () => {
  const metrics = [
    { total: 0, failed: 0, blocked: 0 },
    { total: 6, failed: 1, blocked: 5 },
    { total: 1_000_000, failed: 999_999, blocked: 1 },
    { total: 100, failed: 0, blocked: 0 },
  ];

  for (const metric of metrics) {
    const actual = renderToStaticMarkup(createElement(WaffleMetric, { metric }));
    const expected = extractFirstByClass(waffleMetric(metric, "Fields"), "driving-parity-kpi-waffle");
    assertDomEquivalent(actual, expected, `waffle mismatch for total ${metric.total}`);
  }
});

test("WaffleMetric computes failed cells from failed plus blocked", () => {
  const markup = renderToStaticMarkup(createElement(WaffleMetric, { metric: { total: 10, failed: 1, blocked: 1 } }));
  assert.match(markup, /data-failed-cells="19"/u);
  assert.match(markup, /data-empty="false"/u);
});
