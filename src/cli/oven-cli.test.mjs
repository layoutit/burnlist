import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { ovenRevision } from "../ovens/oven-contract.mjs";
import { resolveOvenPackageDir } from "../server/fs-safe.mjs";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-cli-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return { repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, ...args) {
  return execFileSync(process.execPath, [binPath, ...args], { cwd: context.repo, encoding: "utf8" });
}

function runFrom(cwd, ...args) {
  return execFileSync(process.execPath, [binPath, ...args], { cwd, encoding: "utf8" });
}

function detailFixture() {
  return {
    version: 1,
    columns: 2,
    rows: 2,
    rowHeight: 48,
    cells: [{
      id: "summary",
      title: "Summary",
      description: "Current status.",
      widget: "metric",
      source: "/summary",
      format: "plain",
      column: 1,
      row: 1,
      columnSpan: 2,
      rowSpan: 1,
    }],
  };
}

function writeOven(root, id, ovenJson) {
  const ovenRoot = join(root, id);
  mkdirSync(ovenRoot, { recursive: true });
  writeFileSync(join(ovenRoot, "instructions.md"), "# Forked Oven\n\nFollow the checklist.\n");
  writeFileSync(join(ovenRoot, "detail.json"), `${JSON.stringify(detailFixture())}\n`);
  if (ovenJson !== undefined) writeFileSync(join(ovenRoot, "oven.json"), ovenJson);
}

function pausedUpdate(context, ovensDir, packagePath) {
  const script = [
    'import fs, { readFileSync } from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'import { join } from "node:path";',
    'const [bin, root] = process.argv.slice(1, 3);',
    'const rename = fs.renameSync;',
    'fs.renameSync = (from, to, ...rest) => {',
    '  if (to === join(root, "sample-oven", "current")) { process.stdout.write("staged\\n"); readFileSync(0, "utf8"); }',
    '  return rename(from, to, ...rest);',
    '};',
    'syncBuiltinESMExports();',
    'process.argv = [process.argv[0], bin, ...process.argv.slice(3)];',
    'await import(bin);',
  ].join("\n");
  return spawn(process.execPath, [
    "--input-type=module", "--eval", script, binPath, ovensDir,
    "oven", "update", "sample-oven", "--package", packagePath, "--ovens-dir", ovensDir,
  ], { cwd: context.repo, stdio: ["pipe", "pipe", "pipe"] });
}

function waitForBarrier(child) {
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (chunk.toString().includes("staged")) resolve(); });
    child.on("error", reject);
    child.on("close", (status) => reject(new Error(`update ended before reaching its publish barrier: ${status}`)));
  });
}

test("oven bind, bindings, and unbind persist a logical repo-local binding", () => {
  const context = fixture();
  const logicalPath = "../generated/current.json";
  const storePath = join(context.repo, ".local", "burnlist", "bindings.json");
  try {
    const bound = run(context, "oven", "bind", "sample-oven", logicalPath, "--repo", context.repo);
    assert.match(bound, /Bound Oven sample-oven to \.\.\/generated\/current\.json/u);
    assert.match(bound, new RegExp(`Store: ${storePath}`));
    const store = JSON.parse(readFileSync(storePath, "utf8"));
    assert.equal(store.schemaVersion, 1);
    assert.equal(store.bindings["sample-oven"].path, logicalPath);
    assert.match(store.bindings["sample-oven"].boundAt, /^\d{4}-\d{2}-\d{2}T/u);
    assert.match(run(context, "oven", "bindings", "--repo", context.repo), /sample-oven  \.\.\/generated\/current\.json/u);
    assert.match(run(context, "oven", "unbind", "sample-oven", "--repo", context.repo), /Unbound Oven sample-oven/u);
    assert.deepEqual(JSON.parse(readFileSync(storePath, "utf8")), { schemaVersion: 1, bindings: {} });
    assert.match(run(context, "oven", "unbind", "sample-oven", "--repo", context.repo), /No binding exists for Oven sample-oven/u);
  } finally { context.cleanup(); }
});

