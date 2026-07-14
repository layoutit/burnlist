import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicDirectory } from "./fs-safe.mjs";

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
