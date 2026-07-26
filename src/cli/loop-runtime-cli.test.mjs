import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createProductionRunAuthority, fixtureItemRef } from "../loops/run/run-test-fixtures.mjs";
import { runStore } from "../loops/run/run-store.mjs";
import { testGraph } from "../loops/run/m2-test-fixtures.mjs";
import { newRunId } from "../loops/run/run-codec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "burnlist.mjs");

function invoke(repo, args) {
  return spawnSync(process.execPath, [cli, "loop", ...args, "--repo", repo],
    { cwd: repo, encoding: "utf8" });
}
function command(repo, args) {
  const result = invoke(repo, args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout;
}
function created(repo) {
  return JSON.parse(command(repo, ["create", fixtureItemRef])).runId;
}
function hostReport(execution, outcome) {
  return { schema: "burnlist-loop-host-report@1", result: {
    schema: "agent-result@1", runId: execution.runId, nodeId: execution.nodeId,
    attempt: execution.attempt, claimId: execution.claimId,
    assignmentId: execution.assignmentId, invocationId: execution.invocationId,
    recipeRevision: execution.recipeRevision, policyRevision: execution.policyRevision,
    inputCandidate: execution.inputCandidate, outcome, findings: [],
    resolvedFindingIds: [],
  }, telemetry: null };
}

test("host-only CLI exposes stable reads and no managed run command", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "host-only-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  assert.equal(command(repo, ["list"]), "[]\n");
  const runId = created(repo);
  const status = JSON.parse(command(repo, ["status", runId]));
  assert.equal(status.currentNode, "implement");
  assert.equal(command(repo, ["status", runId]), command(repo, ["status", runId]));
  for (const verb of ["run", "resume"]) {
    const result = invoke(repo, [verb, runId]);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, /codex|adapter|profile/u);
  }
});

test("production list and prune remain operational beyond 128 retained Runs", { timeout: 30_000 }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), "retained-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const store = runStore(repo, { publishProjection() {} }), runIds = [];
  for (let index = 0; index < 130; index += 1) {
    const runId = newRunId({ now: () => index + 1,
      random: () => Buffer.alloc(10, (index % 250) + 1) });
    runIds.push(runId);
    store.createRun({ runId, itemRef: `item:260722-001#H${index}`, graph: testGraph });
  }
  store.terminalize(runIds[0], store.acquireLease(runIds[0]).lease, "cancelled", "retention");
  store.terminalize(runIds[2], store.acquireLease(runIds[2]).lease, "error", "retention");
  const listed = JSON.parse(command(repo, ["list"]));
  assert.equal(listed.length, 128);
  assert.equal(listed.some((entry) => entry.runId === runIds[0]), false);
  assert.equal(listed.some((entry) => entry.runId === runIds.at(-1)), true);
  const pruned = JSON.parse(command(repo, ["prune", "--retain", "128"]));
  assert.deepEqual(pruned, {
    schema: "burnlist-loop-retention@1", retain: 128, before: 130,
    archived: 2, retained: 128, protected: 128,
  });
  assert.equal(existsSync(join(store.paths.archiveRuns, Buffer.from(runIds[0]).toString("hex"))), true);
  assert.equal(existsSync(join(store.paths.archiveRuns, Buffer.from(runIds[2]).toString("hex"))), true);
  assert.equal(existsSync(store.paths.pathFor(runIds[1])), true, "nonterminal history stays protected");
  assert.equal(JSON.parse(command(repo, ["prune", "--retain", "128"])).archived, 0);
});

test("prune protects a safely terminal Run while it remains current authority", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "current-retention-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo);
  assert.equal(JSON.parse(command(repo, ["stop", runId])).state, "stopped");
  assert.deepEqual(JSON.parse(command(repo, ["prune", "--retain", "0"])), {
    schema: "burnlist-loop-retention@1", retain: 0, before: 1,
    archived: 0, retained: 1, protected: 1,
  });
  assert.equal(existsSync(runStore(repo).paths.pathFor(runId)), true);
});

test("prune preserves ClaimRef-backed accepted-report retries", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "claimed-retention-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo), reportPath = join(directory, "report.json");
  const execution = JSON.parse(command(repo, ["claim", runId])).execution;
  writeFileSync(reportPath, `${JSON.stringify(hostReport(execution, "complete"))}\n`);
  command(repo, ["report", execution.claimId, "--result", reportPath]);
  command(repo, ["stop", runId]);
  const replacement = created(repo);
  assert.notEqual(replacement, runId);

  const pruned = JSON.parse(command(repo, ["prune", "--retain", "1"]));
  assert.equal(pruned.archived, 0);
  assert.equal(pruned.protected, 2);
  assert.equal(existsSync(runStore(repo).paths.pathFor(runId)), true);
  assert.equal(JSON.parse(command(repo, [
    "report", execution.claimId, "--result", reportPath,
  ])).state, "stopped");
});

