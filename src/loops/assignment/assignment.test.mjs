import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { burnItem } from "../../cli/lifecycle-moves.mjs";
import { assignLoopItem, assertDirectBurnAllowed, prepareItemMutation, resolveBuiltin, unassignLoopItem } from "./assignment.mjs";
import { repositoryHazardAuthority } from "./hazards.mjs";
import { resolveLoopAuthority, selectNonterminalRun } from "./resolver.mjs";
import { assignmentDigest, buildAssignment, itemDigest, locateItemSpan, validateAssignedItem } from "./item-metadata.mjs";
import { parseItemRef, parseLoopRef, parseRunRef, selectorKind } from "./selectors.mjs";
import { assignmentStore } from "./store.mjs";
import { runStore } from "../run/run-store.mjs";
import { testGraph } from "../run/m2-test-fixtures.mjs";

const project = resolve(new URL("../../..", import.meta.url).pathname);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-assignment-"));
  const repo = join(root, "repo"), dir = join(repo, "notes", "burnlists", "inprogress", "260710-001");
  mkdirSync(dir, { recursive: true });
  const plan = join(dir, "burnlist.md");
  writeFileSync(plan, "# Test\n\n## Active Checklist\n- [ ] BUG-07 | Fix exact bytes\n  Action: keep this line\n\n## Completed\n");
  return { repo, plan, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function ref() { return "item:260710-001#BUG-07"; }

test("selectors are closed, disjoint, and reject noncanonical ULID overflow", () => {
  assert.deepEqual(parseLoopRef("loop:builtin:review@er1-sha256:" + "a".repeat(64)), { selector: "loop:builtin:review", name: "review", executable: "er1-sha256:" + "a".repeat(64) });
  assert.equal(parseItemRef(ref()).itemId, "BUG-07");
  assert.equal(parseRunRef("run:01arz3ndektsv4rrffq69g5fav").id.length, 26);
  for (const value of ["review", "item:260710-001#BUG-07", "run:81arz3ndektsv4rrffq69g5fav", "run:01ARZ3NDEKTSV4RRFFQ69G5FAV"]) assert.throws(() => parseRunRef(value), TypeError);
  assert.equal(selectorKind("loop:builtin:review"), "loop"); assert.equal(selectorKind(ref()), "item");
});

test("assignment writes canonical bytes, stores artifact before one replacement, and unassign restores exact bytes", async () => {
  const context = fixture();
  try {
    const before = readFileSync(context.plan); const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const assigned = readFileSync(context.plan);
    assert.match(assigned.toString(), new RegExp(`  Loop:\\n    Assignment-Id: ${result.assignmentId}\\n    Selector: loop:builtin:review\\n    Execution-Revision: ${result.executionRevision}\\n    Package-Revision: ${result.packageRevision}\\n`, "u"));
    const assignedSpan = locateItemSpan(assigned, "BUG-07"); const checked = validateAssignedItem(ref(), assignedSpan);
    assert.equal(checked.assignedDigest, result.assignedItemDigest);
    const artifactPath = join(context.repo, ".local", "burnlist", "loop", "v2", "assignments", result.assignmentId.slice(11));
    assert.equal(lstatSync(artifactPath).mode & 0o777, 0o700);
    assert.equal(readFileSync(join(artifactPath, "recipe.frozen")).includes("burnlist-loop-frozen@1"), true);
    assert.throws(() => burnItem(context.repo, "260710-001", "BUG-07"), /Loop metadata/u);
    unassignLoopItem({ repoRoot: context.repo, itemRef: ref() });
    assert.deepEqual(readFileSync(context.plan), before);
    assert.doesNotThrow(() => assertDirectBurnAllowed({ repoRoot: context.repo, itemRef: ref(), markdown: before }));
  } finally { context.cleanup(); }
});

test("assignment pin is verified and duplicate, malformed, stale, and edited metadata fail closed", async () => {
  const context = fixture();
  try {
    await assert.rejects(assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: `loop:builtin:review@er1-sha256:${"0".repeat(64)}` }), /pin does not match/u);
    const first = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    await assert.rejects(assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" }), /metadata/u);
    writeFileSync(context.plan, readFileSync(context.plan, "utf8").replace("Fix exact bytes", "Edited bytes"));
    assert.throws(() => unassignLoopItem({ repoRoot: context.repo, itemRef: ref() }), /stale or handwritten assignment id/u);
    assert.throws(() => assertDirectBurnAllowed({ repoRoot: context.repo, itemRef: ref(), markdown: readFileSync(context.plan) }), /Loop metadata/u);
    assert.match(first.assignmentId, /^as1-sha256:/u);
  } finally { context.cleanup(); }
});

