import assert from "node:assert/strict";
import { fstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindRunCreation, captureRunLaunchBinding, holdRunLaunchBinding,
  launchAuthorityDigest, recheckRunLaunchBinding, releaseRunLaunchBinding } from "./binder.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { loadBoundPolicy } from "./run-artifacts.mjs";
import { createProductionRunAuthority, fixtureItemRef, fixtureRunId } from "./run-test-fixtures.mjs";

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-system-launch-authority-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const bound = await bindRunCreation({
    repoRoot: repo, input: { runId: fixtureRunId, itemRef: fixtureItemRef },
  });
  return {
    repo,
    replay: {
      projection: { itemRef: bound.itemRef, assignmentId: bound.assignmentId,
        itemRevision: bound.itemRevision },
      frozenRecipe: loadFrozenRecipe(bound.frozenRecipeBytes),
      boundPolicy: loadBoundPolicy(bound.policyBytes).policy,
      policyBytes: bound.policyBytes,
    },
  };
}

test("launch binding contains only Burnlist-owned capability authority", async (t) => {
  const value = await fixture(t);
  const captured = captureRunLaunchBinding({ repoRoot: value.repo, replay: value.replay });
  assert.deepEqual(captured.evidence.map((entry) => entry.role),
    ["capability-bin", "capability-catalog", "capability-trust"]);
  assert.equal(captured.evidence.some((entry) =>
    /adapter|profile|route|provider/u.test(entry.role)), false);
  recheckRunLaunchBinding(captured);
  const held = holdRunLaunchBinding(captured);
  releaseRunLaunchBinding(held);
  for (const item of held)
    assert.throws(() => fstatSync(item.sealedDescriptor), { code: "EBADF" });
});

test("launch authority digest commits each system authority field", () => {
  const evidence = [{ role: "capability-bin", executable: true, snapshot: {
    root: "/", path: "/tool", kind: "file",
    ancestors: [{ path: "/", identity: {
      dev: 1, ino: 2, size: 3, mode: 4, mtimeMs: 5, ctimeMs: 6,
    } }],
    identity: { dev: 7, ino: 8, size: 9, mode: 10, mtimeMs: 11, ctimeMs: 12 },
    digest: `sha256:${"a".repeat(64)}`, maximum: 13,
  } }];
  const baseline = launchAuthorityDigest(evidence);
  for (const mutate of [
    (value) => { value[0].role = "capability-catalog"; },
    (value) => { value[0].executable = false; },
    (value) => { value[0].snapshot.path = "/other/tool"; },
    (value) => { value[0].snapshot.identity.ino = 99; },
    (value) => { value[0].snapshot.digest = `sha256:${"b".repeat(64)}`; },
  ]) {
    const changed = structuredClone(evidence);
    mutate(changed);
    assert.notEqual(launchAuthorityDigest(changed), baseline);
  }
});
