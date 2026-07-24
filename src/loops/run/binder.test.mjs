import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindRunCreation, createProductionRun, createProductionRunRunner, createStoredProductionRunRunner, revalidatePreparedBinding } from "./binder.mjs";
import { loadBoundPolicy } from "./run-artifacts.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { runStore } from "./run-store.mjs";
import { presentRun } from "./read-projection.mjs";
import { createProductionRunAuthority, fixtureItemRef, fixtureRunId } from "./run-test-fixtures.mjs";

test("production creation binds direct Stage One profiles without Docker artifacts", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-direct-binder-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const bound = await bindRunCreation({ repoRoot: repo, input: { runId: fixtureRunId, itemRef: fixtureItemRef } });
  const policy = loadBoundPolicy(bound.policyBytes).policy;
  assert.equal(bound.itemText, "- [ ] L29 | Exercise production authority\n\n");
  assert.deepEqual(policy.routes.map((route) => Object.keys(route)), [
    ["route", "profile", "profileRevision", "executableDigest", "guarantees"],
    ["route", "profile", "profileRevision", "executableDigest", "guarantees"],
  ]);
  assert.equal(policy.routes.some((route) => JSON.stringify(route).toLowerCase().includes("docker")), false);
  assert.deepEqual(policy.routes.find((route) => route.route === "review.strong").guarantees,
    { freshSession: "enforced", filesystemWriteDeny: "supervised" });
  assert.equal(revalidatePreparedBinding({ repoRoot: repo, bound }), true);
});

test("a publication-cut reservation recovers through either exact or ordinary create retry", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-current-cut-"))); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const cut = runStore(repo, { hooks: { beforeRunPublish() { throw new Error("before-run-publish"); } } });
  await assert.rejects(createProductionRun({ repoRoot: repo, store: cut, itemRef: fixtureItemRef, runId: fixtureRunId }), /before-run-publish/u);
  assert.equal(cut.list().length, 0); assert.equal(cut.readCurrentRun(fixtureItemRef).runId, fixtureRunId);
  const recovered = await createProductionRun({ repoRoot: repo, store: runStore(repo), itemRef: fixtureItemRef, runId: "run:01arz3ndektsv4rrffq69g5faw" });
  assert.equal(recovered.projection.runId, fixtureRunId); assert.equal(runStore(repo).list().length, 1);
});

test("production factory drives direct maker-check-reject-repair-approve", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-direct-runner-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const authority = await bindRunCreation({ repoRoot: repo, input: { runId: fixtureRunId, itemRef: fixtureItemRef } });
  const graph = loadFrozenRecipe(authority.frozenRecipeBytes).ir, store = runStore(repo);
  store.createRun({ runId: fixtureRunId, itemRef: fixtureItemRef, graph });
  const counter = join(directory, "counter"); writeFileSync(counter, "0");
  const oldCounter = process.env.BURNLIST_FAKE_COUNTER, oldOutcomes = process.env.BURNLIST_FAKE_OUTCOMES;
  process.env.BURNLIST_FAKE_COUNTER = counter; process.env.BURNLIST_FAKE_OUTCOMES = "complete,reject,complete,approve";
  t.after(() => {
    if (oldCounter === undefined) delete process.env.BURNLIST_FAKE_COUNTER; else process.env.BURNLIST_FAKE_COUNTER = oldCounter;
    if (oldOutcomes === undefined) delete process.env.BURNLIST_FAKE_OUTCOMES; else process.env.BURNLIST_FAKE_OUTCOMES = oldOutcomes;
  });
  const runner = createProductionRunRunner({ repoRoot: repo, store, runId: fixtureRunId, authority,
    runCheck: async ({ inputCandidate }) => ({ result: { outcome: "pass", inputCandidate,
      timedOut: false, truncated: false }, evidence: Buffer.from("pass") }),
    agentTimeoutMs: 2_000 });
  const completed = await runner.run();
  assert.equal(completed.projection.state, "converged", JSON.stringify(completed.execution));
  assert.equal(completed.execution.attempts.implement, 2);
});

