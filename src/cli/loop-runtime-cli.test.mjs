import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createProductionRunAuthority, fixtureItemRef } from "../loops/run/run-test-fixtures.mjs";
import { runLoopCli } from "./loop-cli.mjs";
import { runStore } from "../loops/run/run-store.mjs";
import { createProductionRun } from "../loops/run/binder.mjs";
import { fixtureRunId } from "../loops/run/run-test-fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "burnlist.mjs");
function command(repo, args, env = {}) {
  const result = spawnSync(process.execPath, [cli, "loop", ...args, "--repo", repo], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.stderr, "", `${args.join(" ")}: ${result.stderr}`); assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout}`); return result.stdout;
}
function created(repo) { return JSON.parse(command(repo, ["create", fixtureItemRef])).runId; }

test("real CLI control reads are stable, list is absent-state read-only, and stored authority drives run/resume", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "m6-cli-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runs = join(repo, ".local", "burnlist", "loop", "m2", "runs");
  assert.equal(command(repo, ["list"]), "[]\n"); assert.equal(existsSync(runs), false);
  const first = created(repo), status = command(repo, ["status", first]), inspect = command(repo, ["inspect", first]);
  for (const publicView of [JSON.parse(status), JSON.parse(inspect)]) {
    assert.equal(publicView.loopId, "review");
    assert.match(publicView.loopRevision, /^er1-sha256:[a-f0-9]{64}$/u);
    assert.equal(Number.isSafeInteger(publicView.createdAt), true);
    assert.equal(Number.isSafeInteger(publicView.updatedAt), true);
  }
  assert.equal(command(repo, ["status", first]), status); assert.equal(command(repo, ["inspect", first]), inspect);
  const authority = join(runs, Buffer.from(first).toString("hex"), "dispatch-authority.json"), bytes = readFileSync(authority);
  const counter = join(directory, "counter"); writeFileSync(counter, "0");
  const completed = JSON.parse(command(repo, ["run", first], { BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,approve" }));
  assert.equal(completed.state, "converged"); assert.deepEqual(readFileSync(authority), bytes);
  const blocked = spawnSync(process.execPath, [cli, "loop", "create", fixtureItemRef, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(blocked.status, 1); assert.match(blocked.stderr, /current Run is still executable/u);
});

test("real CLI fences active control and proof-gates reconcile", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "m6-cli-fence-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
  const held = spawnSync(process.execPath, ["--input-type=module", "-e", `import{runStore}from${JSON.stringify(new URL("../loops/run/run-store.mjs", import.meta.url).href)};const s=runStore(process.argv[1]),a=s.acquireLease(process.argv[2]);s.append(process.argv[2],a.lease,"node-started",{nodeId:"implement",attempt:1});s.append(process.argv[2],a.lease,"invocation-started",{nodeId:"implement",attempt:1,invocationId:"${"a".repeat(32)}"});process.stdout.write(a.recoveryProof);`, repo, runId], { cwd: repo, encoding: "utf8" });
  assert.equal(held.status, 0, held.stderr);
  const result = spawnSync(process.execPath, [cli, "loop", "pause", runId, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 1); assert.match(result.stderr, /active foreground owner/u);
  const reconcile = spawnSync(process.execPath, [cli, "loop", "reconcile", runId, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(reconcile.status, 1); assert.match(reconcile.stderr, /not demonstrably lost/u);
  assert.equal(JSON.parse(command(repo, ["reconcile", runId, "--recovery-proof", held.stdout])).state, "needs-human");
});

test("loop complete is the public, idempotent completion command", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "m8-cli-complete-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo), counter = join(directory, "counter");
  writeFileSync(counter, "0"); assert.equal(JSON.parse(command(repo, ["run", runId], { BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,approve" })).state, "converged");
  assert.equal(JSON.parse(command(repo, ["complete", runId])).alreadyApplied, false);
  assert.equal(JSON.parse(command(repo, ["complete", runId])).alreadyApplied, true);
});

test("a stopped current Run permits a safe replacement, while an executable Run does not", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "m8-current-replace-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), first = created(repo);
  assert.equal(JSON.parse(command(repo, ["stop", first])).state, "stopped");
  const second = created(repo); assert.notEqual(second, first);
  const old = spawnSync(process.execPath, [cli, "loop", "run", first, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(old.status, 1); assert.match(old.stderr, /superseded and cannot launch/u);
});

test("ordinary CLI create recovers an unpublished current reservation without requiring its RunRef", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "m12-cli-create-retry-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const cut = runStore(repo, { hooks: { beforeRunPublish() { throw new Error("publication cut"); } } });
  await assert.rejects(createProductionRun({ repoRoot: repo, store: cut, itemRef: fixtureItemRef, runId: fixtureRunId }), /publication cut/u);
  assert.equal(cut.readCurrentRun(fixtureItemRef).runId, fixtureRunId);
  assert.equal(JSON.parse(command(repo, ["create", fixtureItemRef])).runId, fixtureRunId);
});

test("concurrent replacement creates exactly one executable current Run", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "m8-current-race-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), first = created(repo);
  command(repo, ["stop", first]);
  const launch = () => new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [cli, "loop", "create", fixtureItemRef, "--repo", repo], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
  const results = await Promise.all([launch(), launch()]);
  assert.equal(results.filter((result) => result.status === 0).length, 1); assert.equal(results.filter((result) => result.status === 1).length, 1);
  const current = runStore(repo).readCurrentRun(fixtureItemRef); assert.equal(current.runId, JSON.parse(results.find((result) => result.status === 0).stdout).runId);
});

test("a second CLI SIGINT reaches controlled stop before the foreground runner settles", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "m6-cli-signal-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
  const processObject = new EventEmitter(), calls = [];
  let settle;
  const pending = new Promise((resolvePromise) => { settle = resolvePromise; });
  const store = runStore(repo);
  const runner = {
    requestPause() { calls.push("pause"); },
    requestStop() { calls.push("stop"); },
    async run() { await pending; return store.read(runId); },
  };
  const output = { value: "", write(chunk) { this.value += chunk; } };
  const commandPromise = runLoopCli(["run", runId, "--repo", repo], {
    processObject,
    runnerFor: () => runner,
    stdout: output,
  });
  processObject.emit("SIGINT");
  processObject.emit("SIGINT");
  assert.deepEqual(calls, ["pause", "stop"]);
  assert.equal(processObject.listenerCount("SIGINT"), 1);
  settle();
  await commandPromise;
  assert.equal(processObject.listenerCount("SIGINT"), 0);
  assert.equal(JSON.parse(output.value).runId, runId);
});
