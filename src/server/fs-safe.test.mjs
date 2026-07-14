import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicDirectory, atomicOvenPackage, OVEN_REV_GRACE_MS, resolveOvenPackageDir, withOvenPackageLock } from "./fs-safe.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-fs-safe-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("atomicDirectory reports EEXIST for a populated collision", () => {
  const context = fixture();
  try {
    atomicDirectory(context.root, "260713-001", { "burnlist.md": "first\n" });
    assert.throws(
      () => atomicDirectory(context.root, "260713-001", { "burnlist.md": "second\n" }),
      (error) => error?.code === "EEXIST" && error.message === "260713-001 already exists.",
    );
  } finally {
    context.cleanup();
  }
});

function swapFailure(mode, parent) {
  const script = [
    'import fs, { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'import { join } from "node:path";',
    'const [parent, mode, moduleUrl] = process.argv.slice(1);',
    'const target = join(parent, "oven");',
    'mkdirSync(target, { recursive: true });',
    'writeFileSync(join(target, "instructions.md"), "original\\n");',
    'const nativeRename = fs.renameSync;',
    'const nativeRm = fs.rmSync;',
    'fs.renameSync = (from, to) => {',
    '  if (mode === "rollback" && from.startsWith(join(parent, ".oven.")) && !from.startsWith(join(parent, ".oven.old.")) && to === target) throw new Error("publish blocked");',
    '  if (mode === "rollback" && from.startsWith(join(parent, ".oven.old.")) && to === target) throw new Error("rollback blocked");',
    '  return nativeRename(from, to);',
    '};',
    'fs.rmSync = (path, options) => {',
    '  if (mode === "cleanup" && path.startsWith(join(parent, ".oven.old."))) throw new Error("cleanup blocked");',
    '  return nativeRm(path, options);',
    '};',
    'syncBuiltinESMExports();',
    'const { atomicDirectory } = await import(moduleUrl);',
    'try { atomicDirectory(parent, "oven", { "instructions.md": "updated\\n" }, { replace: true, preserveExisting: true }); }',
    'catch (error) {',
    '  process.stdout.write(JSON.stringify({ name: error.name, message: error.message, errors: error.errors?.length ?? 0, old: readdirSync(parent).filter((name) => name.startsWith(".oven.old.")), target: existsSync(target) }));',
    '}',
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script, parent, mode, new URL("./fs-safe.mjs", import.meta.url).href], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("atomicDirectory surfaces failed rollback and old-directory cleanup", () => {
  const rollback = fixture();
  const cleanup = fixture();
  try {
    const rollbackResult = swapFailure("rollback", rollback.root);
    assert.equal(rollbackResult.name, "AggregateError");
    assert.equal(rollbackResult.errors, 2);
    assert.match(rollbackResult.message, /publish failed and rollback failed/u);
    assert.equal(rollbackResult.target, false);
    assert.equal(rollbackResult.old.length, 1);

    const cleanupResult = swapFailure("cleanup", cleanup.root);
    assert.match(cleanupResult.message, /could not clean up/u);
    assert.equal(cleanupResult.target, true);
    assert.equal(cleanupResult.old.length, 1);
  } finally {
    rollback.cleanup();
    cleanup.cleanup();
  }
});

function ovenFiles(version) {
  return {
    "instructions.md": `# Oven ${version}\n`,
    "detail.json": `{ "version": "${version}" }\n`,
    "oven.json": `{ "source": "${version}" }\n`,
  };
}

test("Oven pointer swaps retain a resolved reader revision and grace GC keeps young revisions", () => {
  const context = fixture();
  const target = join(context.root, "oven");
  try {
    withOvenPackageLock(context.root, "oven", () => atomicOvenPackage(context.root, "oven", ovenFiles("one")));
    const oldPath = resolveOvenPackageDir(target);
    withOvenPackageLock(context.root, "oven", () => atomicOvenPackage(context.root, "oven", ovenFiles("two"), { replace: true }));

    for (const [name, contents] of Object.entries(ovenFiles("one"))) {
      assert.equal(readFileSync(join(oldPath, name), "utf8"), contents);
    }
    withOvenPackageLock(context.root, "oven", () => atomicOvenPackage(context.root, "oven", ovenFiles("three"), { replace: true }));
    const revisions = readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("rev-"))
      .map((entry) => entry.name);
    assert.equal(revisions.length, 3);
    assert.match(readFileSync(join(target, "current"), "utf8"), /^rev-[a-f0-9]+\n$/u);

    utimesSync(oldPath, new Date(Date.now() - OVEN_REV_GRACE_MS - 1_000), new Date(Date.now() - OVEN_REV_GRACE_MS - 1_000));
    withOvenPackageLock(context.root, "oven", () => atomicOvenPackage(context.root, "oven", ovenFiles("four"), { replace: true }));
    assert.equal(existsSync(oldPath), false);
    assert.equal(readdirSync(target, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("rev-")).length, 3);
  } finally {
    context.cleanup();
  }
});

test("legacy migration stays readable on either side of current and recovery trusts current", () => {
  const context = fixture();
  const target = join(context.root, "legacy");
  const crashed = join(context.root, "crashed");
  const orphanRoot = join(context.root, "orphan");
  try {
    atomicDirectory(context.root, "legacy", ovenFiles("legacy"));
    assert.equal(resolveOvenPackageDir(target), target);
    assert.equal(readFileSync(join(resolveOvenPackageDir(target), "instructions.md"), "utf8"), "# Oven legacy\n");
    withOvenPackageLock(context.root, "legacy", () => (
      atomicOvenPackage(context.root, "legacy", ovenFiles("updated"), { replace: true })
    ));
    assert.equal(readFileSync(join(resolveOvenPackageDir(target), "instructions.md"), "utf8"), "# Oven updated\n");
    assert.equal(existsSync(join(target, "instructions.md")), false);

    atomicDirectory(context.root, "crashed", ovenFiles("old"));
    const publishedBeforeCleanup = join(crashed, "rev-cafebabe");
    mkdirSync(publishedBeforeCleanup);
    for (const [name, contents] of Object.entries(ovenFiles("new"))) writeFileSync(join(publishedBeforeCleanup, name), contents);
    writeFileSync(join(crashed, "current"), "rev-cafebabe\n");
    assert.equal(readFileSync(join(resolveOvenPackageDir(crashed), "instructions.md"), "utf8"), "# Oven new\n");
    assert.equal(readFileSync(join(crashed, "instructions.md"), "utf8"), "# Oven old\n");
    withOvenPackageLock(context.root, "crashed", () => (
      atomicOvenPackage(context.root, "crashed", ovenFiles("recovered"), { replace: true })
    ));
    assert.equal(existsSync(join(crashed, "instructions.md")), false);

    mkdirSync(orphanRoot, { recursive: true });
    const orphanRevision = join(orphanRoot, "rev-deadbeef");
    mkdirSync(orphanRevision);
    for (const [name, contents] of Object.entries(ovenFiles("orphan"))) writeFileSync(join(orphanRevision, name), contents);
    withOvenPackageLock(context.root, "orphan", () => atomicOvenPackage(context.root, "orphan", ovenFiles("created")));
    assert.equal(readFileSync(join(resolveOvenPackageDir(orphanRoot), "instructions.md"), "utf8"), "# Oven created\n");

    writeFileSync(join(target, "current"), "rev-facefeed\n");
    assert.throws(
      () => withOvenPackageLock(context.root, "legacy", () => atomicOvenPackage(context.root, "legacy", ovenFiles("bad"), { replace: true })),
      /missing revision rev-facefeed/u,
    );
  } finally {
    context.cleanup();
  }
});
