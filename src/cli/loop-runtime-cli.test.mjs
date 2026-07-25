import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createProductionRunAuthority, fixtureItemRef } from "../loops/run/run-test-fixtures.mjs";
import { runLoopCli } from "./loop-cli.mjs";
import { runStore } from "../loops/run/run-store.mjs";
import { createLoopController } from "../loops/run/controller.mjs";
import { prepareHostClaim } from "../loops/run/host-execution.mjs";
import { createProductionRun } from "../loops/run/binder.mjs";
import { fixtureRunId } from "../loops/run/run-test-fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "burnlist.mjs");
function command(repo, args, env = {}) {
  const result = spawnSync(process.execPath, [cli, "loop", ...args, "--repo", repo], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.stderr, "", `${args.join(" ")}: ${result.stderr}`); assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout}`); return result.stdout;
}
function created(repo) { return JSON.parse(command(repo, ["create", fixtureItemRef])).runId; }
function hostReport(execution, outcome) {
  return { schema: "burnlist-loop-host-report@1", result: {
    schema: "agent-result@1", runId: execution.runId, nodeId: execution.nodeId, attempt: execution.attempt,
    claimId: execution.claimId, assignmentId: execution.assignmentId, invocationId: execution.invocationId,
    recipeRevision: execution.recipeRevision, policyRevision: execution.policyRevision,
    inputCandidate: execution.inputCandidate, outcome, findings: [], resolvedFindingIds: [],
  }, telemetry: null };
}

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
  const completed = JSON.parse(command(repo, ["run", first], { BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,complete,complete,approve,complete,approve" }));
  assert.equal(completed.state, "converged"); assert.deepEqual(readFileSync(authority), bytes);
  const blocked = spawnSync(process.execPath, [cli, "loop", "create", fixtureItemRef, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(blocked.status, 1); assert.match(blocked.stderr, /current Run is still executable/u);
});

test("real CLI fences active control and proof-gates reconcile", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "m6-cli-fence-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
  const held = spawnSync(process.execPath, ["--input-type=module", "-e", `import{runStore}from${JSON.stringify(new URL("../loops/run/run-store.mjs", import.meta.url).href)};const s=runStore(process.argv[1]),a=s.acquireLease(process.argv[2]);s.append(process.argv[2],a.lease,"node-started",{nodeId:"start",attempt:1});s.append(process.argv[2],a.lease,"invocation-started",{nodeId:"start",attempt:1,invocationId:"${"a".repeat(32)}"});process.stdout.write(a.recoveryProof);`, repo, runId], { cwd: repo, encoding: "utf8" });
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
  writeFileSync(counter, "0"); assert.equal(JSON.parse(command(repo, ["run", runId], { BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,complete,complete,approve,complete,approve" })).state, "converged");
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

test("host CLI claims once, rejects claim theft, accepts one bound report, rejects conflict, and observes the next node after restart", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "s1-host-cli-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
  assert.equal(JSON.parse(command(repo, ["next", runId])).currentNode, "start");
  const first = JSON.parse(command(repo, ["claim", runId]));
  const replayed = spawnSync(process.execPath, [cli, "loop", "claim", runId, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(replayed.status, 1);
  assert.equal(replayed.stdout, "");
  assert.match(replayed.stderr, /already claimed/u);
  assert.equal(runStore(repo).read(runId).journal.filter((record) => record.value.type === "external-claim-bound").length, 1);
  const binding = first.execution;
  const report = {
    schema: "burnlist-loop-host-report@1",
    result: {
      schema: "agent-result@1", runId: binding.runId, nodeId: binding.nodeId, attempt: binding.attempt,
      claimId: binding.claimId, assignmentId: binding.assignmentId, invocationId: binding.invocationId,
      recipeRevision: binding.recipeRevision, policyRevision: binding.policyRevision,
      inputCandidate: binding.inputCandidate, outcome: "complete", findings: [], resolvedFindingIds: [],
    },
    telemetry: null,
  };
  const resultPath = join(directory, "report.json"); writeFileSync(resultPath, `${JSON.stringify(report)}\n`);
  const runRefReport = spawnSync(process.execPath, [cli, "loop", "report", runId, "--result", resultPath, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(runRefReport.status, 1); assert.match(runRefReport.stderr, /invalid ClaimRef/u);
  const missingClaim = `cl1-sha256:${"f".repeat(64)}`;
  const missing = spawnSync(process.execPath, [cli, "loop", "report", missingClaim, "--result", resultPath, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /ClaimRef is missing/u);
  assert.equal(JSON.parse(command(repo, ["report", binding.claimId, "--result", resultPath])).currentNode, "decompose");
  assert.equal(JSON.parse(command(repo, ["report", binding.claimId, "--result", resultPath])).currentNode, "decompose");
  writeFileSync(resultPath, `${JSON.stringify({ ...report, telemetry: {
    schema: "burnlist-loop-host-telemetry@1", provenance: "host-reported", executor: "fixture",
    displayName: null, provider: null, model: null, effort: null, startedAt: null, completedAt: null,
    inputTokens: null, outputTokens: null,
  } })}\n`);
  const conflict = spawnSync(process.execPath, [cli, "loop", "report", binding.claimId, "--result", resultPath, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(conflict.status, 1); assert.match(conflict.stderr, /conflicts/u);
  assert.equal(JSON.parse(command(repo, ["next", runId])).currentNode, "decompose");
});

test("host CLI rejects misplaced result options and unsafe files, then abandons only its active claim", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "h4-host-cli-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
  const claimed = JSON.parse(command(repo, ["claim", runId])).execution, reportPath = join(directory, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(hostReport(claimed, "complete"))}\n`);
  const invoke = (...args) => spawnSync(process.execPath, [cli, "loop", ...args, "--repo", repo], { cwd: repo, encoding: "utf8" });
  const misplaced = invoke("claim", runId, "--result", reportPath);
  assert.equal(misplaced.status, 2); assert.match(misplaced.stderr, /Usage: burnlist loop/u);
  const missing = invoke("report", claimed.claimId);
  assert.equal(missing.status, 2); assert.match(missing.stderr, /Usage: burnlist loop/u);
  const symlink = join(directory, "report-link.json"); symlinkSync(reportPath, symlink);
  const unsafe = invoke("report", claimed.claimId, "--result", symlink);
  assert.equal(unsafe.status, 1); assert.match(unsafe.stderr, /unsafe or exceeds bounds/u);
  assert.equal(runStore(repo).read(runId).projection.currentNode, "start");
  const invalidReason = invoke("abandon", claimed.claimId, "--reason", "retry");
  assert.equal(invalidReason.status, 1); assert.match(invalidReason.stderr, /invalid host claim abandonment reason/u);
  const abandoned = invoke("abandon", claimed.claimId, "--reason", "host-cancelled");
  assert.equal(abandoned.status, 0, abandoned.stderr); assert.equal(JSON.parse(abandoned.stdout).state, "needs-human");
  const stale = invoke("abandon", claimed.claimId, "--reason", "host-cancelled");
  assert.equal(stale.status, 1); assert.match(stale.stderr, /stale|missing/u);
});

