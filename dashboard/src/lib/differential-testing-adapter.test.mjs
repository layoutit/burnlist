import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import {
  differentialTestingEmptyPayload,
  differentialTestingPayload,
} from "../../../ovens/differential-testing/renderer/golden-harness.mjs";

const adapterPath = new URL("./differential-testing-adapter.ts", import.meta.url).pathname;

test("adapter exposes contract pointers and selects the detail page", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".differential-testing-adapter-test-"));
  try {
    const outputPath = join(outputDir, "differential-testing-adapter.mjs");
    await build({ entryPoints: [adapterPath], bundle: true, format: "esm", outfile: outputPath, platform: "node", target: "node18" });
    const { adaptDifferentialTesting } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    const data = differentialTestingPayload();
    const payload = adaptDifferentialTesting(data);
    assert.equal(payload.pageMode, "detail");
    assert.equal(payload.scenarioCatalog, data.scenarioCatalog);
    assert.equal(payload.progress, data.progress);
    assert.equal(payload.log, data.log);
    assert.equal(payload.summary.fields, data.summary.fields);
    assert.equal(payload.summary.frames, data.summary.frames);
    assert.equal(payload.fields, data.fields);
    assert.equal(payload.telemetry, data.telemetry);
    assert.equal(payload.refresh, data.refresh);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});

test("adapter selects the empty page without mutating the contract", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".differential-testing-adapter-test-"));
  try {
    const outputPath = join(outputDir, "differential-testing-adapter.mjs");
    await build({ entryPoints: [adapterPath], bundle: true, format: "esm", outfile: outputPath, platform: "node", target: "node18" });
    const { adaptDifferentialTesting } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    const data = differentialTestingEmptyPayload();
    const before = structuredClone(data);
    const payload = adaptDifferentialTesting(data);
    assert.equal(payload.pageMode, "empty");
    assert.deepEqual(data, before);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