test("executable reviewer escalation and malformed or stale finals fail closed", async (t) => {
  for (const [name, outcomes, mode, expected] of [
    ["escalate", "complete,escalate", "", "needs-human"],
    ["malformed", "complete", "malformed", "failed"],
    ["stale", "complete", "stale", "failed"],
  ]) {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), `burnlist-direct-${name}-`)));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const { repo } = createProductionRunAuthority(join(directory, "repo"));
    const authority = await bindRunCreation({ repoRoot: repo, input: { runId: fixtureRunId, itemRef: fixtureItemRef } });
    const store = runStore(repo); store.createRun({ runId: fixtureRunId, itemRef: fixtureItemRef,
      graph: loadFrozenRecipe(authority.frozenRecipeBytes).ir });
    const counter = join(directory, "counter"); writeFileSync(counter, "0");
    const previous = [process.env.BURNLIST_FAKE_COUNTER, process.env.BURNLIST_FAKE_OUTCOMES, process.env.BURNLIST_FAKE_FINAL_MODE];
    process.env.BURNLIST_FAKE_COUNTER = counter; process.env.BURNLIST_FAKE_OUTCOMES = outcomes;
    if (mode) process.env.BURNLIST_FAKE_FINAL_MODE = mode; else delete process.env.BURNLIST_FAKE_FINAL_MODE;
    try {
      const runner = createProductionRunRunner({ repoRoot: repo, store, runId: fixtureRunId, authority,
        runCheck: async ({ inputCandidate }) => ({ result: { outcome: "pass", inputCandidate,
          timedOut: false, truncated: false }, evidence: Buffer.from("pass") }), agentTimeoutMs: 2_000 });
      assert.equal((await runner.run()).projection.state, expected, name);
    } finally {
      for (const [key, value] of [["BURNLIST_FAKE_COUNTER", previous[0]], ["BURNLIST_FAKE_OUTCOMES", previous[1]],
        ["BURNLIST_FAKE_FINAL_MODE", previous[2]]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }
});

test("stored production repair binds a fresh repository candidate and gives each reviewer its matching check evidence", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-candidate-repair-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), store = runStore(repo);
  const created = await createProductionRun({ repoRoot: repo, store, itemRef: fixtureItemRef, runId: fixtureRunId });
  const publicRun = presentRun(store.read(fixtureRunId));
  assert.deepEqual(publicRun.graph.nodes.find((node) => node.id === "implement").execution,
    { profileId: "maker", model: "gpt-5.3-codex-spark", effort: "medium", authority: "write" });
  assert.deepEqual(publicRun.graph.nodes.find((node) => node.id === "review").execution,
    { profileId: "reviewer", model: "gpt-5.3-codex-spark", effort: "medium", authority: "read" });
  assert.doesNotMatch(JSON.stringify(publicRun), /\/bin\/sh|executableDigest|adapter/u);
  const outcomes = ["complete", "reject", "complete", "approve"], reviewerPrompts = []; let writes = 0;
  const startAgent = ({ prompt }) => {
    const values = Object.fromEntries(prompt.split("\n").filter((line) => line.includes("=")).map((line) => line.split(/=(.*)/su).slice(0, 2)));
    const outcome = outcomes.shift();
    if (values.node === "implement") writeFileSync(join(repo, "candidate-state.txt"), `maker-write-${++writes}\n`);
    if (values.node === "review") reviewerPrompts.push(prompt);
    const final = { schema: "burnlist.agent-final@1", runId: values.run, nodeId: values.node, attempt: Number(values.attempt),
      claimId: values.claim, invocationId: values.invocation, assignmentId: values.assignment, recipeRevision: values.recipe,
      policyRevision: values.policy, inputCandidate: values.candidate, outcome, summary: `fake ${outcome}` };
    return { cancel: () => true, completion: Promise.resolve({ outcome: "completed", events: [{ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(final) } }] }) };
  };
  const runner = createStoredProductionRunRunner({ repoRoot: repo, store, runId: created.projection.runId, startAgent,
    runCheck: async ({ inputCandidate }) => ({ result: { outcome: "pass", inputCandidate, timedOut: false, truncated: false }, evidence: Buffer.from("pass") }) });
  assert.equal((await runner.run()).projection.state, "converged");
  const candidates = store.read(fixtureRunId).journal.filter((record) => record.value.type === "candidate-bound").map((record) => record.value.payload.candidateId);
  assert.equal(candidates.length, 2); assert.notEqual(candidates[0], candidates[1]);
  assert.equal(reviewerPrompts.length, 2);
  for (const [index, prompt] of reviewerPrompts.entries()) {
    assert.match(prompt, new RegExp(`candidate=${candidates[index]}`, "u"));
    assert.match(prompt, new RegExp(`trusted-check candidate=${candidates[index]} summary=repository check pass`, "u"));
  }
});

