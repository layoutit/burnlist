import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { bindingStorePath, readBindingStore, writeBinding } from "./oven-bindings.mjs";
import {
  canonicalOvenDataPath,
  publishOvenData,
} from "./oven-data-store.mjs";

const FIRST_AT = "2026-07-22T00:00:00.000Z";
const SECOND_AT = "2026-07-22T00:01:00.000Z";
const firstBytes = '{"version":1,"items":["old"]}\n';
const secondBytes = '{"version":2,"items":["new"]}\n';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-data-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function mode(path) {
  return lstatSync(path).mode & 0o777;
}

test("fresh publication writes private canonical data and its binding", (t) => {
  const root = fixture(t);
  const result = publishOvenData(root, "sample-oven", firstBytes, FIRST_AT);

  assert.equal(result.changed, true);
  assert.equal(result.dataPath, canonicalOvenDataPath(root, "sample-oven"));
  assert.equal(readFileSync(result.dataPath, "utf8"), firstBytes);
  assert.equal(mode(result.dataPath), 0o600);
  assert.equal(mode(dirname(result.dataPath)), 0o700);
  assert.deepEqual(readBindingStore(root).bindings["sample-oven"], {
    path: ".local/burnlist/data/sample-oven.json",
    boundAt: FIRST_AT,
  });
  assert.equal(mode(bindingStorePath(root)), 0o600);
  assert.deepEqual(readdirSync(dirname(result.dataPath)).sort(), ["sample-oven.json"]);
});

test("publishing identical canonical state is idempotent", (t) => {
  const root = fixture(t);
  publishOvenData(root, "sample-oven", firstBytes, FIRST_AT);
  const beforeData = lstatSync(canonicalOvenDataPath(root, "sample-oven"));
  const beforeBinding = readFileSync(bindingStorePath(root), "utf8");

  const result = publishOvenData(root, "sample-oven", firstBytes, SECOND_AT);

  assert.equal(result.changed, false);
  assert.equal(lstatSync(result.dataPath).ino, beforeData.ino);
  assert.equal(readFileSync(bindingStorePath(root), "utf8"), beforeBinding);
  assert.equal(result.binding.boundAt, FIRST_AT);
});

test("publication replaces a noncanonical binding without touching its source", (t) => {
  const root = fixture(t);
  const oldPath = join(root, "reports", "old.json");
  mkdirSync(dirname(oldPath), { recursive: true });
  writeFileSync(oldPath, firstBytes);
  writeBinding(root, "sample-oven", "reports/old.json", FIRST_AT);

  publishOvenData(root, "sample-oven", secondBytes, SECOND_AT);

  assert.equal(readFileSync(oldPath, "utf8"), firstBytes);
  assert.equal(readFileSync(canonicalOvenDataPath(root, "sample-oven"), "utf8"), secondBytes);
  assert.deepEqual(readBindingStore(root).bindings["sample-oven"], {
    path: ".local/burnlist/data/sample-oven.json",
    boundAt: SECOND_AT,
  });
});

test("publication boundaries expose only complete old or new files", (t) => {
  const root = fixture(t);
  publishOvenData(root, "sample-oven", firstBytes, FIRST_AT);
  const dataPath = canonicalOvenDataPath(root, "sample-oven");
  const observed = [];

  publishOvenData(root, "sample-oven", secondBytes, SECOND_AT, { hooks: {
    beforeDataRename() { observed.push(readFileSync(dataPath, "utf8")); },
    afterDataRename() { observed.push(readFileSync(dataPath, "utf8")); },
    beforeBindingPublish() { observed.push(readFileSync(dataPath, "utf8")); },
    afterBindingRename() { observed.push(readFileSync(dataPath, "utf8")); },
  } });

  assert.deepEqual(observed, [firstBytes, secondBytes, secondBytes, secondBytes]);
});

for (const boundary of [
  "beforeDataRename",
  "afterDataRename",
  "beforeBindingPublish",
  "afterBindingRename",
]) {
  test(`an injected ${boundary} failure restores exact prior bytes and binding`, (t) => {
    const root = fixture(t);
    publishOvenData(root, "sample-oven", firstBytes, FIRST_AT);
    const dataPath = canonicalOvenDataPath(root, "sample-oven");
    const bindingPath = bindingStorePath(root);
    const priorData = readFileSync(dataPath);
    const priorBinding = readFileSync(bindingPath);

    assert.throws(() => publishOvenData(root, "sample-oven", secondBytes, SECOND_AT, {
      hooks: { [boundary]() { throw new Error(`injected ${boundary}`); } },
    }), new RegExp(`injected ${boundary}`, "u"));

    assert.deepEqual(readFileSync(dataPath), priorData);
    assert.deepEqual(readFileSync(bindingPath), priorBinding);
    assert.deepEqual(readdirSync(dirname(dataPath)).sort(), ["sample-oven.json"]);
  });
}

