import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { checklistFixture } from "../../components/ChecklistDashboard/ChecklistDashboard.fixture.mjs";
import { withDeterministicTime } from "../test-support/deterministic-time.mjs";

const runtimePath = new URL("./OvenRuntime.tsx", import.meta.url).pathname;
const adapterPath = new URL("../../lib/checklist-adapter.ts", import.meta.url).pathname;
const normalizerPath = new URL("../test-support/dom-normalize.ts", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;

test("checklist oven equals the frozen DOM golden", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-oven-golden-test-"));
  try {
    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    const adapterOutput = join(outputDir, "checklist-adapter.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [runtimePath], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [adapterPath], bundle: true, format: "esm", outfile: adapterOutput, platform: "node", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ OvenRuntime }, { adaptChecklist }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${runtimeOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${adapterOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);
    const source = await readFile("ovens/checklist/checklist.oven", "utf8");
    const compiled = compileOven(source, { file: "ovens/checklist/checklist.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const markup = withDeterministicTime(() => renderToStaticMarkup(createElement(OvenRuntime, { ir: compiled.ir, payload: adaptChecklist(checklistFixture) })));
    const actual = serializeCanonical(normalize(parseHtml(markup)));
    const expected = (await readFile("dashboard/src/components/ChecklistDashboard/checklist-dom.golden.html", "utf8")).trimEnd();
    assert.equal(actual, expected);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