test("Loop option syntax and ownership fail as usage errors before every verb dispatch", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "h4-option-cli-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const invoke = (...args) => spawnSync(process.execPath, [cli, "loop", ...args, "--repo", repo], { cwd: repo, encoding: "utf8" });
  for (const args of [
    ["create", fixtureItemRef, "--result", "report.json"], ["complete", "run:bad", "--reason", "host-lost"],
    ["assign", fixtureItemRef, "loop:builtin:review", "--recovery-proof", "a".repeat(64)], ["unassign", fixtureItemRef, "--result", "report.json"],
    ["view", fixtureItemRef, "--reason", "host-lost"], ["list", "--recovery-proof", "a".repeat(64)],
  ]) {
    const result = invoke(...args); assert.equal(result.status, 2, args.join(" ")); assert.match(result.stderr, /Usage: burnlist loop/u);
  }
  for (const args of [
    ["list", "--unknown"], ["list", "--repo", repo], ["list", "--repo", repo], ["list", "--result"],
    ["list", "--recovery-proof", "not-hex"], ["list", "--reason", "host-lost", "--reason", "host-cancelled"],
  ]) {
    const result = invoke(...args); assert.equal(result.status, 2, args.join(" ")); assert.doesNotMatch(result.stderr, /Loop control:/u);
  }
});

