import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindRunCreation } from "./binder.mjs";
import { loadBoundPolicy } from "./run-artifacts.mjs";
import { createProductionRunAuthority, fixtureItemRef, fixtureRunId } from "./run-test-fixtures.mjs";

test("reviewer authority is a fresh direct read profile with supervised write denial", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-direct-reviewer-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const bound = await bindRunCreation({ repoRoot: repo, input: { runId: fixtureRunId, itemRef: fixtureItemRef } });
  const reviewer = loadBoundPolicy(bound.policyBytes).policy.routes.find((route) => route.route === "review.strong");
  assert.equal(reviewer.profile.authority, "read");
  assert.deepEqual(reviewer.guarantees, { freshSession: "enforced", filesystemWriteDeny: "supervised" });
  assert.equal(Object.hasOwn(reviewer, "controller"), false);
  assert.equal(Object.hasOwn(reviewer, "probe"), false);
});
