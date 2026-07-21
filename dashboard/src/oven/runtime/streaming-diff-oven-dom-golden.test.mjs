import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { streamingDiffFixture } from "../../components/StreamingDiff/StreamingDiff.fixture.mjs";
import { withDeterministicTime } from "../test-support/deterministic-time.mjs";

const runtimePath = new URL("./OvenRuntime.tsx", import.meta.url).pathname;
const adapterPath = new URL("../../lib/streaming-diff-oven-adapter.ts", import.meta.url).pathname;
const normalizerPath = new URL("../test-support/dom-normalize.ts", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;

test("streaming-diff oven equals the frozen DOM golden", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".streaming-diff-oven-dom-golden-test-"));
  try {
    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    const adapterOutput = join(outputDir, "streaming-diff-oven-adapter.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [runtimePath], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [adapterPath], bundle: true, format: "esm", outfile: adapterOutput, platform: "node", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ OvenRuntime }, { adaptStreamingDiff }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${runtimeOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${adapterOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);
    const source = await readFile("ovens/streaming-diff/streaming-diff.oven", "utf8");
    const compiled = compileOven(source, { file: "ovens/streaming-diff/streaming-diff.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const markup = withDeterministicTime(() => renderToStaticMarkup(createElement(OvenRuntime, { ir: compiled.ir, payload: adaptStreamingDiff(streamingDiffFixture) })));
    const actual = serializeCanonical(normalize(parseHtml(markup)));
    const expected = (await readFile("dashboard/src/components/StreamingDiff/streaming-diff-dom.golden.html", "utf8")).trimEnd();
    assert.equal(actual, expected);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
