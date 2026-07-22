import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./OvenCatalog.tsx", import.meta.url).pathname;
const sourceDir = new URL("../..", import.meta.url).pathname;

async function loadView() {
  const outputDir = await mkdtemp(join(process.cwd(), ".oven-catalog-render-test-"));
  const outputPath = join(outputDir, "OvenCatalog.mjs");
  await build({
    entryPoints: [componentPath],
    bundle: true,
    format: "esm",
    outfile: outputPath,
    platform: "node",
    alias: {
      "@": sourceDir,
      "@components": join(sourceDir, "components"),
      "@layout": join(sourceDir, "layout"),
      "@lib": join(sourceDir, "lib"),
    },
    jsx: "automatic",
    packages: "external",
    target: "node18",
  });
  return {
    module: await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`),
    cleanup: () => rm(outputDir, { force: true, recursive: true }),
  };
}

function official(id, { maturity = "shipped", state = "unverified" } = {}) {
  return {
    id,
    version: "1.0.0",
    contract: `${id}@1`,
    dataInput: "json-payload",
    producer: `project-${id}-adapter`,
    routeKind: "repo-oven",
    maturity,
    acceptance: { state, evidenceClass: "canonical-oven", fixtureEvidence: "forbidden" },
    name: `${id} Oven`,
    description: `${id} official description`,
    ovenRevision: `o1-sha256:${"a".repeat(64)}`,
    origin: "official",
    repoKey: null,
    label: `${id}@1.0.0`,
    href: `/ovens/${id}`,
    maturityLabel: maturity[0].toUpperCase() + maturity.slice(1),
    acceptanceLabel: state[0].toUpperCase() + state.slice(1),
    agentInstructions: `Use official ${id}. Fixtures do not qualify.`,
  };
}

function local(id, origin, repoKey) {
  return {
    id,
    name: `${origin} ${id}`,
    version: "2.0.0",
    contract: `${id}@1`,
    description: `${origin} local description`,
    builtIn: origin === "vendored",
    origin,
    repoKey,
    dataInput: "json-payload",
    catalogRevision: null,
    label: `${id}@2.0.0`,
    href: `/ovens/${id}?repoKey=${repoKey}`,
    agentInstructions: `Use local ${origin} ${id}.`,
  };
}

test("the catalog view separates official membership, acceptance, and local inventory", async () => {
  const { module, cleanup } = await loadView();
  try {
    const markup = renderToStaticMarkup(createElement(module.OvenCatalogView, {
      catalogRevision: "b".repeat(64),
      official: [
        official("alpha"),
        official("retired", { maturity: "deprecated", state: "blocked" }),
      ],
      local: [
        local("alpha", "vendored", "aaaaaaaaaaaa"),
        local("workshop", "custom", "bbbbbbbbbbbb"),
      ],
      inventoryError: "",
    }));

    assert.match(markup, /Official Oven catalog/u);
    assert.match(markup, /2 official entries · revision b{12}/u);
    assert.match(markup, /Only these shipped definitions are official/u);
    assert.match(markup, /Acceptance: Unverified/u);
    assert.match(markup, /Deprecated/u);
    assert.match(markup, /Acceptance: Blocked/u);
    assert.match(markup, /project-alpha-adapter/u);
    assert.match(markup, /canonical-oven; fixtures forbidden/u);
    assert.match(markup, /Repository inventory/u);
    assert.match(markup, /Vendored/u);
    assert.match(markup, /Custom/u);
    assert.match(markup, /aaaaaaaaaaaa/u);
    assert.doesNotMatch(markup, />Built-in</u);
  } finally {
    await cleanup();
  }
});
