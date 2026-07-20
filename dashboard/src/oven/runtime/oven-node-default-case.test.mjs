import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const ovenNodePath = new URL("./OvenNode.tsx", import.meta.url).pathname;
const reducerPath = new URL("./oven-reducer.ts", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;

const ir = {
  contract: "test",
  controls: [{ id: "mode", kind: "mode-toggle", initial: "one" }],
  collections: [],
  root: [],
};

const payload = { nonMatch: "NON_MATCH", def: "DEFAULT_BRANCH" };
const item = (source) => ({
  kind: "kpi-item",
  attributes: { heading: "item", source },
  bindings: {},
  children: [],
});

const node = {
  kind: "switch",
  attributes: { modeFrom: "mode" },
  children: [
    {
      kind: "case",
      attributes: { value: "two" },
      children: [item("/nonMatch")],
    },
    {
      kind: "case",
      attributes: { default: true },
      children: [item("/def")],
    },
  ],
};

test("OvenNode switch renders a default case when no mode value matches", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".oven-node-default-case-test-"));
  try {
    const ovenNodeOutput = join(outputDir, "OvenNode.mjs");
    const reducerOutput = join(outputDir, "oven-reducer.mjs");
    const config = {
      bundle: true,
      format: "esm",
      platform: "node",
      alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic",
      packages: "external",
      target: "node18",
    };
    await Promise.all([
      build({ ...config, entryPoints: [ovenNodePath], outfile: ovenNodeOutput }),
      build({ ...config, entryPoints: [reducerPath], outfile: reducerOutput }),
    ]);
    const cacheKey = `?test=${Date.now()}`;
    const [{ OvenNode }, { initOvenState }] = await Promise.all([
      import(`${pathToFileURL(ovenNodeOutput).href}${cacheKey}`),
      import(`${pathToFileURL(reducerOutput).href}${cacheKey}`),
    ]);
    const state = initOvenState(ir, payload);
    const markup = renderToStaticMarkup(createElement(OvenNode, {
      node,
      ir,
      state,
      dispatch: () => {},
    }));

    assert.ok(markup.includes("DEFAULT_BRANCH"));
    assert.ok(!markup.includes("NON_MATCH"));
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