test("a review claim refuses workspace drift before its report can advance", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "h3-review-drift-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo), resultPath = join(directory, "report.json");
  for (const expected of ["start", "decompose", "implement"]) {
    const execution = JSON.parse(command(repo, ["claim", runId])).execution;
    assert.equal(execution.nodeId, expected);
    writeFileSync(resultPath, `${JSON.stringify(hostReport(execution, "complete"))}\n`);
    command(repo, ["report", execution.claimId, "--result", resultPath]);
  }
  const store = runStore(repo), validation = store.acquireLease(runId).lease, candidateId = store.read(runId).execution.candidate.id;
  store.append(runId, validation, "node-started", { nodeId: "validate", attempt: 1 });
  store.append(runId, validation, "invocation-started", { nodeId: "validate", attempt: 1, invocationId: "a".repeat(32) });
  store.append(runId, validation, "invocation-result", { invocationId: "a".repeat(32), kind: "pass", summary: "trusted", outputBytes: 0, candidateId });
  store.append(runId, validation, "edge-taken", { from: "validate", on: "pass", to: "review" }); store.releaseLease(runId, validation);
  const controller = createLoopController({ store, repoRoot: repo });
  const capturedBeforeDrift = prepareHostClaim({ repoRoot: repo, replay: store.read(runId), authority: store.readAuthority(runId) });
  const preClaimDrift = join(repo, "src", "drift-before-review-claim.txt"); writeFileSync(preClaimDrift, "changed\n");
  assert.throws(() => controller.claim(runId, capturedBeforeDrift), /candidate drift before review claim/u);
  rmSync(preClaimDrift);
  const review = JSON.parse(command(repo, ["claim", runId])).execution;
  assert.equal(review.nodeId, "review");
  writeFileSync(join(repo, "src", "drift-after-review-claim.txt"), "changed\n");
  writeFileSync(resultPath, `${JSON.stringify(hostReport(review, "approve"))}\n`);
  const rejected = spawnSync(process.execPath, [cli, "loop", "report", review.claimId, "--result", resultPath, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, /candidate drifted/u);
  assert.equal(store.read(runId).projection.currentNode, "review");
});

test("host report retries complete every committed transaction tail after deliberate restart cuts", (t) => {
  for (const cut of ["afterExternalReportAccepted", "afterExternalEdgeTaken"]) {
    const directory = mkdtempSync(join(tmpdir(), `h2-host-${cut}-`)); t.after(() => rmSync(directory, { recursive: true, force: true }));
    const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
    const claimed = JSON.parse(command(repo, ["claim", runId])).execution;
    const report = Buffer.from(`${JSON.stringify({
      schema: "burnlist-loop-host-report@1",
      result: { schema: "agent-result@1", runId: claimed.runId, nodeId: claimed.nodeId, attempt: claimed.attempt,
        claimId: claimed.claimId, assignmentId: claimed.assignmentId, invocationId: claimed.invocationId,
        recipeRevision: claimed.recipeRevision, policyRevision: claimed.policyRevision, inputCandidate: claimed.inputCandidate,
        outcome: "complete", findings: [], resolvedFindingIds: [] }, telemetry: null,
    })}\n`);
    const cutStore = runStore(repo, { hooks: { [cut]() { throw new Error(`deliberate ${cut}`); } } });
    const interrupted = createLoopController({ store: cutStore, repoRoot: repo });
    assert.throws(() => interrupted.report(claimed.claimId, report), new RegExp(`deliberate ${cut}`, "u"));
    const restartedStore = runStore(repo), restarted = createLoopController({ store: restartedStore, repoRoot: repo });
    assert.equal(restarted.report(claimed.claimId, report).currentNode, "decompose");
    const replay = restartedStore.read(runId);
    assert.equal(replay.execution.lease, null);
    assert.equal(replay.journal.filter((record) => record.value.type === "external-report-accepted").length, 1);
    assert.equal(replay.journal.filter((record) => record.value.type === "edge-taken").length, 1);
    assert.equal(replay.journal.filter((record) => record.value.type === "lease-released").length, 1);
    assert.equal(restarted.report(claimed.claimId, report).currentNode, "decompose");
  }
});

