import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createProductionRunAuthority, fixtureItemRef } from "../loops/run/run-test-fixtures.mjs";

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
  assert.equal(status.currentNode, "start");
  assert.equal(command(repo, ["status", runId]), command(repo, ["status", runId]));
  for (const verb of ["run", "resume"]) {
    const result = invoke(repo, [verb, runId]);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, /codex|adapter|profile/u);
  }
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
  assert.deepEqual(visited,
    ["start", "decompose", "implement", "review", "integrate", "final-review"]);
  assert.equal(JSON.parse(command(repo, ["status", runId])).state, "converged");
  assert.equal(JSON.parse(command(repo, ["complete", runId])).alreadyApplied, false);
  assert.equal(JSON.parse(command(repo, ["complete", runId])).alreadyApplied, true);
});

test("a claimed provider cannot be stolen and reviewer candidate drift rejects its report", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "host-claim-loop-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = created(repo), reportPath = join(directory, "report.json");
  for (const expected of ["start", "decompose", "implement"]) {
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
