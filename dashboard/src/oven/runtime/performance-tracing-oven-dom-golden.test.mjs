import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { performanceTracingPayload } from "../differential-testing-render/golden-harness.mjs";

const runtimePath = new URL("./OvenRuntime.tsx", import.meta.url).pathname;
const adapterPath = new URL("../../lib/differential-testing-adapter.ts", import.meta.url).pathname;
const normalizerPath = new URL("../test-support/dom-normalize.ts", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
const FIXED_NOW = Date.parse("2026-01-01T12:30:00.000Z");
const states = [
  { name: "pt-main" },
  { name: "pt-progress", controls: { "value-mode": "current", "progress-mode": "progress" } },
  { name: "pt-failed", controls: { "value-mode": "current", "progress-mode": "failed" } },
];

function deterministicRender(render) {
  const previousTz = process.env.TZ;
  const previousDateNow = Date.now;
  const OriginalDTF = Intl.DateTimeFormat;
  const Shim = function DateTimeFormat(locales, options) {
    return new OriginalDTF(locales == null ? "en-US" : locales, { timeZone: "UTC", ...(options || {}) });
  };
  Shim.prototype = OriginalDTF.prototype;
  Object.setPrototypeOf(Shim, OriginalDTF);
  process.env.TZ = "UTC";
  Date.now = () => FIXED_NOW;
  globalThis.Intl.DateTimeFormat = Shim;
  try {
    return render();
  } finally {
    globalThis.Intl.DateTimeFormat = OriginalDTF;
    Date.now = previousDateNow;
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
}

test("PT oven equals the frozen normalized DOM state", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".pt-oven-dom-golden-test-"));
  try {
    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    const adapterOutput = join(outputDir, "differential-testing-adapter.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [runtimePath], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [adapterPath], bundle: true, format: "esm", outfile: adapterOutput, platform: "node", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const cacheKey = `?test=${Date.now()}`;
    const [{ OvenRuntime }, { adaptDifferentialTesting }, { domEquivalent, normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${pathToFileURL(runtimeOutput).href}${cacheKey}`),
      import(`${pathToFileURL(adapterOutput).href}${cacheKey}`),
      import(`${pathToFileURL(normalizerOutput).href}${cacheKey}`),
    ]);
    const source = await readFile("ovens/performance-tracing/performance-tracing.oven", "utf8");
    const compiled = compileOven(source, { file: "ovens/performance-tracing/performance-tracing.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;
    for (const state of states) {
      const markup = deterministicRender(() => renderToStaticMarkup(createElement(OvenRuntime, {
        ir: compiled.ir,
        payload: adaptDifferentialTesting(performanceTracingPayload()),
        controls: state.controls,
      })));
      const golden = await readFile(`dashboard/src/oven/differential-testing-render/goldens/${state.name}.html`, "utf8");
      const actual = serializeCanonical(normalize(parseHtml(markup)));
      const expected = serializeCanonical(normalize(parseHtml(golden)));
      const comparison = domEquivalent(markup, golden);
      assert.equal(comparison.equal, true, `${state.name}: ${comparison.message}`);
      assert.equal(actual, expected, `${state.name} differs`);
    }
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
