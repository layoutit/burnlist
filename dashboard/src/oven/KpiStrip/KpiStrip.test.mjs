import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./KpiStrip.tsx", import.meta.url).pathname;
let outputDir;
let KpiStrip;

before(async () => {
  outputDir = await mkdtemp(join(process.cwd(), ".kpi-strip-test-"));
  const outputPath = join(outputDir, "KpiStrip.mjs");
  await build({
    entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
    jsx: "automatic", packages: "external", target: "node18",
  });
  ({ KpiStrip } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`));
});

after(async () => {
  await rm(outputDir, { force: true, recursive: true });
});

test("KpiStrip preserves exact attributes and child output", () => {
  const strip = createElement(KpiStrip, {
    ariaLabel: "Burnlist progress KPIs",
    className: "driving-parity-kpi-strip has-burns checklist-kpi-strip",
    children: "CHILD",
  });
  const expected = "<div aria-label=\"Burnlist progress KPIs\" class=\"driving-parity-kpi-strip has-burns checklist-kpi-strip\">CHILD</div>";

  assert.equal(renderToStaticMarkup(strip), expected);
  assert.equal(renderToString(strip), expected);
});

test("KpiStrip omits an undefined aria-label attribute", () => {
  const markup = renderToStaticMarkup(createElement(KpiStrip, { className: "checklist-kpi-strip" }));

  assert.doesNotMatch(markup, / aria-label=/u);
});
