import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProductionRun, createStoredSystemRunRunner } from "./binder.mjs";
import { createProductionRunAuthority, fixtureItemRef, fixtureRunId } from "./run-test-fixtures.mjs";
import { runStore } from "./run-store.mjs";

test("system runner stops at host agents and never invokes a provider", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-system-runner-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const store = runStore(repo);
  await createProductionRun({ repoRoot: repo, store, itemRef: fixtureItemRef, runId: fixtureRunId });
  const runner = createStoredSystemRunRunner({ repoRoot: repo, store, runId: fixtureRunId,
    runCheck: async () => { throw new Error("check must not run before a host result"); } });
  const result = await runner.runToHostBoundary();
  assert.equal(result.execution.nodeId, "start");
  assert.equal(result.execution.started, false);
  assert.equal(result.execution.invocation, null);
});
