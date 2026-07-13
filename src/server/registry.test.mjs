import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  RegistryError, classifyRoots, readRegistry, registerRoot, registryDir, registryPath,
  pruneMissing, repoKey, unregisterRoot, writeRegistry,
} from "./registry.mjs";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "burnlist-registry-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("fresh registry reads as empty", () => {
  const { home, cleanup } = fixture();
  try {
    assert.deepEqual(readRegistry({ home }), { schemaVersion: 1, roots: [] });
  } finally { cleanup(); }
});

test("registerRoot stores one canonical root and is idempotent", () => {
  const { home, cleanup } = fixture();
  const root = mkdtempSync(join(tmpdir(), "burnlist-root-"));
  try {
    const first = registerRoot(root, { home });
    assert.equal(first.added, true);
    assert.equal(first.root.startsWith("/"), true);
    assert.match(first.repoKey, /^[0-9a-f]{12}$/u);
    assert.equal(registerRoot(root, { home }).added, false);
    assert.equal(readRegistry({ home }).roots.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); cleanup(); }
});

test("registerRoot canonicalizes symlink paths", () => {
  const { home, cleanup } = fixture();
  const parent = mkdtempSync(join(tmpdir(), "burnlist-link-"));
  const root = join(parent, "root");
  const link = join(parent, "link");
  try {
    mkdirSync(root);
    symlinkSync(root, link);
    const result = registerRoot(link, { home });
    assert.equal(result.root, realpathSync(root));
    assert.equal(registerRoot(root, { home }).added, false);
  } finally { rmSync(parent, { recursive: true, force: true }); cleanup(); }
});

test("unregisterRoot removes roots, including deleted paths", () => {
  const { home, cleanup } = fixture();
  const root = mkdtempSync(join(tmpdir(), "burnlist-remove-"));
  try {
    registerRoot(root, { home });
    assert.equal(unregisterRoot(root, { home }).removed, true);
    registerRoot(root, { home });
    rmSync(root, { recursive: true });
    assert.equal(unregisterRoot(root, { home }).removed, true);
  } finally { rmSync(root, { recursive: true, force: true }); cleanup(); }
});

test("unregisterRoot does not remove a sibling root for a missing path", () => {
  const { home, cleanup } = fixture();
  const root = mkdtempSync(join(tmpdir(), "burnlist-sibling-"));
  try {
    registerRoot(root, { home });
    const missing = join(dirname(root), `x${basename(root)}-nope`);
    assert.equal(unregisterRoot(missing, { home }).removed, false);
    assert.deepEqual(readRegistry({ home }).roots.map((entry) => entry.root), [realpathSync(root)]);
  } finally { rmSync(root, { recursive: true, force: true }); cleanup(); }
});

test("corrupt registries throw RegistryError", () => {
  const { home, cleanup } = fixture();
  try {
    mkdirSync(registryDir(home), { recursive: true });
    writeFileSync(registryPath(home), "{ not json");
    assert.throws(() => readRegistry({ home }), (error) => error instanceof RegistryError && error.code === "EREGISTRYCORRUPT");
    writeFileSync(registryPath(home), '{"schemaVersion":2,"roots":[]}');
    assert.throws(() => readRegistry({ home }), { code: "EREGISTRYCORRUPT" });
  } finally { cleanup(); }
});

test("registries with malformed root entries throw RegistryError", () => {
  const { home, cleanup } = fixture();
  try {
    mkdirSync(registryDir(home), { recursive: true });
    writeFileSync(registryPath(home), '{"schemaVersion":1,"roots":[{"root":"relative/path","repoKey":"zzz"}]}');
    assert.throws(() => readRegistry({ home }), { code: "EREGISTRYCORRUPT" });
  } finally { cleanup(); }
});

test("registries require normalized roots with matching repository keys", () => {
  const { home, cleanup } = fixture();
  const root = mkdtempSync(join(tmpdir(), "burnlist-registry-contract-"));
  try {
    mkdirSync(registryDir(home), { recursive: true });
    const badKey = repoKey(root) === "000000000000" ? "111111111111" : "000000000000";
    for (const entry of [
      { root, repoKey: badKey },
      { root: `${root}/../${basename(root)}`, repoKey: repoKey(root) },
    ]) {
      writeFileSync(registryPath(home), JSON.stringify({ schemaVersion: 1, roots: [entry] }));
      assert.throws(() => readRegistry({ home }), { code: "EREGISTRYCORRUPT" });
    }
  } finally { rmSync(root, { recursive: true, force: true }); cleanup(); }
});

