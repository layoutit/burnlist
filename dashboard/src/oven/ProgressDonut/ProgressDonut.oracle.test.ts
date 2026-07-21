import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { progressDonut } from "../differential-testing-render/differential-testing-render.js";
import { assertDomEquivalent, extractFirstByClass } from "../test-support/dom-normalize";
import { ProgressDonut } from "./ProgressDonut";

test("ProgressDonut matches the DT oracle dash formatting", () => {
  const cases = [
    [],
    [{ frames: 0, frame: 0 }],
    [{ frames: 3, frame: 1 }],
    [{ frames: 1_000_000, frame: 999_999 }],
    [{ frames: 10, frame: 15 }],
  ];

  for (const entries of cases) {
    const latest = entries[entries.length - 1];
    const total = Math.max(0, Number(latest?.frames) || 0);
    const done = Math.max(0, Math.min(total, Number(latest?.frame) || 0));
    const actual = renderToStaticMarkup(createElement(ProgressDonut, { percent: total ? done / total * 100 : 0 }));
    const expected = extractFirstByClass(progressDonut(entries), "driving-parity-kpi-progress-donut");
    assertDomEquivalent(actual, expected, `progress mismatch for ${entries.length} entries`);
  }
});
