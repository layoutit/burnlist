import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ovenRevision } from "../ovens/oven-contract.mjs";

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
    writeFileSync(join(ovensDir, "sample-oven", "oven.json"), JSON.stringify({
      forkedFrom: { ovenId: "source-oven", revision: `o1-sha256:${"a".repeat(64)}` },
    }));
    writeFileSync(packagePath, JSON.stringify({
      instructions: "# Updated Oven\n\nUpdated checklist.", detail: detailFixture(),
    }));
    run(context, "oven", "update", "sample-oven", "--package", packagePath, "--ovens-dir", ovensDir);
    assert.match(readFileSync(join(ovensDir, "sample-oven", "instructions.md"), "utf8"), /Updated checklist/u);
    assert.deepEqual(JSON.parse(readFileSync(join(ovensDir, "sample-oven", "detail.json"), "utf8")), detailFixture());
    assert.equal(JSON.parse(readFileSync(join(ovensDir, "sample-oven", "oven.json"), "utf8")).forkedFrom.ovenId, "source-oven");
    assert.equal(readdirSync(ovensDir).some((name) => name.startsWith(".")), false);
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
    assert.match(readFileSync(join(ovenPath, "instructions.md"), "utf8"), /Stored with the umbrella/u);
    const ovens = JSON.parse(runFrom(subdirectory, "oven", "list", "--json"));
    assert.equal(ovens.some((oven) => oven.id === "umbrella-oven"), true);
  } finally { context.cleanup(); }
});

test("an oven reader waits for an update swap and receives a complete package", async () => {
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
    const script = [
      'import fs from "node:fs";',
      'import { syncBuiltinESMExports } from "node:module";',
      'import { join } from "node:path";',
      'const [bin, ovensDir, target] = process.argv.slice(1, 4);',
      'const rename = fs.renameSync;',
      'fs.renameSync = (from, to) => {',
      '  const result = rename(from, to);',
      '  if (from === target && to.startsWith(join(ovensDir, ".sample-oven.old."))) {',
      '    process.stdout.write("target-hidden\\n");',
      '    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);',
      '  }',
      '  return result;',
      '};',
      'syncBuiltinESMExports();',
      'process.argv = [process.argv[0], bin, ...process.argv.slice(4)];',
      'await import(bin);',
    ].join("\n");
    const writer = spawn(process.execPath, [
      "--input-type=module", "--eval", script, binPath, ovensDir, join(ovensDir, "sample-oven"),
      "oven", "update", "sample-oven", "--package", packagePath, "--ovens-dir", ovensDir,
    ], { cwd: context.repo });
    const writerStatus = new Promise((resolve) => writer.on("close", resolve));
    await new Promise((resolve, reject) => {
      writer.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("target-hidden")) resolve();
      });
      writer.on("error", reject);
      writer.on("close", (status) => reject(new Error(`update ended before the swap reader ran: ${status}`)));
    });
    const reader = JSON.parse(run(context, "oven", "view", "sample-oven", "--json", "--ovens-dir", ovensDir));
    assert.match(reader.instructions, /Updated checklist/u);
    assert.deepEqual(reader.detail, detailFixture());
    const status = await writerStatus;
    assert.equal(status, 0);
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
    assert.deepEqual(JSON.parse(readFileSync(join(ovensDir, "forked-oven", "oven.json"), "utf8")), {
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