test("a failed fresh publication leaves no data or binding", (t) => {
  const root = fixture(t);
  assert.throws(() => publishOvenData(root, "sample-oven", firstBytes, FIRST_AT, {
    hooks: { afterBindingRename() { throw new Error("fresh binding failure"); } },
  }), /fresh binding failure/u);
  assert.equal(existsSync(canonicalOvenDataPath(root, "sample-oven")), false);
  assert.equal(existsSync(bindingStorePath(root)), false);
});

test("a failed transaction commit restores existing and fresh publication state", (t) => {
  const existing = fixture(t);
  publishOvenData(existing, "sample-oven", firstBytes, FIRST_AT);
  const priorData = readFileSync(canonicalOvenDataPath(existing, "sample-oven"));
  const priorBinding = readFileSync(bindingStorePath(existing));

  assert.throws(() => publishOvenData(existing, "sample-oven", secondBytes, SECOND_AT, {
    commit() { throw new Error("composite commit failed"); },
  }), /composite commit failed/u);
  assert.deepEqual(readFileSync(canonicalOvenDataPath(existing, "sample-oven")), priorData);
  assert.deepEqual(readFileSync(bindingStorePath(existing)), priorBinding);

  const fresh = fixture(t);
  assert.throws(() => publishOvenData(fresh, "sample-oven", firstBytes, FIRST_AT, {
    commit() { throw new Error("fresh composite commit failed"); },
  }), /fresh composite commit failed/u);
  assert.equal(existsSync(canonicalOvenDataPath(fresh, "sample-oven")), false);
  assert.equal(existsSync(bindingStorePath(fresh)), false);
});

test("publication rejects invalid input and contained-path escapes before mutation", (t) => {
  const root = fixture(t);
  assert.throws(() => publishOvenData(root, "../escape", firstBytes, FIRST_AT), /lowercase slug/u);
  assert.throws(() => publishOvenData(root, "sample-oven", "not JSON", FIRST_AT), /valid JSON/u);

  const outside = fixture(t);
  const dataDir = join(root, ".local", "burnlist", "data");
  mkdirSync(dirname(dataDir), { recursive: true });
  symlinkSync(outside, dataDir);
  assert.throws(() => publishOvenData(root, "sample-oven", firstBytes, FIRST_AT), /escapes/u);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(existsSync(bindingStorePath(root)), false);
});

test("concurrent publishers leave one complete payload and canonical binding", async (t) => {
  const root = fixture(t);
  const ready = join(root, "ready");
  const go = join(root, "go");
  const moduleUrl = new URL("./oven-data-store.mjs", import.meta.url).href;
  const child = (bytes, at) => new Promise((resolveChild, reject) => {
    const source = `import { existsSync, writeFileSync } from "node:fs"; import { publishOvenData } from ${JSON.stringify(moduleUrl)}; const [root, bytes, at, ready, go] = process.argv.slice(1); writeFileSync(ready + "-" + process.pid, ""); while (!existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); process.stdout.write(JSON.stringify(publishOvenData(root, "sample-oven", bytes, at)));`;
    const processChild = spawn(process.execPath, ["--input-type=module", "--eval", source, root, bytes, at, ready, go], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    processChild.stdout.on("data", (chunk) => { stdout += chunk; });
    processChild.stderr.on("data", (chunk) => { stderr += chunk; });
    processChild.on("error", reject);
    processChild.on("exit", (status) => status === 0 ? resolveChild(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
  const first = child(firstBytes, FIRST_AT);
  const second = child(secondBytes, SECOND_AT);
  for (let attempt = 0; attempt < 100 && readdirSync(root).filter((name) => name.startsWith("ready-")).length < 2; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  writeFileSync(go, "go");
  await Promise.all([first, second]);

  const data = readFileSync(canonicalOvenDataPath(root, "sample-oven"), "utf8");
  assert.ok(data === firstBytes || data === secondBytes);
  assert.equal(readBindingStore(root).bindings["sample-oven"].path, ".local/burnlist/data/sample-oven.json");
  assert.deepEqual(readdirSync(join(root, ".local", "burnlist", "data")), ["sample-oven.json"]);
});