test("claim and report advance checks and gates without launching a provider", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "host-report-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo), reportPath = join(directory, "report.json");
  const visited = [];
  for (let attempts = 0; attempts < 12; attempts += 1) {
    const state = JSON.parse(command(repo, ["status", runId]));
    if (state.state === "converged") break;
    const execution = JSON.parse(command(repo, ["claim", runId])).execution;
    visited.push(execution.nodeId);
    const outcome = ["review", "final-review"].includes(execution.nodeId)
      ? "approve" : "complete";
    writeFileSync(reportPath, `${JSON.stringify(hostReport(execution, outcome))}\n`);
    command(repo, ["report", execution.claimId, "--result", reportPath]);
  }
  assert.deepEqual(visited, ["implement", "review"]);
  assert.equal(JSON.parse(command(repo, ["status", runId])).state, "converged");
  assert.equal(JSON.parse(command(repo, ["complete", runId])).alreadyApplied, false);
  assert.equal(JSON.parse(command(repo, ["complete", runId])).alreadyApplied, true);
});

test("simple successful outcomes do not require a hand-authored report", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "host-simple-report-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo);
  for (let attempts = 0; attempts < 12; attempts += 1) {
    if (JSON.parse(command(repo, ["status", runId])).state === "converged") break;
    const execution = JSON.parse(command(repo, ["claim", runId])).execution;
    command(repo, ["report", execution.claimId, "--outcome",
      ["review", "final-review"].includes(execution.nodeId) ? "approve" : "complete"]);
  }
  assert.equal(JSON.parse(command(repo, ["status", runId])).state, "converged");
});

test("next and submit hide claim mechanics while advancing the Run", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "host-next-submit-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo), visited = [];
  for (let attempts = 0; attempts < 12; attempts += 1) {
    if (JSON.parse(command(repo, ["status", runId])).state === "converged") break;
    const raw = command(repo, ["next", runId]), task = JSON.parse(raw);
    visited.push(task.nodeId);
    assert.equal(task.schema, "burnlist-loop-host-task@1");
    assert.match(task.prompt, /Assigned item:/u);
    assert.equal(task.forecast.schema, "burnlist-loop-forecast@1");
    assert.equal(task.forecast.confidence, "low");
    assert.equal(task.forecast.provenance.kind, "built-in-prior");
    assert.equal(task.forecast.cost, null);
    assert.doesNotMatch(raw, /claimId|invocationId|assignmentId|dispatchAuthority|invocationInput/u);
    command(repo, ["submit", runId, "--outcome",
      task.mode === "review" ? "approve" : "complete"]);
  }
  assert.deepEqual(visited, ["implement", "review"]);
  assert.equal(JSON.parse(command(repo, ["status", runId])).state, "converged");
});

test("submit rejects missing tasks, illegal outcomes, and duplicate conflicts", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "host-submit-closed-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo);
  const missing = invoke(repo, ["submit", runId, "--outcome", "complete"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no active host task/u);
  command(repo, ["next", runId]);
  const illegal = invoke(repo, ["submit", runId, "--outcome", "approve"]);
  assert.equal(illegal.status, 1);
  assert.match(illegal.stderr, /not allowed/u);
  command(repo, ["submit", runId, "--outcome", "complete"]);
  const duplicate = invoke(repo, ["submit", runId, "--outcome", "complete"]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /no active host task/u);
});

test("a claimed provider cannot be stolen and reviewer candidate drift rejects its report", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "host-claim-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo), reportPath = join(directory, "report.json");
  for (const expected of ["implement"]) {
    const execution = JSON.parse(command(repo, ["claim", runId])).execution;
    assert.equal(execution.nodeId, expected);
    writeFileSync(reportPath, `${JSON.stringify(hostReport(execution, "complete"))}\n`);
    command(repo, ["report", execution.claimId, "--result", reportPath]);
  }
  const claimed = JSON.parse(command(repo, ["claim", runId])).execution;
  assert.equal(claimed.nodeId, "review");
  const theft = invoke(repo, ["claim", runId]);
  assert.equal(theft.status, 1);
  assert.match(theft.stderr, /already claimed/u);
  writeFileSync(join(repo, "src", "drift.txt"), "drift\n");
  writeFileSync(reportPath, `${JSON.stringify(hostReport(claimed, "approve"))}\n`);
  const rejected = invoke(repo, ["report", claimed.claimId, "--result", reportPath]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /candidate drifted/u);
});

test("abandon terminalizes an unfinished provider claim as needs-human", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "host-abandon-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo), claimed = JSON.parse(command(repo, ["claim", runId])).execution;
  const abandoned = JSON.parse(command(repo,
    ["abandon", claimed.claimId, "--reason", "host-cancelled"]));
  assert.equal(abandoned.state, "needs-human");
});