test("concurrent external claims expose the envelope to exactly one winner", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "h2-host-claim-race-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
  const claim = () => new Promise((done) => {
    const child = spawn(process.execPath, [cli, "loop", "claim", runId, "--repo", repo], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const results = await Promise.all([claim(), claim()]), successful = results.filter((value) => value.status === 0);
  assert.equal(successful.length, 1);
  assert.match(results.find((value) => value.status !== 0).stderr, /locked|lease|active foreground owner|already claimed/u);
  const retry = spawnSync(process.execPath, [cli, "loop", "claim", runId, "--repo", repo], { cwd: repo, encoding: "utf8" });
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /already claimed/u);
  assert.equal(runStore(repo).read(runId).journal.filter((record) => record.value.type === "external-claim-bound").length, 1);
});

test("near journal capacity terminalizes before an external report can strand its lease", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "h2-host-capacity-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
  const claimed = JSON.parse(command(repo, ["claim", runId])).execution, invalidations = [];
  const report = Buffer.from(`${JSON.stringify({ schema: "burnlist-loop-host-report@1",
    result: { schema: "agent-result@1", runId: claimed.runId, nodeId: claimed.nodeId, attempt: claimed.attempt,
      claimId: claimed.claimId, assignmentId: claimed.assignmentId, invocationId: claimed.invocationId,
      recipeRevision: claimed.recipeRevision, policyRevision: claimed.policyRevision, inputCandidate: claimed.inputCandidate,
      outcome: "complete", findings: [], resolvedFindingIds: [] }, telemetry: null })}\n`);
  // A reduced bound is a deterministic stand-in for records 252–255; the
  // production ceiling remains MAX_JOURNAL_RECORDS.
  const constrained = runStore(repo, { journalMaximum: 8, publishProjection(_root, replay) { invalidations.push(replay); } });
  const controller = createLoopController({ store: constrained, repoRoot: repo });
  assert.equal(controller.report(claimed.claimId, report).state, "budget-exhausted");
  const replay = constrained.read(runId);
  assert.equal(replay.execution.lease, null);
  assert.equal(replay.journal.filter((record) => record.value.type === "external-report-accepted").length, 0);
  assert.equal(replay.journal.at(-1).value.type, "terminal-node-committed");
  assert.equal(invalidations.length, 1);
  assert.equal(invalidations[0].projection.itemRef, fixtureItemRef);
  assert.throws(() => controller.report(claimed.claimId, report), /stale lease/u);
});

test("near journal capacity cut after edge retries only the release tail", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "h2-host-capacity-cut-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), runId = created(repo);
  const claimed = JSON.parse(command(repo, ["claim", runId])).execution, invalidations = [];
  const report = Buffer.from(`${JSON.stringify({ schema: "burnlist-loop-host-report@1",
    result: { schema: "agent-result@1", runId: claimed.runId, nodeId: claimed.nodeId, attempt: claimed.attempt,
      claimId: claimed.claimId, assignmentId: claimed.assignmentId, invocationId: claimed.invocationId,
      recipeRevision: claimed.recipeRevision, policyRevision: claimed.policyRevision, inputCandidate: claimed.inputCandidate,
      outcome: "complete", findings: [], resolvedFindingIds: [] }, telemetry: null })}\n`);
  const cutStore = runStore(repo, { journalMaximum: 9, hooks: { afterExternalEdgeTaken() { throw new Error("near-capacity cut"); } } });
  assert.throws(() => createLoopController({ store: cutStore, repoRoot: repo }).report(claimed.claimId, report), /near-capacity cut/u);
  const restartedStore = runStore(repo, { journalMaximum: 9, publishProjection(_root, replay) { invalidations.push(replay); } });
  assert.equal(createLoopController({ store: restartedStore, repoRoot: repo }).report(claimed.claimId, report).currentNode, "decompose");
  const replay = restartedStore.read(runId);
  assert.equal(replay.execution.lease, null);
  assert.equal(replay.journal.filter((record) => record.value.type === "external-report-accepted").length, 1);
  assert.equal(replay.journal.filter((record) => record.value.type === "edge-taken").length, 1);
  assert.equal(replay.journal.filter((record) => record.value.type === "lease-released").length, 1);
  assert.equal(invalidations.length, 1);
  assert.equal(invalidations[0].projection.itemRef, fixtureItemRef);
});
