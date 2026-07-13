import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  bindingStorePath,
  effectiveBindings,
  readBindingStore,
  removeBinding,
  writeBinding,
} from "./oven-bindings.mjs";

const BOUND_AT = "2026-07-14T12:00:00.000Z";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-bindings-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

test("binding stores round-trip logical paths atomically", () => {
  const { root, cleanup } = fixture();
  try {
    const result = writeBinding(root, "sample-oven", "../data/current.json", BOUND_AT);
    assert.equal(result.path, bindingStorePath(root));
    assert.deepEqual(readBindingStore(root), {
      schemaVersion: 1,
      bindings: { "sample-oven": { path: "../data/current.json", boundAt: BOUND_AT } },
    });
    assert.equal(removeBinding(root, "sample-oven"), true);
    assert.equal(removeBinding(root, "sample-oven"), false);
  } finally { cleanup(); }
});

test("missing, corrupt, and obsolete binding stores fail closed", () => {
  const { root, cleanup } = fixture();
  try {
    assert.deepEqual(readBindingStore(root), { schemaVersion: 1, bindings: {} });
    mkdirSync(join(root, ".local", "burnlist"), { recursive: true });
    writeFileSync(bindingStorePath(root), "not json");
    assert.deepEqual(quietly(() => readBindingStore(root)), { schemaVersion: 1, bindings: {} });
    writeFileSync(bindingStorePath(root), '{"schemaVersion":2,"bindings":{}}');
    assert.deepEqual(quietly(() => readBindingStore(root)), { schemaVersion: 1, bindings: {} });
  } finally { cleanup(); }
});

test("effective bindings re-read an atomically replaced store with an identical mtime", () => {
  const { root, cleanup } = fixture();
  try {
    const unchangedMtime = new Date("2026-07-14T12:02:00.000Z");
    writeBinding(root, "sample-oven", "first.json", BOUND_AT);
    utimesSync(bindingStorePath(root), unchangedMtime, unchangedMtime);
    const first = statSync(bindingStorePath(root));
    assert.equal(effectiveBindings({ repoRoots: [root] }).get("sample-oven").path, resolve(root, "first.json"));
    writeBinding(root, "sample-oven", "a-longer-second.json", "2026-07-14T12:01:00.000Z");
    utimesSync(bindingStorePath(root), unchangedMtime, unchangedMtime);
    const second = statSync(bindingStorePath(root));
    assert.equal(second.mtimeMs, first.mtimeMs);
    assert.notEqual(second.ino, first.ino);
    assert.notEqual(second.size, first.size);
    assert.notEqual(second.ctimeMs, first.ctimeMs);
    assert.equal(effectiveBindings({ repoRoots: [root] }).get("sample-oven").path, resolve(root, "a-longer-second.json"));
  } finally { cleanup(); }
});

test("effective bindings select the smallest repository root and let overrides win", () => {
  const { root, cleanup } = fixture();
  const first = join(root, "a-repo");
  const second = join(root, "b-repo");
  try {
    mkdirSync(first);
    mkdirSync(second);
    writeBinding(first, "sample-oven", "first.json", BOUND_AT);
    writeBinding(second, "sample-oven", "second.json", BOUND_AT);
    const persisted = effectiveBindings({ repoRoots: [second, first] }).get("sample-oven");
    assert.deepEqual(persisted, { path: resolve(first, "first.json"), repoRoot: first });
    const overridden = effectiveBindings({
      repoRoots: [first, second],
      override: new Map([["sample-oven", "/temporary/override.json"]]),
    }).get("sample-oven");
    assert.deepEqual(overridden, { path: "/temporary/override.json", repoRoot: null });
  } finally { cleanup(); }
});
