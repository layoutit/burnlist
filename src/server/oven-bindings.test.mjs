import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  bindingStorePath,
  effectiveBindings,
  readBindingStore,
  removeBinding,
  writeBinding,
  writeBindingIfAbsent,
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

test("writeBindingIfAbsent preserves the first binding", () => {
  const { root, cleanup } = fixture();
  try {
    const first = writeBindingIfAbsent(root, "sample-oven", "first.json", BOUND_AT);
    const second = writeBindingIfAbsent(root, "sample-oven", "second.json", "2026-07-14T12:01:00.000Z");
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.deepEqual(readBindingStore(root).bindings["sample-oven"], { path: "first.json", boundAt: BOUND_AT });
  } finally { cleanup(); }
});

test("barrier-synchronized first writers create exactly one binding and preserve its path", async () => {
  const { root, cleanup } = fixture();
  const ready = join(root, "ready");
  const go = join(root, "go");
  const moduleUrl = new URL("./oven-bindings.mjs", import.meta.url).href;
  const child = (logicalPath) => new Promise((resolveChild, reject) => {
    const source = `import { existsSync, writeFileSync } from "node:fs"; import { writeBindingIfAbsent } from ${JSON.stringify(moduleUrl)}; const [root, path, ready, go] = process.argv.slice(1); writeFileSync(ready + "-" + process.pid, ""); while (!existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); process.stdout.write(JSON.stringify(writeBindingIfAbsent(root, "sample-oven", path, "${BOUND_AT}")));`;
    const processChild = spawn(process.execPath, ["--input-type=module", "--eval", source, root, logicalPath, ready, go], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    processChild.stdout.on("data", (chunk) => { stdout += chunk; });
    processChild.stderr.on("data", (chunk) => { stderr += chunk; });
    processChild.on("error", reject);
    processChild.on("exit", (status) => status === 0 ? resolveChild(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
  try {
    const first = child("first.json");
    const second = child("second.json");
    for (let attempt = 0; attempt < 100 && readdirSync(root).filter((name) => name.startsWith("ready-")).length < 2; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    assert.equal(readdirSync(root).filter((name) => name.startsWith("ready-")).length, 2);
    // Both children are waiting at the same barrier before either can write.
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    writeFileSync(go, "go");
    const results = await Promise.all([first, second]);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(readBindingStore(root).bindings["sample-oven"].path, results.find((result) => result.created).binding.path);
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

test("binding mutations preserve malformed stores and create or update valid stores", () => {
  const { root, cleanup } = fixture();
  const path = bindingStorePath(root);
  try {
    const missing = writeBinding(root, "sample-oven", "created.json", BOUND_AT);
    assert.deepEqual(missing.binding, { path: "created.json", boundAt: BOUND_AT });
    writeBinding(root, "sample-oven", "updated.json", "2026-07-14T12:01:00.000Z");
    assert.deepEqual(readBindingStore(root).bindings["sample-oven"], { path: "updated.json", boundAt: "2026-07-14T12:01:00.000Z" });
    const malformed = '{"schemaVersion":1,"bindings":{"other-oven":';
    writeFileSync(path, malformed);
    assert.throws(() => writeBinding(root, "sample-oven", "lost.json", BOUND_AT), /Refusing to modify malformed Oven binding store/u);
    assert.equal(readFileSync(path, "utf8"), malformed);
    assert.throws(() => removeBinding(root, "sample-oven"), /Refusing to modify malformed Oven binding store/u);
    assert.equal(readFileSync(path, "utf8"), malformed);
    assert.throws(() => writeBindingIfAbsent(root, "sample-oven", "lost.json", BOUND_AT), /Refusing to modify malformed Oven binding store/u);
    writeFileSync(path, '{"schemaVersion":2,"bindings":{}}');
    assert.throws(() => writeBindingIfAbsent(root, "sample-oven", "lost.json", BOUND_AT), /Refusing to modify malformed Oven binding store/u);
  } finally { cleanup(); }
});

test("effective bindings re-read an atomically replaced store with an identical mtime", () => {
  const { root, cleanup } = fixture();
  try {
    const unchangedMtime = new Date("2026-07-14T12:02:00.000Z");
    writeBinding(root, "sample-oven", "first.json", BOUND_AT);
    utimesSync(bindingStorePath(root), unchangedMtime, unchangedMtime);
    const first = statSync(bindingStorePath(root));
    assert.equal(effectiveBindings({ repoRoots: [root] }).get("sample-oven")[0].path, resolve(root, "first.json"));
    writeBinding(root, "sample-oven", "a-longer-second.json", "2026-07-14T12:01:00.000Z");
    utimesSync(bindingStorePath(root), unchangedMtime, unchangedMtime);
    const second = statSync(bindingStorePath(root));
    assert.equal(second.mtimeMs, first.mtimeMs);
    assert.notEqual(second.ino, first.ino);
    assert.notEqual(second.size, first.size);
    assert.notEqual(second.ctimeMs, first.ctimeMs);
    assert.equal(effectiveBindings({ repoRoots: [root] }).get("sample-oven")[0].path, resolve(root, "a-longer-second.json"));
  } finally { cleanup(); }
});

test("effective bindings retain every repository binding and append global overrides", () => {
  const { root, cleanup } = fixture();
  const first = join(root, "a-repo");
  const second = join(root, "b-repo");
  try {
    mkdirSync(first);
    mkdirSync(second);
    writeBinding(first, "sample-oven", "first.json", BOUND_AT);
    writeBinding(second, "sample-oven", "second.json", BOUND_AT);
    const persisted = effectiveBindings({ repoRoots: [second, first] }).get("sample-oven");
    assert.deepEqual(persisted.map(({ path, repoRoot }) => ({ path, repoRoot })), [
      { path: resolve(first, "first.json"), repoRoot: first },
      { path: resolve(second, "second.json"), repoRoot: second },
    ]);
    const overridden = effectiveBindings({
      repoRoots: [first, second],
      override: new Map([["sample-oven", "/temporary/override.json"]]),
    }).get("sample-oven");
    assert.deepEqual(overridden.map(({ path, repoRoot }) => ({ path, repoRoot })), [
      { path: resolve(first, "first.json"), repoRoot: first },
      { path: resolve(second, "second.json"), repoRoot: second },
      { path: "/temporary/override.json", repoRoot: null },
    ]);
    assert.equal(overridden.at(-1).repoKey, null);
  } finally { cleanup(); }
});

test("effective bindings skip an unreadable repository store without hiding healthy bindings", () => {
  const { root, cleanup } = fixture();
  const bad = join(root, "bad-repo");
  const good = join(root, "good-repo");
  try {
    mkdirSync(bad);
    mkdirSync(good);
    mkdirSync(bindingStorePath(bad), { recursive: true });
    writeBinding(good, "sample-oven", "good.json", BOUND_AT);
    const bindings = quietly(() => effectiveBindings({ repoRoots: [bad, good] }));
    assert.deepEqual(bindings.get("sample-oven").map((entry) => entry.repoRoot), [good]);
  } finally { cleanup(); }
});
