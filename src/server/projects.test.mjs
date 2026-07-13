import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectsSnapshot } from "./projects.mjs";

const keys = new Map([
  ["/repos/alpha", "aaaaaaaaaaaa"],
  ["/repos/beta", "bbbbbbbbbbbb"],
]);

function snapshot({ observerRoots = [], registeredRoots = [], health = new Map(), entries = [] } = {}) {
  return buildProjectsSnapshot({
    observerRoots,
    registeredRoots,
    health,
    entries,
    repoKey: (root) => keys.get(root) ?? "unknown00000",
    realpath: (root) => {
      if (root === "/missing") throw new Error("missing");
      return root;
    },
  });
}

function entry(id, repoRoot, status = "active", updatedAt = "2026-01-01T00:00:00.000Z") {
  return { id, repoRoot, status, updatedAt, repo: "repo", planLabel: `${id}/burnlist.md` };
}

test("groups entries and preserves a registered empty project", () => {
  const result = snapshot({
    observerRoots: ["/repos/alpha"],
    registeredRoots: [{ root: "/repos/beta", repoKey: "bbbbbbbbbbbb" }],
    health: new Map([["/repos/alpha", "healthy"], ["/repos/beta", "empty"]]),
    entries: [entry("alpha-01", "/repos/alpha")],
  });
  assert.equal(result.projects.length, 2);
  assert.deepEqual(result.projects[0].counts, { total: 1, active: 1 });
  assert.equal(result.projects[1].registered, true);
  assert.equal(result.projects[1].health, "empty");
  assert.deepEqual(result.projects[1].entries, []);
});

test("keeps orphan entries in a trailing Ungrouped project", () => {
  const result = snapshot({
    observerRoots: ["/repos/alpha"],
    entries: [entry("alpha-01", "/repos/alpha"), entry("orphan-01", null)],
  });
  const ungrouped = result.projects.at(-1);
  assert.equal(ungrouped.displayName, "Ungrouped");
  assert.equal(ungrouped.canonicalRoot, null);
  assert.deepEqual(ungrouped.counts, { total: 1, active: 1 });
  assert.equal(ungrouped.entries[0].id, "orphan-01");
});

test("reports duplicate ids and sorts active projects before inactive projects", () => {
  const result = snapshot({
    observerRoots: ["/repos/beta", "/repos/alpha"],
    entries: [
      entry("duplicate", "/repos/alpha"),
      entry("duplicate", "/repos/alpha", "complete"),
      entry("beta-01", "/repos/beta", "complete", "2027-01-01T00:00:00.000Z"),
    ],
  });
  assert.deepEqual(result.projects.map((project) => project.canonicalRoot), ["/repos/alpha", "/repos/beta"]);
  assert.deepEqual(result.projects[0].ambiguousIds, ["duplicate"]);
});

test("uses the stored key when a registered root cannot be realpathed", () => {
  const result = snapshot({
    registeredRoots: [{ root: "/missing", repoKey: "storedkey123" }],
    health: new Map([["/missing", "missing"]]),
  });
  assert.equal(result.projects[0].repoKey, "storedkey123");
  assert.equal(result.projects[0].health, "missing");
});
