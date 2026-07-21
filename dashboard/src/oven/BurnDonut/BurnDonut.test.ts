import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { burnDonut } from "../differential-testing-render/differential-testing-render.js";
import { assertDomEquivalent, extractFirstByClass } from "../test-support/dom-normalize";
import { BurnDonut } from "./BurnDonut";

test("BurnDonut matches the DT oracle geometry and segment order", () => {
  const cases = [
    [],
    [{ result: "improved" }],
    [{ result: "improved" }, { result: "worsened" }, { result: "unchanged" }, { result: "blocked" }, { result: "reverted" }],
    Array.from({ length: 1_234 }, (_, index) => ({ result: index % 4 === 0 ? "pass" : index % 4 === 1 ? "worsened" : index % 4 === 2 ? "blocked" : "unchanged" })),
  ];

  for (const entries of cases) {
    const actual = renderToStaticMarkup(createElement(BurnDonut, { entries }));
    const expected = extractFirstByClass(burnDonut(entries), "driving-parity-kpi-burns-donut");
    assertDomEquivalent(actual, expected, `burn donut mismatch for ${entries.length} entries`);
  }
});

test("BurnDonut hides the track for non-empty runs and keeps it visible when empty", () => {
  const empty = renderToStaticMarkup(createElement(BurnDonut, { entries: [] }));
  const populated = renderToStaticMarkup(createElement(BurnDonut, { entries: [{ result: "pass" }] }));
  assert.doesNotMatch(empty, /driving-parity-kpi-burns-donut-track[^>]*opacity=/u);
  assert.match(populated, /driving-parity-kpi-burns-donut-track[^>]*opacity="0"/u);
});
