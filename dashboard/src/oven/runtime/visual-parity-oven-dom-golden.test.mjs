import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { visualParityFixture } from "../../components/VisualParity/VisualParity.fixture.mjs";

const runtimePath = new URL("./OvenRuntime.tsx", import.meta.url).pathname;
const adapterPath = new URL("../../lib/visual-parity-oven-adapter.ts", import.meta.url).pathname;
const normalizerPath = new URL("../test-support/dom-normalize.ts", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;

const states = [
  { name: "target", id: "cars", golden: "dashboard/src/components/VisualParity/goldens/visual-parity-target.golden.html" },
  { name: "context", id: "world", golden: "dashboard/src/components/VisualParity/goldens/visual-parity-context.golden.html" },
];

test("visual-parity oven equals the frozen DOM golden states", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".visual-parity-oven-dom-golden-test-"));
  try {
    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    const adapterOutput = join(outputDir, "visual-parity-oven-adapter.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [runtimePath], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [adapterPath], bundle: true, format: "esm", outfile: adapterOutput, platform: "node", alias: { "@lib": libPath }, target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ OvenRuntime }, { adaptVisualParity }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${runtimeOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${adapterOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);
    const source = await readFile("ovens/visual-parity/visual-parity.oven", "utf8");
    const compiled = compileOven(source, { file: "ovens/visual-parity/visual-parity.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const committedIr = JSON.parse(await readFile("ovens/visual-parity/visual-parity.ir.json", "utf8"));
    assert.deepEqual(committedIr, compiled.ir);
    for (const state of states) {
      const markup = renderToStaticMarkup(createElement(OvenRuntime, {
        ir: compiled.ir,
        payload: adaptVisualParity(visualParityFixture),
        controls: { "domain-select": state.id },
      }));
      const actual = serializeCanonical(normalize(parseHtml(markup)));
      const expected = serializeCanonical(normalize(parseHtml((await readFile(state.golden, "utf8")).trimEnd())));
      assert.equal(actual, expected, `${state.name} differs`);
    }
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
