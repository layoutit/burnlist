#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const outputDir = resolve(here, "../DifferentialProgressChart/goldens");
const bundleDir = mkdtempSync(resolve(tmpdir(), "burnlist-progress-chart-"));
const shimPath = resolve(here, "svg-dom-shim.ts");
const batteryPath = resolve(here, "../DifferentialProgressChart/progress-chart-battery.ts");

function runtimeModule(sourcePath, outputName) {
  const source = readFileSync(sourcePath, "utf8").replaceAll(
    'from "../../../../ovens/',
    `from "${pathToFileURL(resolve(repoRoot, "ovens")).href}/`,
  );
  const outputPath = resolve(bundleDir, outputName);
  writeFileSync(outputPath, source, "utf8");
  return `${pathToFileURL(outputPath).href}?${Date.now()}`;
}

try {
  mkdirSync(outputDir, { recursive: true });
  const { captureVanillaChartSvg } = await import(runtimeModule(shimPath, "svg-dom-shim.mjs"));
  const { progressChartGoldenCases } = await import(runtimeModule(batteryPath, "progress-chart-battery.mjs"));
  for (const chartCase of progressChartGoldenCases) {
    const target = resolve(outputDir, chartCase.filename);
    const temporary = `${target}.tmp-${process.pid}`;
    writeFileSync(temporary, `${captureVanillaChartSvg(chartCase)}\n`, "utf8");
    renameSync(temporary, target);
  }
} finally {
  rmSync(bundleDir, { force: true, recursive: true });
}
