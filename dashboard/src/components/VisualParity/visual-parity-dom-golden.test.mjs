import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { assertVisualParityData } from "../../../../ovens/visual-parity/contract.mjs";
import { visualParityFixture } from "./VisualParity.fixture.mjs";

const componentPath = new URL("./VisualParityView.tsx", import.meta.url).pathname;
const normalizerPath = new URL("../../oven/test-support/dom-normalize.ts", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const goldenDirectory = new URL("./goldens", import.meta.url).pathname;
const states = [
  { name: "visual-parity-target", selectedDomainId: "cars" },
  { name: "visual-parity-context", selectedDomainId: "world" },
];

test("visual-parity view static DOM matches frozen goldens", async () => {
  assert.doesNotThrow(() => assertVisualParityData(visualParityFixture));
  const outputDir = await mkdtemp(join(process.cwd(), ".visual-parity-dom-golden-test-"));
  try {
    const componentOutput = join(outputDir, "VisualParityView.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [componentPath], bundle: true, format: "esm", outfile: componentOutput, platform: "node", alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ VisualParityView }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${componentOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);

    for (const state of states) {
      const markup = renderToStaticMarkup(createElement(VisualParityView, {
        payload: visualParityFixture,
        selectedDomainId: state.selectedDomainId,
        error: "",
      }));
      const actual = serializeCanonical(normalize(parseHtml(markup)));
      const goldenPath = join(goldenDirectory, `${state.name}.golden.html`);
      try {
        const expected = (await readFile(goldenPath, "utf8")).replace(/\n$/u, "");
        assert.equal(actual, expected);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await mkdir(goldenDirectory, { recursive: true });
        const temporaryPath = `${goldenPath}.${process.pid}.tmp`;
        await writeFile(temporaryPath, `${actual}\n`);
        await rename(temporaryPath, goldenPath);
      }
    }
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
