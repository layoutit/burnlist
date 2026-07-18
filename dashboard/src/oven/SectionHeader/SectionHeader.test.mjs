import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./SectionHeader.tsx", import.meta.url).pathname;

test("SectionHeader keeps count and child markup stable", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".section-header-test-"));
  try {
    const outputPath = join(outputDir, "SectionHeader.mjs");
    await build({
      entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
      jsx: "automatic", packages: "external", target: "node18",
    });
    const { SectionHeader } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);

    assert.equal(
      renderToStaticMarkup(createElement(SectionHeader, { title: "Events", count: 3 })),
      `<h2>Events <span class="field-list-count">(3)</span></h2>`,
    );
    assert.equal(
      renderToStaticMarkup(createElement(SectionHeader, { title: "Fields List", count: 12 })),
      `<h2>Fields List <span class="field-list-count">(12)</span></h2>`,
    );
    assert.equal(
      renderToStaticMarkup(createElement(SectionHeader, {
        title: "Events", count: 3, children: createElement("span", { className: "custom-count" }, "(custom)"),
      })),
      `<h2>Events <span class="custom-count">(custom)</span></h2>`,
    );
    assert.equal(
      renderToStaticMarkup(createElement(SectionHeader, { title: "Events", count: 3, className: "events-heading" })),
      `<h2 class="events-heading">Events <span class="field-list-count">(3)</span></h2>`,
    );

    function ReferenceSectionHeader({ title, count }) {
      return createElement("h2", null, `${title} `, createElement("span", { className: "field-list-count" }, "(", count, ")"));
    }

    const sectionHeaderOutput = renderToString(createElement(SectionHeader, { title: "Events", count: 3 }));
    const referenceOutput = renderToString(createElement(ReferenceSectionHeader, { title: "Events", count: 3 }));
    assert.equal(sectionHeaderOutput, referenceOutput);
    assert.match(sectionHeaderOutput, /^<h2>Events <span class="field-list-count">/u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
