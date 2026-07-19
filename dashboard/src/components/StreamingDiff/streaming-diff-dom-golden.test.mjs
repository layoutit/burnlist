import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { streamingDiffFixture } from "./StreamingDiff.fixture.mjs";

const componentPath = new URL("./StreamingDiff.tsx", import.meta.url).pathname;
const normalizerPath = new URL("../../oven/test-support/dom-normalize.ts", import.meta.url).pathname;
const sourcePath = new URL("../../", import.meta.url).pathname;
const goldenPath = new URL("./streaming-diff-dom.golden.html", import.meta.url);
const ovenPath = new URL("../../../../ovens/streaming-diff/streaming-diff.oven", import.meta.url).pathname;

const ovenIrPlugin = {
  name: "oven-ir",
  setup(build) {
    build.onResolve({ filter: /streaming-diff\.ir\.json$/ }, () => ({ path: ovenPath, namespace: "oven-ir" }));
    build.onLoad({ filter: /.*/, namespace: "oven-ir" }, () => {
      const compiled = compileOven(readFileSync(ovenPath, "utf8"), { file: "ovens/streaming-diff/streaming-diff.oven" });
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      return { contents: `export default ${JSON.stringify(compiled.ir)};`, loader: "js" };
    });
  },
};

test("selected streaming-diff static DOM matches the frozen byte golden", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".streaming-diff-dom-golden-test-"));
  try {
    const componentOutput = join(outputDir, "StreamingDiff.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({
        entryPoints: [componentPath],
        bundle: true,
        format: "esm",
        outfile: componentOutput,
        platform: "node",
        alias: {
          "@": sourcePath,
          "@components": new URL("../../components", import.meta.url).pathname,
          "@hooks": new URL("../../hooks", import.meta.url).pathname,
          "@layout": new URL("../../layout", import.meta.url).pathname,
          "@lib": new URL("../../lib", import.meta.url).pathname,
          "@oven": new URL("../../oven", import.meta.url).pathname,
        },
        jsx: "automatic",
        packages: "external",
        plugins: [ovenIrPlugin],
        target: "node18",
      }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ SelectedFeed }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${componentOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);
    const backHref = `/ovens/streaming-diff/view?repoKey=${encodeURIComponent(streamingDiffFixture.identity.logicalRepoKey)}`;
    const markup = renderToStaticMarkup(createElement(SelectedFeed, {
      backHref,
      cards: streamingDiffFixture.cards,
      error: "",
      session: streamingDiffFixture.identity.session,
    }));
    const actual = serializeCanonical(normalize(parseHtml(markup)));
    const expected = (await readFile(goldenPath, "utf8")).trimEnd();
    assert.equal(actual, expected);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