test("writeRegistry is atomic and ends its JSON with a newline", () => {
  const { home, cleanup } = fixture();
  try {
    writeRegistry({ schemaVersion: 1, roots: [] }, { home });
    assert.deepEqual(JSON.parse(readFileSync(registryPath(home), "utf8")), { schemaVersion: 1, roots: [] });
    assert.equal(readFileSync(registryPath(home), "utf8").endsWith("\n"), true);
    assert.deepEqual(readdirSync(registryDir(home)).filter((name) => name.startsWith(".roots.json.")), []);
  } finally { cleanup(); }
});

test("classifyRoots and pruneMissing preserve non-missing roots", () => {
  const { home, cleanup } = fixture();
  const parent = mkdtempSync(join(tmpdir(), "burnlist-status-"));
  const healthy = join(parent, "healthy");
  const empty = join(parent, "empty");
  const missing = join(parent, "missing");
  try {
    mkdirSync(join(healthy, "notes", "burnlists", "inprogress", "id"), { recursive: true });
    writeFileSync(join(healthy, "notes", "burnlists", "inprogress", "id", "burnlist.md"), "# Healthy\n");
    mkdirSync(join(empty, "notes", "burnlists", "draft"), { recursive: true });
    mkdirSync(missing);
    for (const root of [healthy, empty, missing]) registerRoot(root, { home });
    const canonical = new Map([empty, healthy, missing].map((root) => [root, realpathSync(root)]));
    rmSync(missing, { recursive: true });
    assert.deepEqual(classifyRoots({ home }).map(({ root, status }) => [root, status]), [
      [canonical.get(empty), "empty"], [canonical.get(healthy), "healthy"], [canonical.get(missing), "missing"],
    ]);
    assert.deepEqual(pruneMissing({ home }).map((entry) => entry.root), [canonical.get(missing)]);
    assert.equal(readRegistry({ home }).roots.length, 2);
  } finally { rmSync(parent, { recursive: true, force: true }); cleanup(); }
});

test("concurrent processes register every distinct root", async () => {
  const { home, cleanup } = fixture();
  const parent = mkdtempSync(join(tmpdir(), "burnlist-concurrent-"));
  const modulePath = resolve(dirname(fileURLToPath(import.meta.url)), "registry.mjs");
  try {
    const roots = Array.from({ length: 8 }, (_, index) => join(parent, `root-${index}`));
    roots.forEach((root) => mkdirSync(root));
    await Promise.all(roots.map((root) => runChild(modulePath, root, home)));
    assert.deepEqual(readRegistry({ home }).roots.map((entry) => entry.root), roots.map((root) => realpathSync(root)).sort((a, b) => a.localeCompare(b)));
  } finally { rmSync(parent, { recursive: true, force: true }); cleanup(); }
});

test("a stale lock can be stolen", () => {
  const { home, cleanup } = fixture();
  const root = mkdtempSync(join(tmpdir(), "burnlist-stale-"));
  try {
    mkdirSync(registryDir(home), { recursive: true });
    writeFileSync(join(registryDir(home), "roots.lock"), JSON.stringify({ pid: 2147483646, token: "x" }));
    assert.equal(registerRoot(root, { home }).added, true);
  } finally { rmSync(root, { recursive: true, force: true }); cleanup(); }
});

test("a live, fresh lock is not stolen", () => {
  const { home, cleanup } = fixture();
  const root = mkdtempSync(join(tmpdir(), "burnlist-live-lock-"));
  try {
    mkdirSync(registryDir(home), { recursive: true });
    writeFileSync(join(registryDir(home), "roots.lock"), JSON.stringify({ pid: process.pid, token: "live" }));
    assert.throws(() => registerRoot(root, { home }), { code: "ELOCKED" });
  } finally { rmSync(root, { recursive: true, force: true }); cleanup(); }
});

test("an old lock with a live pid can be stolen", () => {
  const { home, cleanup } = fixture();
  const root = mkdtempSync(join(tmpdir(), "burnlist-old-lock-"));
  try {
    mkdirSync(registryDir(home), { recursive: true });
    const lock = join(registryDir(home), "roots.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "old" }));
    const oldDate = new Date(Date.now() - 61_000);
    utimesSync(lock, oldDate, oldDate);
    assert.equal(registerRoot(root, { home }).added, true);
  } finally { rmSync(root, { recursive: true, force: true }); cleanup(); }
});

function runChild(modulePath, root, home) {
  const source = `import(${JSON.stringify(modulePath)}).then(({ registerRoot }) => registerRoot(process.env.ROOT, { home: process.env.HOME }))`;
  return new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, ["-e", source], { env: { ...process.env, ROOT: root, HOME: home } });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveChild() : reject(new Error(`Child exited ${code}`)));
  });
}
