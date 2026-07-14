import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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
    'let error = null;',
    'try { atomicDirectory(parent, "oven", { "instructions.md": "updated\\n" }, { replace: true, preserveExisting: true }); } catch (caught) { error = caught; }',
    'process.stdout.write(JSON.stringify({ name: error?.name, message: error?.message, errors: error?.errors?.length ?? 0, old: readdirSync(parent).filter((name) => name.startsWith(".oven.old.")), target: existsSync(target) }));',
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script, parent, mode, new URL("./fs-safe.mjs", import.meta.url).href], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("atomicDirectory surfaces failed rollback but keeps a successful replacement live after cleanup failure", () => {
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
    assert.equal(cleanupResult.message, undefined);
    assert.equal(cleanupResult.target, true);
    assert.equal(cleanupResult.old.length, 1);
  } finally {
    rollback.cleanup();
    cleanup.cleanup();
  }
});

test("Oven package cleanup failures do not undo a published revision, while pre-swap failures throw", () => {
  const context = fixture();
  const script = [
    'import fs, { existsSync, readFileSync } from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'const [root, moduleUrl] = process.argv.slice(1);',
    'const { atomicOvenPackage, resolveOvenPackageDir } = await import(moduleUrl);',
    'const files = (name) => ({ "instructions.md": "# " + name + "\\n", "detail.json": "{}\\n" });',
    'atomicOvenPackage(root, "oven", files("first"));',
    'const nativeReaddir = fs.readdirSync;',
    'fs.readdirSync = (path, ...rest) => path === root + "/oven" ? (() => { throw new Error("gc blocked"); })() : nativeReaddir(path, ...rest);',
    'syncBuiltinESMExports();',
    'atomicOvenPackage(root, "oven", files("second"), { replace: true });',
    'const current = resolveOvenPackageDir(root + "/oven");',
    'process.stdout.write(JSON.stringify({ current, contents: readFileSync(current + "/instructions.md", "utf8"), exists: existsSync(current) }));',
  ].join("\n");
  const preSwapScript = [
    'import fs from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'const [root, moduleUrl] = process.argv.slice(1);',
    'const { atomicOvenPackage } = await import(moduleUrl);',
    'const nativeWrite = fs.writeFileSync;',
    'fs.writeFileSync = (path, ...rest) => { if (String(path).includes("instructions.md")) throw new Error("stage blocked"); return nativeWrite(path, ...rest); };',
    'syncBuiltinESMExports();',
    'try { atomicOvenPackage(root, "pre-swap", { "instructions.md": "# blocked\\n", "detail.json": "{}\\n" }); } catch (error) { process.stdout.write(error.message); }',
  ].join("\n");
  try {
    const published = spawnSync(process.execPath, ["--input-type=module", "--eval", script, context.root, new URL("./fs-safe.mjs", import.meta.url).href], { encoding: "utf8" });
    assert.equal(published.status, 0, published.stderr);
    const result = JSON.parse(published.stdout);
    assert.equal(result.exists, true);
    assert.match(result.current, /rev-[a-f0-9]+$/u);
    assert.match(result.contents, /second/u);

    const failed = spawnSync(process.execPath, ["--input-type=module", "--eval", preSwapScript, context.root, new URL("./fs-safe.mjs", import.meta.url).href], { encoding: "utf8" });
    assert.equal(failed.status, 0, failed.stderr);
    assert.match(failed.stdout, /stage blocked/u);
  } finally {
    context.cleanup();
  }
});

function ovenFiles(version) {
  return {
    "instructions.md": `# Oven ${version}\n`,
    "detail.json": `{ "version": "${version}" }\n`,
    "oven.json": `{ "source": "${version}" }\n`,
  };
}