test("assignment and unassign CAS plus hazard authority reject competing or active state", async () => {
  const context = fixture();
  try {
    const prepared = prepareItemMutation({ repoRoot: context.repo, itemRef: ref() });
    writeFileSync(context.plan, `${readFileSync(context.plan, "utf8")}<!-- unrelated edit -->\n`);
    await assert.rejects(assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review", prepared }), /whole-file CAS/u);
    const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    assert.throws(() => unassignLoopItem({ repoRoot: context.repo, itemRef: ref(), hazardAuthority: () => ["nonterminal run", "retained lease"] }), /nonterminal run, retained lease/u);
    assert.throws(() => assertDirectBurnAllowed({ repoRoot: context.repo, itemRef: ref(), markdown: readFileSync(context.plan), hazardAuthority: () => ["quarantine"] }), /Loop metadata/u);
    assert.match(result.unassignedItemDigest, /^id1-sha256:/u);
  } finally { context.cleanup(); }
});

test("legacy burn remains unchanged when unassigned but accepts an injectable Run hazard authority", () => {
  const context = fixture();
  try {
    assert.throws(() => burnItem(context.repo, "260710-001", "BUG-07", false, { hazardAuthority: () => ["unreconciled checkout"] }), /unreconciled checkout/u);
    assert.equal(burnItem(context.repo, "260710-001", "BUG-07"), true);
  } finally { context.cleanup(); }
});

test("framed assignment identities use the exact unassigned and assigned item bytes", () => {
  const bytes = Buffer.from("- [ ] BUG-07 | T\n\n"); const located = locateItemSpan(bytes, "BUG-07");
  const built = buildAssignment(ref(), located, { selector: "loop:builtin:review", executable: `er1-sha256:${"1".repeat(64)}`, packageRevision: `lp1-sha256:${"2".repeat(64)}` });
  assert.equal(built.unassignedDigest, itemDigest(ref(), bytes));
  assert.equal(built.assignmentId, assignmentDigest(ref(), built.unassignedDigest, "loop:builtin:review", `er1-sha256:${"1".repeat(64)}`));
  assert.equal(built.assignedDigest, itemDigest(ref(), built.assignedSpan));
});

test("locked CLI accepts only prefixed state-changing selectors", () => {
  const context = fixture();
  try {
    const bin = join(project, "bin", "burnlist.mjs");
    const run = (...args) => execFileSync(process.execPath, [bin, ...args], { cwd: context.repo, encoding: "utf8" });
    assert.match(run("loop", "assign", ref(), "loop:builtin:review"), /^as1-sha256:/u);
    assert.throws(() => run("loop", "assign", "260710-001#BUG-07", "review"), /Invalid ItemRef/u);
    assert.match(run("loop", "unassign", ref()), /^as1-sha256:/u);
  } finally { context.cleanup(); }
});

test("repository hazard authority reads production Runs and permits only safe terminal histories", async () => {
  const context = fixture();
  try {
    const authority = repositoryHazardAuthority(context.repo);
    const bin = join(project, "bin", "burnlist.mjs");
    assert.deepEqual(authority({ itemRef: ref() }), []);
    const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const store = runStore(context.repo), first = "run:01arz3ndektsv4rrffq69g5fav";
    store.createRun({ runId: first, itemRef: ref(), graph: testGraph });
    assert.deepEqual(authority({ itemRef: ref() }), [`nonterminal Run ${first}`]);
    assert.throws(() => unassignLoopItem({ repoRoot: context.repo, itemRef: ref() }), /nonterminal Run/u);
    const lease = store.acquireLease(first).lease;
    assert.deepEqual(authority({ itemRef: ref() }), ["nonterminal Run run:01arz3ndektsv4rrffq69g5fav"]);
    store.terminalize(first, lease, "cancelled", "test");
    assert.deepEqual(authority({ itemRef: ref() }), []);
    assert.match(unassignLoopItem({ repoRoot: context.repo, itemRef: ref() }).assignmentId, /^as1/u);
    assert.match(execFileSync(process.execPath, [bin, "burn", "260710-001", "BUG-07"], { cwd: context.repo, encoding: "utf8" }), /^$/u);
    assert.match(result.assignmentId, /^as1/u);
    const converged = fixture();
    try {
      await assignLoopItem({ repoRoot: converged.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
      const convergedStore = runStore(converged.repo), runId = "run:01arz3ndektsv4rrffq69g5faw";
      convergedStore.createRun({ runId, itemRef: ref(), graph: testGraph });
      convergedStore.terminalize(runId, convergedStore.acquireLease(runId).lease, "converged", "test");
      assert.deepEqual(repositoryHazardAuthority(converged.repo)({ itemRef: ref() }), [`completion-pending Run ${runId}`]);
      assert.throws(() => unassignLoopItem({ repoRoot: converged.repo, itemRef: ref() }), /completion-pending Run/u);
    } finally { converged.cleanup(); }
  } finally { context.cleanup(); }
});

test("artifact is immutable, contained, and resolver selects only its declared authority", async () => {
  const context = fixture();
  try {
    const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const artifact = join(context.repo, ".local", "burnlist", "loop", "v2", "assignments", result.assignmentId.slice(11));
    assert.equal(lstatSync(join(artifact, "manifest.json")).mode & 0o777, 0o600);
    const item = await resolveLoopAuthority({ repoRoot: context.repo, selector: ref() });
    assert.equal(item.authority, "ITEM-PINNED"); assert.equal(item.executableDrift, false);
    assert.equal((await resolveLoopAuthority({ repoRoot: context.repo, selector: "review" })).authority, "UNPINNED");
    await assert.rejects(resolveLoopAuthority({ repoRoot: context.repo, selector: "run:01arz3ndektsv4rrffq69g5fav" }), /E_RUN_UNAVAILABLE/u);
    rmSync(join(artifact, "recipe.frozen")); symlinkSync("/etc/hosts", join(artifact, "recipe.frozen"));
    await assert.rejects(resolveLoopAuthority({ repoRoot: context.repo, selector: ref() }), /ELOOP_PIN_BYTES_UNAVAILABLE/u);
  } finally { context.cleanup(); }
});

test("assignment artifact authority rejects persistent ancestor and leaf symlinks", async () => {
  const context = fixture();
  try {
    const outside = join(dirname(context.repo), "outside"), loop = join(context.repo, ".local", "burnlist", "loop");
    mkdirSync(join(context.repo, ".local", "burnlist"), { recursive: true }); mkdirSync(outside);
    symlinkSync(outside, loop);
    await assert.rejects(assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" }), /unsafe directory loop/u);
    assert.deepEqual(readdirSync(outside), []);
    rmSync(loop); const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const assignments = join(context.repo, ".local", "burnlist", "loop", "v2", "assignments");
    const artifact = join(assignments, result.assignmentId.slice(11)), saved = `${artifact}.saved`;
    renameSync(artifact, saved); symlinkSync(saved, artifact);
    await assert.rejects(resolveLoopAuthority({ repoRoot: context.repo, selector: ref() }), /ELOOP_PIN_BYTES_UNAVAILABLE/u);
    rmSync(artifact); renameSync(saved, artifact);
    const outsideAssignments = join(outside, "assignments"); cpSync(assignments, outsideAssignments, { recursive: true });
    renameSync(assignments, `${assignments}.saved`); symlinkSync(outsideAssignments, assignments);
    await assert.rejects(resolveLoopAuthority({ repoRoot: context.repo, selector: ref() }), /ELOOP_PIN_BYTES_UNAVAILABLE/u);
  } finally { context.cleanup(); }
});

test("load and inspect anchor reads before deterministic leaf replacement cuts", async () => {
  const context = fixture();
  try {
    const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const plain = assignmentStore(context.repo).load(result.assignmentId);
    for (const method of ["load", "inspect"]) {
      let fired = false;
      const store = assignmentStore(context.repo, { onCut(cut, detail) {
        if (cut !== "read" || fired) return;
        fired = true; const moved = `${detail.target}.moved`;
        renameSync(detail.target, moved); mkdirSync(detail.target, { mode: 0o700 });
      } });
      assert.throws(() => store[method](result.assignmentId), /required artifact bytes are missing|unsafe directory/u);
      const artifact = store.pathFor(result.assignmentId);
      rmSync(artifact, { recursive: true }); renameSync(`${artifact}.moved`, artifact);
    }
    assert.equal(plain.assignmentId, result.assignmentId);
  } finally { context.cleanup(); }
});

test("actual save collision and publication cuts cannot escape the anchored assignment root", async () => {
  const context = fixture();
  try {
    const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const originalStore = assignmentStore(context.repo), original = originalStore.load(result.assignmentId);
    const compiled = await resolveBuiltin(parseLoopRef("loop:builtin:review"));
    const outside = join(dirname(context.repo), "cut-outside"), canary = join(outside, "canary");
    mkdirSync(outside); writeFileSync(canary, "untouched", { mode: 0o600 });
    let fired = false;
    const collision = assignmentStore(context.repo, { onCut(cut, detail) {
      if (cut !== "collision" || fired) return;
      fired = true; const moved = `${detail.target}.moved`; renameSync(detail.target, moved); symlinkSync(outside, detail.target);
    } });
    assert.throws(() => collision.save(original, compiled), /unsafe directory/u);
    const artifact = collision.pathFor(result.assignmentId);
    rmSync(artifact); renameSync(`${artifact}.moved`, artifact);
    const collisionChild = assignmentStore(context.repo, { workerCut: "move-collision-between-files", workerOutside: outside });
    assert.throws(() => collisionChild.save(original, compiled), /ancestor authority/u);
    const movedCollision = join(outside, `${result.assignmentId.slice(11)}.moved`);
    renameSync(movedCollision, artifact);
    fired = false;
    const next = { ...original, assignmentId: `as1-sha256:${"a".repeat(64)}` };
    const publication = assignmentStore(context.repo, { onCut(cut, detail) {
      if (cut !== "publication" || fired) return;
      fired = true; const moved = `${detail.root}.moved`; renameSync(detail.root, moved); symlinkSync(outside, detail.root);
    } });
    assert.throws(() => publication.save(next, compiled), /unsafe directory/u);
    assert.equal(readFileSync(canary, "utf8"), "untouched");
    const assignments = join(context.repo, ".local", "burnlist", "loop", "v2", "assignments");
    rmSync(assignments); renameSync(`${assignments}.moved`, assignments);
    fired = false;
    const abaRecord = { ...original, assignmentId: `as1-sha256:${"b".repeat(64)}` };
    const aba = assignmentStore(context.repo, { onCut(cut, detail) {
      if (cut !== "publication" || fired) return;
      fired = true; const moved = `${detail.root}.aba`;
      renameSync(detail.root, moved); symlinkSync(outside, detail.root); rmSync(detail.root); renameSync(moved, detail.root);
    } });
    assert.equal(aba.save(abaRecord, compiled), aba.pathFor(abaRecord.assignmentId));
    assert.equal(readFileSync(canary, "utf8"), "untouched");
    const tempRecord = { ...original, assignmentId: `as1-sha256:${"c".repeat(64)}` };
    const tempSwap = assignmentStore(context.repo, { workerCut: "move-temp-before-recipe", workerOutside: outside });
    assert.throws(() => tempSwap.save(tempRecord, compiled), /temporary directory escaped|ancestor authority mutation/u);
    assert.equal(readFileSync(canary, "utf8"), "untouched");
    for (const [index, workerCut] of ["aba-before-rename", "aba-after-rename"].entries()) {
      const cutRecord = { ...original, assignmentId: `as1-sha256:${String(index + 4).repeat(64)}` };
      const childCut = assignmentStore(context.repo, { workerCut, workerOutside: outside });
      assert.throws(() => childCut.save(cutRecord, compiled), /ancestor authority mutation|unexpected entry/u);
      assert.equal(readFileSync(canary, "utf8"), "untouched");
    }
    for (const entry of readdirSync(assignments)) if (entry.startsWith(".")) rmSync(join(assignments, entry), { recursive: true });
    const noClobberRecord = { ...original, assignmentId: `as1-sha256:${"6".repeat(64)}` };
    const noClobber = assignmentStore(context.repo, { workerCut: "create-empty-target", workerOutside: outside });
    assert.throws(() => noClobber.save(noClobberRecord, compiled), /ancestor authority mutation|bounded private regular file|required artifact bytes/u);
    const reservedTarget = noClobber.pathFor(noClobberRecord.assignmentId);
    assert.equal(lstatSync(reservedTarget).isDirectory(), true);
    assert.deepEqual(readdirSync(reservedTarget), []);
  } finally { context.cleanup(); }
});

test("assignment reads reject non-private directories and files", async () => {
  const context = fixture();
  try {
    const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const store = assignmentStore(context.repo), artifact = store.pathFor(result.assignmentId);
    chmodSync(artifact, 0o755); assert.throws(() => store.load(result.assignmentId), /unsafe directory/u);
    chmodSync(artifact, 0o700); chmodSync(join(artifact, "manifest.json"), 0o644);
    assert.throws(() => store.inspect(result.assignmentId), /bounded private regular file/u);
    chmodSync(join(artifact, "manifest.json"), 0o600);
    assert.throws(() => assignmentStore(context.repo, { workerCut: "grow:recipe.frozen" }).load(result.assignmentId), /changed while reading/u);
  } finally { context.cleanup(); }
});

test("restrictive umask cannot poison published assignment modes", async () => {
  const context = fixture(), previous = process.umask(0o777);
  try {
    const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const artifact = assignmentStore(context.repo).pathFor(result.assignmentId);
    assert.equal(lstatSync(artifact).mode & 0o777, 0o700);
    assert.equal(lstatSync(join(artifact, "manifest.json")).mode & 0o777, 0o600);
    assert.equal(lstatSync(join(artifact, "recipe.frozen")).mode & 0o777, 0o600);
  } finally { process.umask(previous); context.cleanup(); }
});

test("child-side cut between manifest and recipe cannot continue after leaf escape", async () => {
  const context = fixture();
  try {
    const result = await assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review" });
    const outside = join(dirname(context.repo), "read-cut"), canary = join(outside, "canary");
    mkdirSync(outside); writeFileSync(canary, "untouched", { mode: 0o600 });
    const store = assignmentStore(context.repo, { workerCut: "move-leaf-between-files", workerOutside: outside });
    assert.throws(() => store.load(result.assignmentId), /ancestor authority/u);
    assert.equal(readFileSync(canary, "utf8"), "untouched");
  } finally { context.cleanup(); }
});

test("duplicate active ids, item-CAS edits, and Run ambiguity reject without fallback", async () => {
  const context = fixture();
  try {
    writeFileSync(context.plan, readFileSync(context.plan, "utf8").replace("\n\n## Completed", "\n- [ ] BUG-07 | Duplicate\n\n## Completed"));
    assert.throws(() => prepareItemMutation({ repoRoot: context.repo, itemRef: ref() }), /duplicated/u);
    writeFileSync(context.plan, "# T\n\n## Active Checklist\n- [ ] BUG-07 | One\n\n## Completed\n");
    const prepared = prepareItemMutation({ repoRoot: context.repo, itemRef: ref() });
    writeFileSync(context.plan, readFileSync(context.plan, "utf8").replace("One", "Two"));
    await assert.rejects(assignLoopItem({ repoRoot: context.repo, itemRef: ref(), loopRef: "loop:builtin:review", prepared }), /item CAS/u);
    assert.throws(() => selectNonterminalRun(ref(), []), /E_RUN_AMBIGUOUS/u);
    assert.throws(() => selectNonterminalRun(ref(), [{ itemRef: ref(), runId: "run:01arz3ndektsv4rrffq69g5fav", state: "running" }, { itemRef: ref(), runId: "run:01arz3ndektsv4rrffq69g5fav", state: "paused" }]), /E_RUN_AMBIGUOUS/u);
  } finally { context.cleanup(); }
});
