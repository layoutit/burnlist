import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";

const explainerPath = new URL("../OvenExplainer/OvenExplainerView.tsx", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const ovenSource = `<oven id="widget-oven" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <kpi-strip>
    <kpi-item variant="current" heading="Widget" title="/widget/name" value="/widget/count"/>
  </kpi-strip>
</oven>`;
const entry = {
  id: "widget-oven",
  name: "Widget Oven",
  version: "0.1.0",
  contract: "checklist-progress@1",
  inputContract: "checklist-progress@1",
  renderContract: "checklist-progress@1",
  description: "Shows widget progress.",
  builtIn: true,
  origin: "official",
  repoKey: null,
  dataInput: "json-payload",
  label: "widget-oven@0.1.0",
  href: "/ovens/widget-oven",
  agentInstructions: "Use the Widget Oven Oven (widget-oven@0.1.0).\nIts data must satisfy the checklist-progress@1 contract.\nInstall the shipped Oven in the target repository:\nburnlist oven use widget-oven\nProduce the required JSON data, then set it:\nburnlist oven set widget-oven <path>",
};
const sample = { widget: { name: "Sprockets", count: 42 } };

test("an Oven explainer renders catalog details and its sample-data demo", { timeout: 20_000 }, async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".oven-explainer-render-test-"));
  try {
    const explainerOutput = join(outputDir, "OvenExplainerView.mjs");
    await build({
      entryPoints: [explainerPath],
      bundle: true,
      format: "esm",
      outfile: explainerOutput,
      platform: "node",
      alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic",
      packages: "external",
      target: "node18",
    });
    const { OvenExplainerView } = await import(`${new URL(`file://${explainerOutput}`).href}?test=${Date.now()}`);
    const compiled = compileOven(ovenSource, { file: "widget-oven.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const markup = renderToStaticMarkup(createElement(OvenExplainerView, {
      entry,
      ir: compiled.ir,
      sample,
    }));
    assert.match(markup, /Widget Oven/u);
    assert.match(markup, /widget-oven@0\.0*1\.0/u);
    assert.match(markup, /checklist-progress@1/u);
    assert.match(markup, />Official</u);
    assert.match(markup, /Tell your agent/iu);
    assert.match(markup, /burnlist oven use widget-oven/u);
    assert.match(markup, /Demo \(sample data\)/iu);
    assert.match(markup, /Sprockets/u);
    assert.match(markup, />42</u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});

test("a vendored explainer preserves its origin, repository, and real live link", { timeout: 20_000 }, async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".oven-explainer-render-test-"));
  try {
    const explainerOutput = join(outputDir, "OvenExplainerView.mjs");
    await build({
      entryPoints: [explainerPath], bundle: true, format: "esm", outfile: explainerOutput,
      platform: "node", alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic", packages: "external", target: "node18",
    });
    const { OvenExplainerView } = await import(`${new URL(`file://${explainerOutput}`).href}?test=${Date.now()}`);
    const compiled = compileOven(ovenSource, { file: "widget-oven.oven" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const markup = renderToStaticMarkup(createElement(OvenExplainerView, {
      entry: { ...entry, builtIn: true, origin: "vendored", repoKey: "aaaaaaaaaaaa" },
      ir: compiled.ir,
      sample: null,
    }));
    assert.match(markup, />Vendored</u);
    assert.match(markup, /aaaaaaaaaaaa/u);
    assert.match(markup, /href="\/r\/aaaaaaaaaaaa\/o\/widget-oven"/u);
    assert.doesNotMatch(markup, />Built-in</u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});

test("an Oven explainer shows a docs-only demo when sample data is unavailable", { timeout: 20_000 }, async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".oven-explainer-render-test-"));
  try {
    const explainerOutput = join(outputDir, "OvenExplainerView.mjs");
    await build({
      entryPoints: [explainerPath],
      bundle: true,
      format: "esm",
      outfile: explainerOutput,
      platform: "node",
      alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic",
      packages: "external",
      target: "node18",
    });
    const { OvenExplainerView } = await import(`${new URL(`file://${explainerOutput}`).href}?test=${Date.now()}`);
    const compiled = compileOven(ovenSource, { file: "widget-oven.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const markup = renderToStaticMarkup(createElement(OvenExplainerView, {
      entry,
      ir: compiled.ir,
      sample: null,
    }));
    assert.doesNotMatch(markup, /Sprockets/u);
    assert.match(markup, /Demo \(sample data\)/iu);
    assert.match(markup, /sample data|unavailable|not available|requires/iu);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
