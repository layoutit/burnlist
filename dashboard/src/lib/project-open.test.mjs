import assert from "node:assert/strict";
import test from "node:test";
import { projectGroupOpen, projectGroupShouldResetOpen } from "./project-open.mjs";

test("project groups reset their derived open state only for lifecycle filter changes", () => {
  const active = [{ id: "active" }];
  const completed = [{ id: "completed" }];
  assert.equal(projectGroupOpen(active, 1), true);
  assert.equal(projectGroupOpen([], 1), false);
  assert.equal(projectGroupOpen([], 0), true);
  assert.equal(projectGroupShouldResetOpen("active", "active"), false);
  assert.equal(projectGroupShouldResetOpen("active", "complete"), true);
  assert.equal(projectGroupOpen(completed, 1), true);
});