test("oven view reads optional fork lineage and rejects malformed sidecars", () => {
  const context = fixture();
  const ovensDir = join(context.repo, "ovens");
  try {
    writeOven(ovensDir, "forked-oven", JSON.stringify({
      forkedFrom: { ovenId: "source-oven", revision: `o1-sha256:${"a".repeat(64)}` },
    }));
    writeOven(ovensDir, "standalone-oven");
    const forked = JSON.parse(run(context, "oven", "view", "forked-oven", "--json", "--ovens-dir", ovensDir));
    assert.deepEqual(forked.forkedFrom, { ovenId: "source-oven", revision: `o1-sha256:${"a".repeat(64)}` });
    const standalone = JSON.parse(run(context, "oven", "view", "standalone-oven", "--json", "--ovens-dir", ovensDir));
    assert.equal(Object.hasOwn(standalone, "forkedFrom"), false);

    writeOven(ovensDir, "broken-oven", "{");
    assert.throws(
      () => run(context, "oven", "view", "broken-oven", "--json", "--ovens-dir", ovensDir),
      (error) => String(error.stderr).includes("lineage sidecar is invalid"),
    );
  } finally { context.cleanup(); }
});

test("oven create and update swap the package while preserving sibling files", () => {
  const context = fixture();
  const ovensDir = join(context.repo, "ovens");
  try {
    const packagePath = join(context.repo, "replacement.json");
    writeFileSync(packagePath, JSON.stringify({
      instructions: "# Initial Oven\n\nInitial checklist.", detail: detailFixture(),
    }));
    run(context, "oven", "create", "sample-oven", "--package", packagePath, "--ovens-dir", ovensDir);
    writeFileSync(join(resolveOvenPackageDir(join(ovensDir, "sample-oven")), "oven.json"), JSON.stringify({
      forkedFrom: { ovenId: "source-oven", revision: `o1-sha256:${"a".repeat(64)}` },
    }));
    writeFileSync(packagePath, JSON.stringify({
      instructions: "# Updated Oven\n\nUpdated checklist.", detail: detailFixture(),
    }));
    run(context, "oven", "update", "sample-oven", "--package", packagePath, "--ovens-dir", ovensDir);
    const current = resolveOvenPackageDir(join(ovensDir, "sample-oven"));
    assert.match(readFileSync(join(current, "instructions.md"), "utf8"), /Updated checklist/u);
    assert.deepEqual(JSON.parse(readFileSync(join(current, "detail.json"), "utf8")), detailFixture());
    assert.equal(JSON.parse(readFileSync(join(current, "oven.json"), "utf8")).forkedFrom.ovenId, "source-oven");
    assert.equal(readdirSync(join(ovensDir, "sample-oven")).filter((name) => name.startsWith("rev-")).length, 2);
  } finally { context.cleanup(); }
});

test("oven update migrates a legacy plain directory to a pointer package", () => {
  const context = fixture();
  const ovensDir = join(context.repo, "ovens");
  try {
    writeOven(ovensDir, "legacy-oven", JSON.stringify({
      forkedFrom: { ovenId: "source-oven", revision: `o1-sha256:${"a".repeat(64)}` },
    }));
    const packagePath = join(context.repo, "replacement.json");
    writeFileSync(packagePath, JSON.stringify({ instructions: "# Updated Oven\n\nMigrated safely.", detail: detailFixture() }));
    run(context, "oven", "update", "legacy-oven", "--package", packagePath, "--ovens-dir", ovensDir);
    assert.match(readFileSync(join(ovensDir, "legacy-oven", "current"), "utf8"), /^rev-[a-f0-9]+\n$/u);
    assert.equal(existsSync(join(ovensDir, "legacy-oven", "instructions.md")), false);
    const oven = JSON.parse(run(context, "oven", "view", "legacy-oven", "--json", "--ovens-dir", ovensDir));
    assert.match(oven.instructions, /Migrated safely/u);
    assert.equal(oven.forkedFrom.ovenId, "source-oven");
  } finally { context.cleanup(); }
});

