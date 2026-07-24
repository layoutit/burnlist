import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { burnItem, closeLifecycle } from "../../cli/lifecycle-moves.mjs";
import { prepareItemMutation, unassignLoopItem } from "../assignment/assignment.mjs";
import { createProductionRun, createStoredProductionRunRunner } from "../run/binder.mjs";
import { createProductionRunAuthority, fixtureItemRef, fixtureRunId } from "../run/run-test-fixtures.mjs";
import { runStore } from "../run/run-store.mjs";
import { completeLoopRun } from "./completion.mjs";

function context(t) {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-completion-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  return { directory, repo, planPath: join(repo, "notes", "burnlists", "inprogress", "260722-001", "burnlist.md") };
}
function unassignedContext(t) {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-completion-control-")), repo = join(directory, "repo"), planPath = join(repo, "notes", "burnlists", "inprogress", "260722-001", "burnlist.md");
  mkdirSync(join(repo, "notes", "burnlists", "inprogress", "260722-001"), { recursive: true });
  writeFileSync(planPath, "# Runner\n\n## Active Checklist\n- [ ] L29 | Exercise production authority\n\n## Completed\n");
  t.after(() => rmSync(directory, { recursive: true, force: true })); return { repo, planPath };
}
async function converged(context, runId = fixtureRunId) {
  const store = runStore(context.repo);
  await createProductionRun({ repoRoot: context.repo, store, itemRef: fixtureItemRef, runId });
  const counter = join(context.directory, `counter-${runId.slice(-4)}`); writeFileSync(counter, "0");
  const before = [process.env.BURNLIST_FAKE_COUNTER, process.env.BURNLIST_FAKE_OUTCOMES];
  process.env.BURNLIST_FAKE_COUNTER = counter; process.env.BURNLIST_FAKE_OUTCOMES = "complete,approve";
  try { assert.equal((await createStoredProductionRunRunner({ repoRoot: context.repo, store, runId }).run()).projection.state, "converged"); }
  finally {
    for (const [key, value] of [["BURNLIST_FAKE_COUNTER", before[0]], ["BURNLIST_FAKE_OUTCOMES", before[1]]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  return store;
}
function runPath(store, runId, name) { return join(store.paths.pathFor(runId), name); }
function completedLines(context) { return readFileSync(context.planPath, "utf8").match(/^- L29 \| .+$/gmu) ?? []; }

test("completion burns one exact converged assignment, writes one receipt, and retries idempotently", async (t) => {
  const value = context(t), store = await converged(value);
  const first = completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store });
  assert.equal(first.alreadyApplied, false);
  assert.equal(readFileSync(value.planPath, "utf8").includes("- [ ] L29"), false);
  assert.equal(completedLines(value).length, 1);
  assert.equal(existsSync(runPath(store, fixtureRunId, "completion-receipt.json")), true);
  writeFileSync(value.planPath, `${readFileSync(value.planPath, "utf8").trimEnd()}\n\nUnrelated lifecycle note.\n`);
  const second = completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store });
  assert.equal(second.alreadyApplied, true); assert.equal(completedLines(value).length, 1);
});

test("completion resumes every durable interruption cut without a duplicate ledger entry", async (t) => {
  for (const cut of ["afterIntent", "afterPlan", "afterReceipt"]) {
    const value = context(t), store = await converged(value);
    assert.throws(() => completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store, hooks: { [cut]() { throw new Error(`cut:${cut}`); } } }), new RegExp(`cut:${cut}`, "u"));
    const markdown = readFileSync(value.planPath, "utf8");
    if (cut === "afterIntent") assert.match(markdown, /- \[ \] L29/u); else assert.equal(completedLines(value).length, 1, cut);
    const resumed = completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store: runStore(value.repo) });
    assert.equal(resumed.alreadyApplied, cut !== "afterIntent"); assert.equal(completedLines(value).length, 1, cut);
    assert.equal(existsSync(runPath(store, fixtureRunId, "completion-intent.json")), false, cut);
  }
});

test("a pending after-plan Loop intent blocks lifecycle close until its CLI retry seals the receipt", async (t) => {
  const value = context(t), store = await converged(value);
  assert.throws(() => completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store, hooks: { afterPlan() { throw new Error("cut:afterPlan"); } } }), /cut:afterPlan/u);
  assert.throws(() => closeLifecycle(value.repo, "260722-001"), /pending Loop completion/u);
  assert.equal(completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store: runStore(value.repo) }).alreadyApplied, true);
  assert.doesNotThrow(() => closeLifecycle(value.repo, "260722-001"));
});

