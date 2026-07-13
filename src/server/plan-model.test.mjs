import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { repoRootForPlan } from "./plan-model.mjs";

test("repoRootForPlan returns the repository root for a normal plan path", () => {
  const root = join("/tmp", "burnlist-repo");
  const planPath = join(root, "notes", "burnlists", "inprogress", "260713-001", "burnlist.md");
  assert.equal(repoRootForPlan(planPath), root);
});

test("repoRootForPlan uses the last notes/burnlists marker", () => {
  const root = join("/tmp", "notes", "burnlists", "work", "app");
  const planPath = join(root, "notes", "burnlists", "inprogress", "260713-001", "burnlist.md");
  assert.equal(repoRootForPlan(planPath), root);
});
