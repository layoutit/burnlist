import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { COMPONENTS, ELEMENTS } from "../src/ovens/dsl/oven-grammar.mjs";

const root = resolve(import.meta.dirname, "..");
const sorted = (values) => [...values].sort();

test("Oven grammar and official tags have a finite paired-component classification", async () => {
  const inventory = JSON.parse(await readFile(resolve(root, "dashboard/src/oven-component-inventory.json"), "utf8"));
  const coverage = JSON.parse(await readFile(resolve(root, "dashboard/src/terminal-component-coverage.json"), "utf8"));
  assert.equal(inventory.schema, "burnlist-oven-component-inventory@1");
  assert.deepEqual(sorted(inventory.entries.map((entry) => entry.kind)), sorted(Object.keys(ELEMENTS)));
  assert.equal(new Set(inventory.entries.map((entry) => entry.kind)).size, inventory.entries.length);

  const officialTags = new Set();
  const ovenRoot = resolve(root, "ovens");
  for (const directory of await readdir(ovenRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const path = resolve(ovenRoot, directory.name, `${directory.name}.oven`);
    let source;
    try { source = await readFile(path, "utf8"); } catch { continue; }
    for (const match of source.matchAll(/<\/?([a-z][a-z0-9-]*)\b/gu)) officialTags.add(match[1]);
  }

  const paired = new Set(coverage.entries.map((entry) => entry.id));
  const classes = new Set(["root", "structural", "control", "primitive", "composite"]);
  for (const entry of inventory.entries) {
    assert.ok(classes.has(entry.classification), `${entry.kind} has an unknown classification`);
    assert.equal(entry.componentBearing, COMPONENTS.has(entry.kind), `${entry.kind} component-bearing state is stale`);
    assert.equal(entry.official, officialTags.has(entry.kind), `${entry.kind} official usage is stale`);
    assert.ok(typeof entry.rationale === "string" && entry.rationale.length > 20, `${entry.kind} lacks an explicit rationale`);
    assert.ok(paired.has(entry.coveredBy), `${entry.kind} is not covered by a canonical paired component`);
  }
  assert.deepEqual(sorted([...officialTags]), sorted(inventory.entries.filter((entry) => entry.official).map((entry) => entry.kind)));
  assert.deepEqual(sorted([...COMPONENTS]), sorted(inventory.entries.filter((entry) => entry.componentBearing).map((entry) => entry.kind)));
});