test("completion rejects a prepared Run and a stale assigned item", async (t) => {
  const pending = context(t), pendingStore = runStore(pending.repo);
  await createProductionRun({ repoRoot: pending.repo, store: pendingStore, itemRef: fixtureItemRef, runId: fixtureRunId });
  assert.throws(() => completeLoopRun({ repoRoot: pending.repo, runId: fixtureRunId, store: pendingStore }), /not converged/u);

  const stale = context(t), staleStore = await converged(stale);
  writeFileSync(stale.planPath, readFileSync(stale.planPath, "utf8").replace("Exercise production authority", "Changed after Run creation"));
  assert.throws(() => completeLoopRun({ repoRoot: stale.repo, runId: fixtureRunId, store: staleStore }), /assigned item no longer matches/u);
  assert.match(readFileSync(stale.planPath, "utf8"), /- \[ \] L29/u);

  const superseded = context(t), firstStore = runStore(superseded.repo);
  await createProductionRun({ repoRoot: superseded.repo, store: firstStore, itemRef: fixtureItemRef, runId: fixtureRunId });
  firstStore.terminalize(fixtureRunId, firstStore.acquireLease(fixtureRunId).lease, "cancelled", "test");
  const currentId = "run:01arz3ndektsv4rrffq69g5faw", currentStore = await converged(superseded, currentId);
  assert.throws(() => completeLoopRun({ repoRoot: superseded.repo, runId: fixtureRunId, store: firstStore }), /not converged/u);
  assert.equal(completeLoopRun({ repoRoot: superseded.repo, runId: currentId, store: currentStore }).alreadyApplied, false);
});

test("receipt and Run ambiguity evidence fail closed when corrupt, bounded, symlinked, or duplicate", async (t) => {
  const value = context(t), store = await converged(value), receipt = runPath(store, fixtureRunId, "completion-receipt.json");
  symlinkSync(value.planPath, receipt); assert.throws(() => completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store }), /receipt is corrupt/u); rmSync(receipt);
  writeFileSync(receipt, "x".repeat(9000)); assert.throws(() => completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store }), /receipt is corrupt/u); rmSync(receipt);
  writeFileSync(receipt, "{}\n"); assert.throws(() => completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store }), /receipt is invalid/u); rmSync(receipt);
  completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store });
  const record = JSON.parse(readFileSync(receipt, "utf8"));
  writeFileSync(value.planPath, `${readFileSync(value.planPath, "utf8").trimEnd()}\n${`- L29 | ${record.completedAt} | ${record.title}`}\n`);
  assert.throws(() => completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store }), /Duplicate completed id/u);
});

test("completion rejects a symlinked lifecycle directory without touching its outside target", async (t) => {
  const value = context(t), store = await converged(value), lifecycle = join(value.repo, "notes", "burnlists", "inprogress", "260722-001"), outside = join(value.directory, "outside");
  mkdirSync(outside); const outsidePlan = join(outside, "burnlist.md"), original = "# Outside\n\n## Active Checklist\n- [ ] L29 | Outside item\n\n## Completed\n";
  writeFileSync(outsidePlan, original); renameSync(lifecycle, `${lifecycle}.saved`); symlinkSync(outside, lifecycle, "dir");
  assert.throws(() => completeLoopRun({ repoRoot: value.repo, runId: fixtureRunId, store }), /lifecycle path is not a real directory/u);
  assert.equal(readFileSync(outsidePlan, "utf8"), original);
});

test("direct burn cannot bypass Loop metadata, while a safe unassign restores direct bytes", async (t) => {
  const value = context(t);
  assert.throws(() => burnItem(value.repo, "260722-001", "L29"), /direct burn is blocked by Loop metadata/u);
  const prepared = prepareItemMutation({ repoRoot: value.repo, itemRef: fixtureItemRef });
  const result = unassignLoopItem({ repoRoot: value.repo, itemRef: fixtureItemRef, prepared });
  assert.match(result.assignmentId, /^as1-sha256:/u);
  assert.equal(burnItem(value.repo, "260722-001", "L29"), true);
});

test("a direct burn is byte-compatible after safe unassign against a never-assigned control", (t) => {
  const control = unassignedContext(t), value = context(t), expected = "# Runner\n\n## Active Checklist\n- [ ] L29 | Exercise production authority\n\n## Completed\n", completedAt = "2026-07-24T12:00:00+00:00";
  assert.deepEqual(readFileSync(control.planPath, "utf8"), expected);
  const prepared = prepareItemMutation({ repoRoot: value.repo, itemRef: fixtureItemRef });
  unassignLoopItem({ repoRoot: value.repo, itemRef: fixtureItemRef, prepared });
  assert.equal(burnItem(control.repo, "260722-001", "L29", false, { completedAt }), true);
  assert.equal(burnItem(value.repo, "260722-001", "L29", false, { completedAt }), true);
  assert.deepEqual(readFileSync(value.planPath, "utf8"), readFileSync(control.planPath, "utf8"));
});
