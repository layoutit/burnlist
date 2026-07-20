import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveOvenPackageDir } from "../server/fs-safe.mjs";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-storage-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return { repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, args, input) {
  return execFileSync(process.execPath, [binPath, ...args], { cwd: context.repo, encoding: "utf8", input });
}

function ovenWithStoredBytes(targetBytes) {
  const prefix = '<oven id="stored-source" version="1" contract="checklist-progress@1" theme="checklist">\n  <!--';
  const suffix = '-->\n  <section-header title="Stored source"/>\n</oven>\n';
  const fillBytes = targetBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  assert.ok(fillBytes >= 0, "test fixture must leave room for a valid Oven");
  return `${prefix}${"x".repeat(fillBytes)}${suffix}`;
}

test("--package accepts a 133KB envelope when each stored component fits", () => {
  const context = fixture();
  try {
    const instructions = `# ${"x".repeat(65_533)}`;
    const oven = ovenWithStoredBytes(69 * 1024);
    const packageInput = JSON.stringify({ instructions, oven });
    const instructionsPath = join(context.repo, "instructions.md");
    const ovenPath = join(context.repo, "from-files.oven");
    writeFileSync(instructionsPath, instructions);
    writeFileSync(ovenPath, oven);

    run(context, ["oven", "create", "from-package", "--package", "-"], packageInput);
    run(context, ["oven", "create", "from-files", "--instructions", instructionsPath, "--oven", ovenPath]);

    const packageDir = resolveOvenPackageDir(join(context.repo, ".local", "burnlist", "ovens", "from-package"));
    const filesDir = resolveOvenPackageDir(join(context.repo, ".local", "burnlist", "ovens", "from-files"));
    const packageInstructions = readFileSync(join(packageDir, "instructions.md"), "utf8");
    const packageOven = readFileSync(join(packageDir, "from-package.oven"), "utf8");
    assert.equal(Buffer.byteLength(packageInstructions), 64 * 1024);
    assert.equal(Buffer.byteLength(packageOven), 69 * 1024);
    assert.ok(Buffer.byteLength(packageInput) > 128 * 1024);
    assert.equal(packageInstructions, readFileSync(join(filesDir, "instructions.md"), "utf8"));
    assert.equal(packageOven, readFileSync(join(filesDir, "from-files.oven"), "utf8"));
  } finally { context.cleanup(); }
});

test("--package rejects oversized stored instructions and Oven source independently", () => {
  const context = fixture();
  try {
    const oven = ovenWithStoredBytes(69 * 1024);
    assert.throws(
      () => run(context, ["oven", "create", "large-instructions", "--package", "-"], JSON.stringify({
        instructions: `# ${"\u0800".repeat(21_845)}`, oven,
      })),
      (error) => String(error.stderr).includes("instructions.md") && String(error.stderr).includes("65536 byte limit"),
    );
    const oversizedOven = ovenWithStoredBytes(131_073);
    assert.throws(
      () => run(context, ["oven", "create", "large-oven", "--package", "-"], JSON.stringify({
        instructions: "# Valid", oven: oversizedOven,
      })),
      (error) => String(error.stderr).includes(".oven") && String(error.stderr).includes("131072 byte limit"),
    );
  } finally { context.cleanup(); }
});
