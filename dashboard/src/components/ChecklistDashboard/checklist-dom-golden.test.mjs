import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { checklistFixture } from "./ChecklistDashboard.fixture.mjs";

const componentPath = new URL("./ChecklistDashboard.tsx", import.meta.url).pathname;
const normalizerPath = new URL("../../oven/test-support/dom-normalize.ts", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const goldenPath = new URL("./checklist-dom.golden.html", import.meta.url);

test("checklist detail static DOM matches the frozen byte golden", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-dom-golden-test-"));
  try {
    const componentOutput = join(outputDir, "ChecklistDashboard.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [componentPath], bundle: true, format: "esm", outfile: componentOutput, platform: "node", alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ ChecklistDashboard }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${componentOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);
    const markup = renderToStaticMarkup(createElement(ChecklistDashboard, { data: checklistFixture }));
    const actual = serializeCanonical(normalize(parseHtml(markup)));
    const expected = (await readFile(goldenPath, "utf8")).replace(/\n$/u, "");
    assert.equal(actual, expected);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