test("oven storage follows the umbrella root when launched from a subdirectory", () => {
  const context = fixture();
  const subdirectory = join(context.repo, "work", "nested");
  try {
    mkdirSync(join(context.repo, "notes", "burnlists"), { recursive: true });
    mkdirSync(subdirectory, { recursive: true });
    const packagePath = join(context.repo, "package.json");
    writeFileSync(packagePath, JSON.stringify({
      instructions: "# Umbrella Oven\n\nStored with the umbrella.", detail: detailFixture(),
    }));
    runFrom(subdirectory, "oven", "create", "umbrella-oven", "--package", packagePath);
    const ovenPath = join(context.repo, ".local", "burnlist", "ovens", "umbrella-oven");
    assert.match(readFileSync(join(resolveOvenPackageDir(ovenPath), "instructions.md"), "utf8"), /Stored with the umbrella/u);
    const ovens = JSON.parse(runFrom(subdirectory, "oven", "list", "--json"));
    assert.equal(ovens.some((oven) => oven.id === "umbrella-oven"), true);
  } finally { context.cleanup(); }
});

test("oven storage rejects symlink escapes for its state directory and individual Oven ids", () => {
  const context = fixture();
  const packagePath = join(context.repo, "package.json");
  const outside = join(dirname(context.repo), "outside");
  try {
    writeFileSync(packagePath, JSON.stringify({ instructions: "# Contained Oven\n\nStay in the repo.", detail: detailFixture() }));
    mkdirSync(outside);
    symlinkSync(outside, join(context.repo, ".local"), "dir");
    assert.throws(
      () => run(context, "oven", "create", "unsafe-oven", "--package", packagePath),
      (error) => String(error.stderr).includes("escapes"),
    );
    assert.equal(existsSync(join(outside, "burnlist", "ovens", "unsafe-oven")), false);
  } finally { context.cleanup(); }

  const second = fixture();
  try {
    const ovensDir = join(second.repo, ".local", "burnlist", "ovens");
    const idOutside = join(second.repo, "id-outside");
    const packagePath = join(second.repo, "package.json");
    mkdirSync(ovensDir, { recursive: true });
    mkdirSync(idOutside);
    symlinkSync(idOutside, join(ovensDir, "escaped-oven"), "dir");
    writeFileSync(packagePath, JSON.stringify({ instructions: "# Escaped Oven\n\nNope.", detail: detailFixture() }));
    assert.throws(
      () => run(second, "oven", "view", "escaped-oven", "--json"),
      (error) => String(error.stderr).includes("escapes"),
    );
    assert.throws(
      () => run(second, "oven", "create", "escaped-oven", "--package", packagePath),
      (error) => String(error.stderr).includes("escapes"),
    );
  } finally { second.cleanup(); }
});

test("oven view and list read complete packages on both sides of a publish barrier", async () => {
  const context = fixture();
  const ovensDir = join(context.repo, "ovens");
  try {
    const packagePath = join(context.repo, "replacement.json");
    writeFileSync(packagePath, JSON.stringify({
      instructions: "# Initial Oven\n\nInitial checklist.", detail: detailFixture(),
    }));
    run(context, "oven", "create", "sample-oven", "--package", packagePath, "--ovens-dir", ovensDir);
    writeFileSync(packagePath, JSON.stringify({
      instructions: "# Updated Oven\n\nUpdated checklist.", detail: detailFixture(),
    }));
    const writer = pausedUpdate(context, ovensDir, packagePath);
    const writerStatus = new Promise((resolve) => writer.on("close", resolve));
    await waitForBarrier(writer);
    const oldView = JSON.parse(run(context, "oven", "view", "sample-oven", "--json", "--ovens-dir", ovensDir));
    const oldList = JSON.parse(run(context, "oven", "list", "--json", "--ovens-dir", ovensDir)).find((oven) => oven.id === "sample-oven");
    assert.match(oldView.instructions, /Initial checklist/u);
    assert.equal(oldList.name, "Initial Oven");
    writer.stdin.end("publish\n");
    const status = await writerStatus;
    assert.equal(status, 0);
    const newView = JSON.parse(run(context, "oven", "view", "sample-oven", "--json", "--ovens-dir", ovensDir));
    const newList = JSON.parse(run(context, "oven", "list", "--json", "--ovens-dir", ovensDir)).find((oven) => oven.id === "sample-oven");
    assert.match(newView.instructions, /Updated checklist/u);
    assert.equal(newList.name, "Updated Oven");
  } finally { context.cleanup(); }
});

