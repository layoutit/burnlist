import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./MetricTiles.tsx", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
let outputDir;
let MetricTiles;

before(async () => {
  outputDir = await mkdtemp(join(process.cwd(), ".metric-tiles-test-"));
  const outputPath = join(outputDir, "MetricTiles.mjs");
  await build({
    entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
    alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18",
  });
  ({ MetricTiles } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`));
});

after(async () => {
  await rm(outputDir, { force: true, recursive: true });
});

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
