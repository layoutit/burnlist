import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

test("every component-bearing Oven kind resolves to an exported production owner", async () => {
  const inventory = await readJson("dashboard/src/oven-component-inventory.json");
  const manifest = await readJson("tui/src/oven-runtime/components/production-component-owners.json");
  assert.equal(manifest.schema, "burnlist-terminal-production-owners@1");
  const expected = inventory.entries.filter((entry) => entry.componentBearing).map((entry) => entry.kind).sort();
  assert.deepEqual(Object.keys(manifest.owners).sort(), expected);
  for (const [kind, reference] of Object.entries(manifest.owners)) {
    const [path, name] = reference.split("#");
    assert.ok(path && name, `${kind} has an invalid production reference`);
    assert.doesNotMatch(path, /\/catalog\//u, `${kind} is owned by catalog-only code`);
    const source = await readFile(resolve(root, path), "utf8");
    assert.match(source, new RegExp(`export (?:class |function |const )${name}\\b`, "u"), `${kind} owner ${name} is not exported`);
  }
});

test("canonical Playground composites consume the same production models as admitted Ovens", async () => {
  const coverage = await readJson("dashboard/src/terminal-component-coverage.json");
  const manifest = await readJson("tui/src/oven-runtime/components/production-component-owners.json");
  const required = ["field-list-cards", "top-card", "kpi-strip", "kpi-item", "metric-tiles", "table", "line-chart", "progress-donut", "burn-donut", "waffle-metric", "visual-parity-media"];
  for (const id of required) {
    assert.ok(coverage.entries.some((entry) => entry.id === id), `${id} is absent from canonical Playground coverage`);
    assert.ok(manifest.pairedModels[id], `${id} has no production model`);
  }
  const catalog = await readFile(resolve(root, "tui/src/catalog/component-pair-live-model.ts"), "utf8");
  const catalogComposition = `${catalog}\n${await readFile(resolve(root, "tui/src/oven-runtime/components/paired-cell.ts"), "utf8")}`;
  for (const reference of new Set(Object.values(manifest.pairedModels))) {
    const [path, name] = reference.split("#");
    const source = await readFile(resolve(root, path), "utf8");
    assert.match(source, new RegExp(`export (?:class |function |const )${name}\\b`, "u"));
    assert.match(catalogComposition, new RegExp(`\\b${name}\\b`, "u"), `${name} is not consumed by the live Storybook adapter`);
  }
  for (const path of ["component-cell-canvas.ts", "component-pair-composition.ts"]) {
    const shim = await readFile(resolve(root, `tui/src/catalog/${path}`), "utf8");
    assert.match(shim, /^export \* from "\.\.\/oven-runtime\/components\/paired-cell";\s*$/u);
  }
});
