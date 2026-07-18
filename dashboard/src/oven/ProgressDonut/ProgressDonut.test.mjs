import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./ProgressDonut.tsx", import.meta.url).pathname;

test("ProgressDonut keeps its static markup for representative values", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".progress-donut-test-"));
  try {
    const outputPath = join(outputDir, "ProgressDonut.mjs");
    await build({
      entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
      jsx: "automatic", packages: "external", target: "node18",
    });
    const { ProgressDonut } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    for (const percent of [0, 37.5, 50, 99.999, 100, -5, 150]) {
      const donePercent = Math.max(0, Math.min(100, percent));
      const remainingPercent = Math.max(0, 100 - donePercent);
      const expected = `<svg aria-hidden="true" class="driving-parity-kpi-gauge driving-parity-kpi-progress-donut" viewBox="0 0 58 58"><circle class="driving-parity-kpi-progress-donut-track" cx="29" cy="29" r="21"></circle><circle class="driving-parity-kpi-progress-donut-segment" cx="29" cy="29" r="21" pathLength="100" stroke-dasharray="${donePercent.toFixed(3)} ${remainingPercent.toFixed(3)}" transform="rotate(-90 29 29)"></circle></svg>`;
      assert.equal(renderToStaticMarkup(createElement(ProgressDonut, { percent })), expected);
    }
    assert.equal(
      renderToStaticMarkup(createElement(ProgressDonut, { percent: 50, className: "custom-donut" })),
      `<svg aria-hidden="true" class="custom-donut" viewBox="0 0 58 58"><circle class="driving-parity-kpi-progress-donut-track" cx="29" cy="29" r="21"></circle><circle class="driving-parity-kpi-progress-donut-segment" cx="29" cy="29" r="21" pathLength="100" stroke-dasharray="50.000 50.000" transform="rotate(-90 29 29)"></circle></svg>`,
    );
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
