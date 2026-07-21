import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compileOven } from "../ovens/dsl/oven-compile.mjs";
import { starterOvenSource } from "../ovens/oven-starter.mjs";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-fork-id-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return { repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, ...args) {
  return execFileSync(process.execPath, [binPath, ...args], { cwd: context.repo, encoding: "utf8" });
}

function writeOven(root, id) {
  const ovenRoot = join(root, id);
  mkdirSync(ovenRoot, { recursive: true });
  writeFileSync(join(ovenRoot, "instructions.md"), "# Source Oven\n\nFollow the checklist.\n");
  writeFileSync(join(ovenRoot, `${id}.oven`), starterOvenSource(id, "Source Oven"));
}

test("oven fork rewrites the DSL root id to the fork id", () => {
  const context = fixture();
  const ovensDir = join(context.repo, ".local", "burnlist", "ovens");
  try {
    writeOven(ovensDir, "source-oven");
    const catalog = JSON.parse(run(context, "oven", "list", "--json", "--ovens-dir", ovensDir));
    assert.equal(catalog.some((oven) => oven.id === "source-oven"), true);

    run(context, "oven", "fork", "source-oven", "forked-oven", "--ovens-dir", ovensDir);

    const forked = JSON.parse(run(context, "oven", "view", "forked-oven", "--json", "--ovens-dir", ovensDir));
    const compiled = compileOven(forked.oven);
    assert.equal(compiled.ok, true);
    assert.equal(compiled.ir.id, "forked-oven");
  } finally { context.cleanup(); }
});