test("Oven pointer swaps measure revision GC grace from retirement", () => {
  const context = fixture();
  const target = join(context.root, "oven");
  try {
    withOvenPackageLock(context.root, "oven", () => atomicOvenPackage(context.root, "oven", ovenFiles("one")));
    const oldPath = resolveOvenPackageDir(target);
    const longAgo = new Date(Date.now() - OVEN_REV_GRACE_MS - 1_000);
    utimesSync(oldPath, longAgo, longAgo);
    withOvenPackageLock(context.root, "oven", () => atomicOvenPackage(context.root, "oven", ovenFiles("two"), { replace: true }));

    for (const [name, contents] of Object.entries(ovenFiles("one"))) {
      assert.equal(readFileSync(join(oldPath, name), "utf8"), contents);
    }
    assert.ok(Date.now() - statSync(oldPath).mtimeMs < OVEN_REV_GRACE_MS);

    const stale = join(target, "rev-deadbeef");
    mkdirSync(stale);
    utimesSync(stale, longAgo, longAgo);
    withOvenPackageLock(context.root, "oven", () => atomicOvenPackage(context.root, "oven", ovenFiles("three"), { replace: true }));
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(oldPath), true);
    const revisions = readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("rev-"))
      .map((entry) => entry.name);
    assert.equal(revisions.length, 3);
    assert.match(readFileSync(join(target, "current"), "utf8"), /^rev-[a-f0-9]+\n$/u);

    const currentPath = resolveOvenPackageDir(target);
    utimesSync(currentPath, longAgo, longAgo);
    withOvenPackageLock(context.root, "oven", () => atomicOvenPackage(context.root, "oven", ovenFiles("four"), { replace: true }));
    assert.equal(existsSync(currentPath), true);
    assert.equal(existsSync(resolveOvenPackageDir(target)), true);
  } finally {
    context.cleanup();
  }
});

test("Oven publication runs its locked path guard before creating a revision", () => {
  const context = fixture();
  const target = join(context.root, "guarded");
  try {
    withOvenPackageLock(context.root, "guarded", () => atomicOvenPackage(context.root, "guarded", ovenFiles("old")));
    const pointer = readFileSync(join(target, "current"), "utf8");
    assert.throws(
      () => withOvenPackageLock(context.root, "guarded", () => atomicOvenPackage(context.root, "guarded", ovenFiles("new"), {
        replace: true,
        assertPath: () => { throw new Error("custom storage changed"); },
      })),
      /custom storage changed/u,
    );
    assert.equal(readFileSync(join(target, "current"), "utf8"), pointer);
    assert.equal(readFileSync(join(resolveOvenPackageDir(target), "instructions.md"), "utf8"), "# Oven old\n");
  } finally {
    context.cleanup();
  }
});

test("Oven readers only fall back for an absent current pointer", () => {
  const context = fixture();
  try {
    const flat = join(context.root, "flat");
    mkdirSync(flat);
    for (const [name, contents] of Object.entries(ovenFiles("flat"))) writeFileSync(join(flat, name), contents);
    assert.equal(resolveOvenPackageDir(flat), flat);

    const missing = join(context.root, "missing");
    mkdirSync(missing);
    writeFileSync(join(missing, "current"), "rev-deadbeef\n");
    assert.throws(() => resolveOvenPackageDir(missing), /missing revision rev-deadbeef/u);

    const nonFile = join(context.root, "non-file");
    mkdirSync(join(nonFile, "current"), { recursive: true });
    assert.throws(() => resolveOvenPackageDir(nonFile), /not a file/u);

    const linked = join(context.root, "linked");
    mkdirSync(linked);
    writeFileSync(join(linked, "pointer-target"), "rev-deadbeef\n");
    symlinkSync("pointer-target", join(linked, "current"));
    assert.throws(() => resolveOvenPackageDir(linked), /not a file/u);
  } finally {
    context.cleanup();
  }
});

test("Oven current pointers require one exact revision line", () => {
  const context = fixture();
  const target = join(context.root, "oven");
  try {
    mkdirSync(target);
    mkdirSync(join(target, "rev-deadbeef"));
    for (const contents of [" rev-deadbeef", "rev-deadbeef\nextra", "rev-deadbeef \n"]) {
      writeFileSync(join(target, "current"), contents);
      assert.throws(() => resolveOvenPackageDir(target), /Invalid Oven current pointer/u);
    }
    for (const contents of ["rev-deadbeef", "rev-deadbeef\n"]) {
      writeFileSync(join(target, "current"), contents);
      assert.equal(resolveOvenPackageDir(target), join(target, "rev-deadbeef"));
    }
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
    const orphanPointerTemp = join(orphanRoot, ".current.deadcafe");
    writeFileSync(orphanPointerTemp, "rev-deadbeef\n");
    withOvenPackageLock(context.root, "orphan", () => atomicOvenPackage(context.root, "orphan", ovenFiles("created")));
    assert.equal(readFileSync(join(resolveOvenPackageDir(orphanRoot), "instructions.md"), "utf8"), "# Oven created\n");
    assert.equal(existsSync(orphanPointerTemp), false);

    writeFileSync(join(target, "current"), "rev-facefeed\n");
    assert.throws(
      () => withOvenPackageLock(context.root, "legacy", () => atomicOvenPackage(context.root, "legacy", ovenFiles("bad"), { replace: true })),
      /missing revision rev-facefeed/u,
    );
  } finally {
    context.cleanup();
  }
});
