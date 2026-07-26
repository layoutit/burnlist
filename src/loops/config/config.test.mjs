import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { capabilityRevision, readCapabilityCatalog } from "../capabilities/contract.mjs";

const root = resolve(new URL("../../..", import.meta.url).pathname);
const cli = join(root, "bin", "burnlist.mjs");
const policy = { id: "repo-verify", argv: [process.execPath, "-e", "process.exit(0)"],
  cwd: ".", environment: { inherit: ["PATH"], set: {} }, network: "deny",
  filesystem: { read: ["src"], write: [] }, output: { maxBytes: 1024 },
  maxMilliseconds: 1000 };

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-loop-config-")));
  const repo = join(directory, "repo");
  mkdirSync(join(repo, ".burnlist"), { recursive: true });
  mkdirSync(join(repo, "src"));
  execFileSync("git", ["init", "--quiet", repo]);
  writeFileSync(join(repo, ".burnlist", "loop-capabilities.json"),
    `${JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities: [policy] })}\n`);
  return { directory, repo, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function run(context, args) {
  return spawnSync(process.execPath, [cli, ...args, "--repo", context.repo],
    { cwd: context.repo, encoding: "utf8" });
}

function trust(context) {
  const grants = join(context.repo, "grants.json");
  writeFileSync(grants, `${JSON.stringify(Object.fromEntries(
    Object.entries(policy).filter(([key]) => key !== "id")))}\n`);
  const revision = capabilityRevision(readCapabilityCatalog(context.repo).capabilities[0]);
  return run(context, ["loop", "capability", "trust", "repo-verify",
    "--revision", revision, "--grants", grants]);
}

test("host-only setup requires capability trust but no agent profiles or routes", () => {
  const context = fixture();
  try {
    const empty = run(context, ["loop", "setup", "status"]);
    assert.equal(empty.status, 1);
    assert.match(empty.stdout, /MISSING trust repo-verify/u);
    assert.doesNotMatch(empty.stdout, /profile|route|adapter/u);
    const trusted = trust(context);
    assert.equal(trusted.status, 0, trusted.stderr);
    const ready = run(context, ["loop", "setup", "status"]);
    assert.equal(ready.status, 0, ready.stderr);
    assert.equal(ready.stdout, "Loop setup: ready\n");
  } finally { context.cleanup(); }
});

test("removed managed-agent commands are not Loop configuration surfaces", () => {
  const context = fixture();
  try {
    for (const args of [["agent", "profile", "add", "maker"], ["route", "set", "review.strong"]]) {
      const result = run(context, args);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /builtin:codex-cli/u);
    }
  } finally { context.cleanup(); }
});

test("fresh repositories receive actionable capability-only guidance", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-loop-fresh-")));
  const repo = join(directory, "repo");
  try {
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "--quiet", repo]);
    const setup = spawnSync(process.execPath,
      [cli, "loop", "setup", "status", "--repo", repo], { cwd: repo, encoding: "utf8" });
    assert.equal(setup.status, 1);
    assert.match(setup.stdout, /Review Loop capability example/u);
    assert.doesNotMatch(setup.stdout, /profile|route|adapter/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
