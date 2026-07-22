import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import "./built-in-handlers.mjs";
import {
  auditOfficialOvenInstall,
  loadOfficialOvenCatalog,
  officialOvenEntry,
  parseOfficialOvenCatalog,
} from "./official-oven-catalog.mjs";
import { listOvenHandlers } from "./oven-registry.mjs";

const ovensDir = resolve("ovens");
const sourceCatalog = JSON.parse(readFileSync(join(ovensDir, "catalog.json"), "utf8"));
const handlers = listOvenHandlers();
const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function installFixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-official-ovens-"));
  temporaryRoots.push(root);
  const target = join(root, "ovens");
  cpSync(ovensDir, target, { recursive: true });
  return target;
}

test("loads and freezes the exact shipped Oven catalog", () => {
  const catalog = loadOfficialOvenCatalog({ ovensDir, handlers });

  assert.deepEqual(catalog.entries.map(({ id }) => id), [
    "checklist",
    "differential-testing",
    "model-lab",
    "performance-tracing",
    "streaming-diff",
    "visual-parity",
  ]);
  assert.match(catalog.catalogRevision, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(catalog.entries[0].acceptance));
  assert.equal(officialOvenEntry(catalog, "visual-parity")?.producer, "project-visual-parity-adapter");
  assert.equal(officialOvenEntry(catalog, "not-official"), null);
});

test("normalizes semantically identical catalogs to one revision", () => {
  const reorderedKeys = {
    entries: sourceCatalog.entries.map((entry) => ({
      acceptance: { fixtureEvidence: entry.acceptance.fixtureEvidence, ...entry.acceptance },
      maturity: entry.maturity,
      routeKind: entry.routeKind,
      producer: entry.producer,
      dataInput: entry.dataInput,
      contract: entry.contract,
      version: entry.version,
      id: entry.id,
    })),
    catalogVersion: sourceCatalog.catalogVersion,
    schema: sourceCatalog.schema,
  };

  assert.equal(
    parseOfficialOvenCatalog(reorderedKeys).catalogRevision,
    parseOfficialOvenCatalog(sourceCatalog).catalogRevision,
  );
});

test("rejects unknown, missing, duplicate, unordered, and unsafe catalog values", () => {
  const cases = [
    ["unknown root key", (value) => { value.extra = true; }, /root keys are invalid/u],
    ["missing entry key", (value) => { delete value.entries[0].producer; }, /keys are invalid/u],
    ["duplicate id", (value) => { value.entries[1].id = value.entries[0].id; }, /unique/u],
    ["unordered ids", (value) => { [value.entries[0], value.entries[1]] = [value.entries[1], value.entries[0]]; }, /ordered/u],
    ["unsafe producer", (value) => { value.entries[0].producer = "../producer"; }, /producer is invalid/u],
    ["unknown data input", (value) => { value.entries[0].dataInput = "script"; }, /dataInput must be one of/u],
    ["executable evidence", (value) => { value.entries[0].acceptance.evidenceClass = "module"; }, /canonical-oven/u],
    ["fixture acceptance", (value) => { value.entries[0].acceptance.fixtureEvidence = "allowed"; }, /must be forbidden/u],
  ];

  for (const [label, mutate, pattern] of cases) {
    const value = clone(sourceCatalog);
    mutate(value);
    assert.throws(() => parseOfficialOvenCatalog(value), pattern, label);
  }
});

test("rejects unlisted package directories", () => {
  const target = installFixture();
  mkdirSync(join(target, "invented-oven"));

  assert.throws(
    () => loadOfficialOvenCatalog({ ovensDir: target, handlers }),
    /package directory ids must equal the catalog.*invented-oven/u,
  );
});

test("rejects package identity drift", () => {
  const target = installFixture();
  const catalog = clone(sourceCatalog);
  catalog.entries[0].contract = "wrong-contract@1";
  writeFileSync(join(target, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

  assert.throws(
    () => loadOfficialOvenCatalog({ ovensDir: target, handlers }),
    /checklist package identity does not match/u,
  );
});

test("rejects missing, orphan, duplicate, and mismatched handlers", () => {
  const catalog = parseOfficialOvenCatalog(sourceCatalog);
  const withoutChecklist = handlers.filter(({ id }) => id !== "checklist");
  const orphan = [...handlers, { id: "invented-oven", dataInput: "json-payload" }];
  const duplicate = [...handlers, handlers[0]];
  const mismatched = handlers.map((handler) => handler.id === "streaming-diff"
    ? { ...handler, dataInput: "json-payload" }
    : handler);

  assert.throws(
    () => auditOfficialOvenInstall({ catalog, ovensDir, handlers: withoutChecklist }),
    /registered handler ids must equal/u,
  );
  assert.throws(
    () => auditOfficialOvenInstall({ catalog, ovensDir, handlers: orphan }),
    /registered handler ids must equal/u,
  );
  assert.throws(
    () => auditOfficialOvenInstall({ catalog, ovensDir, handlers: duplicate }),
    /handler checklist is duplicated/u,
  );
  assert.throws(
    () => auditOfficialOvenInstall({ catalog, ovensDir, handlers: mismatched }),
    /streaming-diff handler dataInput does not match/u,
  );
});
