#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const testSupportDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testSupportDir, "../../../..");
const sourceDir = resolve(testSupportDir, "../..");
const ovenDir = resolve(sourceDir, "oven");

const alias = {
  "@": sourceDir,
  "@layout": resolve(sourceDir, "layout"),
  "@components": resolve(sourceDir, "components"),
  "@hooks": resolve(sourceDir, "hooks"),
  "@lib": resolve(sourceDir, "lib"),
  "@oven": ovenDir,
};

function discoverTests(directory) {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (filePath !== testSupportDir) files.push(...discoverTests(filePath));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(filePath);
    }
  }
  return files;
}

function discoverBundledTests(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...discoverBundledTests(filePath));
    else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(filePath);
  }
  return files.sort();
}

const testEntries = discoverTests(ovenDir);
console.log(`=== Oven TypeScript tests (${testEntries.length}) ===`);

if (testEntries.length === 0) process.exit(0);

const outputDir = mkdtempSync(join(repoRoot, ".oven-test-"));
let status = 0;
try {
  await build({
    entryPoints: testEntries,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    jsx: "automatic",
    packages: "external",
    sourcemap: "inline",
    outdir: outputDir,
    outbase: ovenDir,
    entryNames: "[dir]/[name]",
    outExtension: { ".js": ".mjs" },
    alias,
  });

  const bundledTests = discoverBundledTests(outputDir);
  const result = spawnSync(process.execPath, ["--test", ...bundledTests], { stdio: "inherit" });
  status = result.status ?? 1;
} catch (error) {
  console.error("Oven TypeScript test harness failed.");
  console.error(error);
  status = 1;
} finally {
  rmSync(outputDir, { force: true, recursive: true });
}

process.exit(status);
