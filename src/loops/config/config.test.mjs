import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { localRecordPath, configRoot, writeLocalRecord } from "./store.mjs";
import { capabilityRevision, readCapabilityCatalog } from "../capabilities/contract.mjs";
import { validateProfile } from "./profiles.mjs";

const root = resolve(new URL("../../..", import.meta.url).pathname);
const cli = join(root, "bin", "burnlist.mjs");
const policy = { id: "repo-verify", argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", environment: { inherit: ["PATH"], set: {} }, network: "deny", filesystem: { read: ["src"], write: [] }, output: { maxBytes: 1024 }, maxMilliseconds: 1000 };

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-loop-config-"))), repo = join(directory, "repo");
  mkdirSync(join(repo, ".burnlist"), { recursive: true }); mkdirSync(join(repo, "src")); execFileSync("git", ["init", "--quiet", repo]);
  writeFileSync(join(repo, ".burnlist", "loop-capabilities.json"), `${JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities: [policy] })}\n`);
  const marker = join(directory, "child-ran"), binary = join(directory, "fake-codex");
  writeFileSync(binary, `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`, { mode: 0o700 });
  return { directory, repo, binary, marker, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
function run(context, args) { return spawnSync(process.execPath, [cli, ...args, "--repo", context.repo], { cwd: context.repo, encoding: "utf8" }); }
function profile(context, id, authority) {
  const result = run(context, ["agent", "profile", "add", id, "--adapter", "builtin:codex-cli", "--binary", context.binary, "--model", "gpt-5.6-terra", "--effort", "medium", "--authority", authority]);
  assert.equal(result.status, 0, result.stderr); return result;
}
function route(context, name, id) { const result = run(context, ["route", "set", name, "--profile", id]); assert.equal(result.status, 0, result.stderr); }
function trust(context) {
  const grants = join(context.repo, "grants.json");
  writeFileSync(grants, `${JSON.stringify(Object.fromEntries(Object.entries(policy).filter(([key]) => key !== "id")))}\n`);
  const revision = capabilityRevision(readCapabilityCatalog(context.repo).capabilities[0]);
  const result = run(context, ["loop", "capability", "trust", "repo-verify", "--revision", revision, "--grants", grants]);
  assert.equal(result.status, 0, result.stderr);
}

test("M1 setup trusts only private configuration, exact routes, and repo-verify without launching", () => {
  const context = fixture();
  try {
    const empty = run(context, ["loop", "setup", "status"]);
    assert.equal(empty.status, 1); assert.match(empty.stdout, /MISSING route implementation\.standard/u); assert.match(empty.stdout, /MISSING trust repo-verify/u);
    const maker = profile(context, "maker", "write");
    assert.equal(readFileSync(localRecordPath(context.repo, "profiles", "maker"), "utf8"), maker.stdout);
    assert.equal(lstatSync(localRecordPath(context.repo, "profiles", "maker")).mode & 0o777, 0o600);
    assert.equal(lstatSync(configRoot(context.repo)).mode & 0o777, 0o700);
    route(context, "implementation.standard", "maker"); profile(context, "reviewer", "read"); route(context, "review.strong", "reviewer"); trust(context);
    const status = run(context, ["loop", "setup", "status"]);
    assert.equal(status.status, 0, status.stderr); assert.equal(status.stdout, "Loop setup: ready\n");
    assert.equal(existsSync(context.marker), false);
  } finally { context.cleanup(); }
});

test("fresh repositories receive actionable capability and profile guidance", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-loop-fresh-"))), repo = join(directory, "repo");
  try {
    mkdirSync(repo, { recursive: true }); execFileSync("git", ["init", "--quiet", repo]);
    const inspect = spawnSync(process.execPath, [cli, "loop", "capability", "inspect", "repo-verify", "--repo", repo], { cwd: repo, encoding: "utf8" });
    assert.equal(inspect.status, 1); assert.match(inspect.stderr, /create \.burnlist\/loop-capabilities\.json/u);
    const setup = spawnSync(process.execPath, [cli, "loop", "setup", "status", "--repo", repo], { cwd: repo, encoding: "utf8" });
    assert.equal(setup.status, 1); assert.match(setup.stdout, /Review Loop capability example/u);
    const invalid = spawnSync(process.execPath, [cli, "agent", "profile", "add", "maker", "--adapter", "builtin:codex-cli", "--binary", process.execPath, "--model", "unknown", "--effort", "fast", "--authority", "write", "--repo", repo], { cwd: repo, encoding: "utf8" });
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /model must be one of:.*gpt-5\.6-terra/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("M1 setup fails closed for duplicate, malformed, wrong-authority, and untrusted configuration", () => {
  for (const scenario of ["duplicate", "wrong-authority", "malformed", "untrusted"]) {
    const context = fixture();
    try {
      profile(context, "maker", "write"); route(context, "implementation.standard", "maker");
      if (scenario === "duplicate") route(context, "review.strong", "maker");
      else { profile(context, "reviewer", scenario === "wrong-authority" ? "write" : "read"); route(context, "review.strong", "reviewer"); }
      if (scenario === "malformed") writeFileSync(localRecordPath(context.repo, "profiles", "reviewer"), "{}\n", { mode: 0o600 });
      if (scenario !== "untrusted") trust(context);
      const result = run(context, ["loop", "setup", "status"]);
      assert.equal(result.status, 1, scenario); assert.match(result.stdout, /MISSING (routing|profile|trust)/u); assert.equal(existsSync(context.marker), false);
    } finally { context.cleanup(); }
  }
});

test("legacy Docker commands are unsupported and configuration writes fail closed when public", () => {
  const context = fixture();
  try {
    for (const args of [["agent", "controller", "add", "host"], ["agent", "preflight", "maker"]]) {
      const result = run(context, args); assert.equal(result.status, 2); assert.match(result.stderr, /Usage: burnlist agent profile add/u);
    }
    profile(context, "maker", "write"); chmodSync(configRoot(context.repo), 0o755);
    const result = run(context, ["route", "set", "implementation.standard", "--profile", "maker"]);
    assert.equal(result.status, 1); assert.match(result.stderr, /unsafe config directory/u);
  } finally { context.cleanup(); }
});

test("setup read fails closed after config-v1 privacy drifts without mutation", () => {
  const context = fixture();
  try {
    profile(context, "maker", "write"); route(context, "implementation.standard", "maker"); profile(context, "reviewer", "read"); route(context, "review.strong", "reviewer"); trust(context);
    const profilePath = localRecordPath(context.repo, "profiles", "maker"), before = readFileSync(profilePath);
    chmodSync(configRoot(context.repo), 0o755);
    const result = run(context, ["loop", "setup", "status"]);
    assert.equal(result.status, 1); assert.match(result.stdout, /unsafe config directory/u);
    assert.deepEqual(readFileSync(profilePath), before); assert.equal(existsSync(context.marker), false);
  } finally { context.cleanup(); }
});

test("private profile publication is atomic when publication is interrupted", () => {
  const context = fixture();
  try {
    const value = { schema: "burnlist-loop-agent-profile@1", id: "maker", adapter: "builtin:codex-cli", binary: context.binary, model: "gpt-5.6-terra", effort: "medium", authority: "write" };
    assert.throws(() => writeLocalRecord({ repoRoot: context.repo, collection: "profiles", name: "maker", value, validate: validateProfile, hooks: { beforeRename() { throw new Error("cut"); } } }), /cut/u);
    assert.equal(existsSync(localRecordPath(context.repo, "profiles", "maker")), false);
  } finally { context.cleanup(); }
});
