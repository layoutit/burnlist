import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assertDomEquivalent } from "../test-support/dom-normalize";
import { captureVanillaChartSvg, FROZEN_CHART_NOW } from "../test-support/svg-dom-shim";
import { DifferentialFrameDeltaChart } from "./DifferentialFrameDeltaChart";
import { DifferentialProgressChart } from "./DifferentialProgressChart";
import { progressChartGoldenCases } from "./progress-chart-battery";

const goldenDir = resolve("dashboard/src/oven/DifferentialProgressChart/goldens");

for (const chartCase of progressChartGoldenCases) {
  test(`progress chart oracle remains stable: ${chartCase.filename}`, () => {
    const actual = captureVanillaChartSvg(chartCase);
    const expected = readFileSync(resolve(goldenDir, chartCase.filename), "utf8");
    assertDomEquivalent(actual, expected, chartCase.filename);
  });
}

for (const chartCase of progressChartGoldenCases.filter(({ filename }) => filename.startsWith("frame-delta-"))) {
  test(`frame-delta React chart matches oracle: ${chartCase.filename}`, () => {
    const [metrics] = chartCase.args;
    const actual = renderToStaticMarkup(createElement(DifferentialFrameDeltaChart, { metrics }));
    const expected = readFileSync(resolve(goldenDir, chartCase.filename), "utf8");
    assertDomEquivalent(actual, expected, chartCase.filename);
  });
}

for (const chartCase of progressChartGoldenCases.filter(({ filename }) => !filename.startsWith("frame-delta-"))) {
  test(`progress React chart matches oracle: ${chartCase.filename}`, () => {
    const [history, options] = chartCase.args;
    const priorTimeZone = process.env.TZ;
    const priorDateNow = Date.now;
    try {
      process.env.TZ = "UTC";
      if (chartCase.filename === "progress-empty.svg") Date.now = () => FROZEN_CHART_NOW;
      const actual = renderToStaticMarkup(createElement(DifferentialProgressChart, { history, ...options }));
      const expected = readFileSync(resolve(goldenDir, chartCase.filename), "utf8");
      assertDomEquivalent(actual, expected, chartCase.filename);
    } finally {
      Date.now = priorDateNow;
      if (priorTimeZone === undefined) delete process.env.TZ; else process.env.TZ = priorTimeZone;
    }
  });
}
