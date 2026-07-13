import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

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
