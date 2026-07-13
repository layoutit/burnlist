import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