test("a killed writer leaves the prior pointer package readable", async () => {
  const context = fixture();
  const ovensDir = join(context.repo, "ovens");
  try {
    const packagePath = join(context.repo, "replacement.json");
    writeFileSync(packagePath, JSON.stringify({ instructions: "# Initial Oven\n\nInitial checklist.", detail: detailFixture() }));
    run(context, "oven", "create", "sample-oven", "--package", packagePath, "--ovens-dir", ovensDir);
    writeFileSync(packagePath, JSON.stringify({ instructions: "# Interrupted Oven\n\nNever published.", detail: detailFixture() }));
    const writer = pausedUpdate(context, ovensDir, packagePath);
    await waitForBarrier(writer);
    const priorCurrent = readFileSync(join(ovensDir, "sample-oven", "current"), "utf8");
    writer.kill("SIGKILL");
    await new Promise((resolve) => writer.on("close", resolve));
    const oldView = JSON.parse(run(context, "oven", "view", "sample-oven", "--json", "--ovens-dir", ovensDir));
    const oldList = JSON.parse(run(context, "oven", "list", "--json", "--ovens-dir", ovensDir)).find((oven) => oven.id === "sample-oven");
    assert.match(oldView.instructions, /Initial checklist/u);
    assert.equal(oldList.name, "Initial Oven");
    assert.equal(readFileSync(join(ovensDir, "sample-oven", "current"), "utf8"), priorCurrent);
    writeFileSync(packagePath, JSON.stringify({ instructions: "# Recovered Oven\n\nPublished after recovery.", detail: detailFixture() }));
    run(context, "oven", "update", "sample-oven", "--package", packagePath, "--ovens-dir", ovensDir);
    assert.match(JSON.parse(run(context, "oven", "view", "sample-oven", "--json", "--ovens-dir", ovensDir)).instructions, /Published after recovery/u);
    assert.notEqual(readFileSync(join(ovensDir, "sample-oven", "current"), "utf8"), priorCurrent);
  } finally { context.cleanup(); }
});

test("oven fork writes source revision lineage and discovery exposes it", () => {
  const context = fixture();
  const ovensDir = join(context.repo, "ovens");
  try {
    writeOven(ovensDir, "source-oven");
    const source = JSON.parse(run(context, "oven", "view", "source-oven", "--json", "--ovens-dir", ovensDir));
    const expectedRevision = ovenRevision({ instructions: source.instructions, detail: source.detail });
    const output = run(context, "oven", "fork", "source-oven", "forked-oven", "--ovens-dir", ovensDir);
    assert.match(output, new RegExp(`Forked from source-oven@${expectedRevision}`));
    assert.deepEqual(JSON.parse(readFileSync(join(resolveOvenPackageDir(join(ovensDir, "forked-oven")), "oven.json"), "utf8")), {
      forkedFrom: { ovenId: "source-oven", revision: expectedRevision },
    });
    const forked = JSON.parse(run(context, "oven", "list", "--json", "--ovens-dir", ovensDir))
      .find((oven) => oven.id === "forked-oven");
    assert.deepEqual(forked.forkedFrom, { ovenId: "source-oven", revision: expectedRevision });
  } finally { context.cleanup(); }
});

test("oven ignores legacy files and accepts only the two-file package layout", () => {
  const context = fixture();
  const ovensDir = join(context.repo, "ovens");
  const legacyDir = join(ovensDir, "legacy-only");
  try {
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "definition.md"), "# Legacy Oven\n");
    writeFileSync(join(legacyDir, "dashboard.json"), JSON.stringify(detailFixture()));
    writeOven(ovensDir, "two-file-oven");
    const ovens = JSON.parse(run(context, "oven", "list", "--json", "--ovens-dir", ovensDir));
    assert.equal(ovens.some((oven) => oven.id === "legacy-only"), false);
    assert.equal(ovens.some((oven) => oven.id === "two-file-oven"), true);
    assert.throws(
      () => run(context, "oven", "view", "legacy-only", "--json", "--ovens-dir", ovensDir),
      (error) => String(error.stderr).includes('Unknown Oven "legacy-only"'),
    );
    assert.throws(
      () => run(context, "oven", "create", "copied-legacy", "--dir", legacyDir, "--ovens-dir", ovensDir),
      (error) => String(error.stderr).includes("instructions.md"),
    );
  } finally { context.cleanup(); }
});
