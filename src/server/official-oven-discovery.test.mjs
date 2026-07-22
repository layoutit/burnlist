import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import "../ovens/built-in-handlers.mjs";
import { compileOven } from "../ovens/dsl/oven-compile.mjs";
import { listOvenHandlers } from "../ovens/oven-registry.mjs";
import { createOfficialOvenDiscovery } from "./official-oven-discovery.mjs";

const ovensDir = resolve("ovens");

function packageReader(root, id) {
  const oven = readFileSync(join(root, id, `${id}.oven`), "utf8");
  return { id, builtIn: true, oven, ir: compileOven(oven).ir };
}

test("official server discovery materializes only catalog entries with origin metadata", () => {
  const discovery = createOfficialOvenDiscovery({
    ovensDir,
    handlers: listOvenHandlers(),
    readOven: packageReader,
  });
  const ovens = discovery.discover();

  assert.deepEqual(ovens.map(({ id }) => id), discovery.catalog.entries.map(({ id }) => id));
  assert.ok(ovens.every(({ origin }) => origin === "official"));
  assert.ok(ovens.every(({ repoKey, repoRoot }) => repoKey === null && repoRoot === null));
  assert.equal(new Set(ovens.map(({ catalogRevision }) => catalogRevision)).size, 1);
  assert.equal(discovery.find("not-official"), null);
});

test("official server discovery fails if a validated package changes before materialization", () => {
  const discovery = createOfficialOvenDiscovery({
    ovensDir,
    handlers: listOvenHandlers(),
    readOven(root, id, builtIn) {
      const oven = packageReader(root, id, builtIn);
      return id === "checklist" ? { ...oven, ir: { ...oven.ir, version: "9.9.9" } } : oven;
    },
  });

  assert.throws(() => discovery.find("checklist"), /changed after catalog validation/u);
});

test("official server discovery fails instead of returning a partial catalog", () => {
  const discovery = createOfficialOvenDiscovery({
    ovensDir,
    handlers: listOvenHandlers(),
    readOven(root, id, builtIn) {
      return id === "visual-parity" ? null : packageReader(root, id, builtIn);
    },
  });

  assert.throws(() => discovery.discover(), /Official Oven visual-parity is unavailable/u);
});
