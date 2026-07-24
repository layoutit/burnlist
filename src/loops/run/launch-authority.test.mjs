import assert from "node:assert/strict";
import { chmodSync, closeSync, fstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindRunCreation, captureRunLaunchBinding, holdRunLaunchBinding, launchAuthorityDigest, recheckRunLaunchBinding, releaseRunLaunchBinding } from "./binder.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { loadBoundPolicy } from "./run-artifacts.mjs";
import { createProductionRunAuthority, fixtureItemRef, fixtureRunId } from "./run-test-fixtures.mjs";

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-direct-launch-authority-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo, binary } = createProductionRunAuthority(join(directory, "repo"));
  const bound = await bindRunCreation({ repoRoot: repo, input: { runId: fixtureRunId, itemRef: fixtureItemRef } });
  return {
    repo, binary,
    replay: {
      projection: { itemRef: bound.itemRef, assignmentId: bound.assignmentId, itemRevision: bound.itemRevision },
      frozenRecipe: loadFrozenRecipe(bound.frozenRecipeBytes), boundPolicy: loadBoundPolicy(bound.policyBytes).policy, policyBytes: bound.policyBytes,
    },
  };
}

test("direct Stage One launch binding holds every live profile and trusted capability descriptor", async (t) => {
  const value = await fixture(t), captured = captureRunLaunchBinding({ repoRoot: value.repo, replay: value.replay });
  assert.deepEqual(captured.evidence.map((entry) => entry.role), [
    "adapter:implementation.standard", "adapter:review.strong", "capability-bin", "capability-catalog", "capability-trust",
    "profile:implementation.standard", "profile:review.strong", "route:implementation.standard", "route:review.strong",
  ]);
  recheckRunLaunchBinding(captured);
  const held = holdRunLaunchBinding(captured);
  assert.equal(held.length, captured.evidence.length, "each direct launch authority input is sealed");
  releaseRunLaunchBinding(held);
  for (const item of held) assert.throws(() => fstatSync(item.sealedDescriptor), { code: "EBADF" });
});

test("direct launch binding detects executable replacement before descriptor hold", async (t) => {
  const value = await fixture(t), captured = captureRunLaunchBinding({ repoRoot: value.repo, replay: value.replay });
  writeFileSync(value.binary, `${readFileSync(value.binary, "utf8")}\n// changed\n`);
  assert.throws(() => recheckRunLaunchBinding(captured), /changed/u);
  assert.throws(() => holdRunLaunchBinding(captured), /changed/u);
});

test("direct launch binding rejects a non-executable configured profile binary", async (t) => {
  const value = await fixture(t);
  chmodSync(value.binary, 0o600);
  assert.throws(() => captureRunLaunchBinding({ repoRoot: value.repo, replay: value.replay }), /not executable/u);
});

test("release closes every descriptor after an earlier close failure", async (t) => {
  const value = await fixture(t), captured = captureRunLaunchBinding({ repoRoot: value.repo, replay: value.replay }), held = holdRunLaunchBinding(captured);
  closeSync(held[0].sealedDescriptor);
  assert.throws(() => releaseRunLaunchBinding(held), { code: "EBADF" });
  for (const item of held.slice(1)) assert.throws(() => fstatSync(item.sealedDescriptor), { code: "EBADF" });
});

test("launch authority digest commits each direct authority field", () => {
  const evidence = [{ role: "adapter:implementation.standard", executable: true, snapshot: {
    root: "/", path: "/tool", kind: "file", ancestors: [{ path: "/", identity: { dev: 1, ino: 2, size: 3, mode: 4, mtimeMs: 5, ctimeMs: 6 } }],
    identity: { dev: 7, ino: 8, size: 9, mode: 10, mtimeMs: 11, ctimeMs: 12 }, digest: `sha256:${"a".repeat(64)}`, maximum: 13,
  } }];
  const baseline = launchAuthorityDigest(evidence);
  for (const mutate of [
    (value) => { value[0].role = "profile:implementation.standard"; }, (value) => { value[0].executable = false; },
    (value) => { value[0].snapshot.path = "/other/tool"; }, (value) => { value[0].snapshot.identity.ino = 99; },
    (value) => { value[0].snapshot.digest = `sha256:${"b".repeat(64)}`; },
  ]) { const changed = structuredClone(evidence); mutate(changed); assert.notEqual(launchAuthorityDigest(changed), baseline); }
});
