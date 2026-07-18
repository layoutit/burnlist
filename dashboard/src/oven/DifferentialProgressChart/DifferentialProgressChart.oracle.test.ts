import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { assertDomEquivalent } from "../test-support/dom-normalize";
import { captureVanillaChartSvg } from "../test-support/svg-dom-shim";
import { progressChartGoldenCases } from "./progress-chart-battery";

const goldenDir = resolve("dashboard/src/oven/DifferentialProgressChart/goldens");

for (const chartCase of progressChartGoldenCases) {
  test(`progress chart oracle remains stable: ${chartCase.filename}`, () => {
    const actual = captureVanillaChartSvg(chartCase);
    const expected = readFileSync(resolve(goldenDir, chartCase.filename), "utf8");
    assertDomEquivalent(actual, expected, chartCase.filename);
  });
}

// TODO(step 2): capture the React DifferentialProgressChart and compare it to these oracle SVGs.