test("stored production launch rejects changed profile authority before the agent can spawn", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-launch-drift-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo, binary } = createProductionRunAuthority(join(directory, "repo")), store = runStore(repo);
  const created = await createProductionRun({ repoRoot: repo, store, itemRef: fixtureItemRef, runId: fixtureRunId });
  writeFileSync(binary, `${writeFileSync.toString()}\n`);
  let spawned = false;
  const runner = createStoredProductionRunRunner({ repoRoot: repo, store, runId: created.projection.runId,
    startAgent() { spawned = true; throw new Error("must not spawn"); } });
  assert.equal((await runner.run()).projection.state, "failed");
  assert.equal(spawned, false);
});
test("production replay normalizes item-mismatched, malformed, or missing required authority to EAUTHORITY", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-authority-delete-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), store = runStore(repo);
  await createProductionRun({ repoRoot: repo, store, itemRef: fixtureItemRef, runId: fixtureRunId });
  assert.equal(store.read(fixtureRunId).journal[0].value.payload.authorityRequired, true);
  const path = store.paths.authorityPath(fixtureRunId), bytes = readFileSync(path);
  const mismatched = JSON.parse(bytes);
  mismatched.itemRef = "item:260722-001#OTHER";
  writeFileSync(path, `${JSON.stringify(mismatched)}\n`);
  assert.throws(() => runStore(repo).read(fixtureRunId), { code: "EAUTHORITY" });
  writeFileSync(path, "{\n");
  assert.throws(() => runStore(repo).read(fixtureRunId), { code: "EAUTHORITY" });
  writeFileSync(path, bytes, { mode: 0o600 });
  rmSync(path);
  assert.throws(() => runStore(repo).read(fixtureRunId), { code: "EAUTHORITY" });
});

test("an over-limit post-maker candidate replays as a closed failure without a lease", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-candidate-over-limit-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo")), store = runStore(repo);
  await createProductionRun({ repoRoot: repo, store, itemRef: fixtureItemRef, runId: fixtureRunId });
  const startAgent = ({ prompt }) => {
    const values = Object.fromEntries(prompt.split("\n").filter((line) => line.includes("=")).map((line) => line.split(/=(.*)/su).slice(0, 2)));
    writeFileSync(join(repo, "oversized-candidate.bin"), Buffer.alloc(16_777_217));
    const final = { schema: "burnlist.agent-final@1", runId: values.run, nodeId: values.node, attempt: Number(values.attempt),
      claimId: values.claim, invocationId: values.invocation, assignmentId: values.assignment, recipeRevision: values.recipe,
      policyRevision: values.policy, inputCandidate: values.candidate, outcome: "complete", summary: "maker complete" };
    return { cancel: () => true, completion: Promise.resolve({ outcome: "completed",
      events: [{ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(final) } }] }) };
  };
  const final = await createStoredProductionRunRunner({ repoRoot: repo, store, runId: fixtureRunId, startAgent }).run();
  assert.equal(final.projection.state, "failed");
  assert.equal(final.projection.leaseHeld, false);
  const replayed = runStore(repo).read(fixtureRunId);
  assert.equal(replayed.projection.state, "failed");
  assert.equal(replayed.projection.leaseHeld, false);
  assert.match(replayed.execution.system.summary, /too large/u);
});
