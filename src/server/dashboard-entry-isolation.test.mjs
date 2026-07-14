import assert from "node:assert/strict";
import test from "node:test";
import { isolatedDashboardEntries } from "./dashboard-entry-isolation.mjs";

function validRow(id) {
  return {
    id, repo: "fixture", repoKey: null, repoRoot: null, planPath: null, planLabel: null, title: id,
    status: "active", statusLabel: "Active", total: 1, done: 0, remaining: 1, percent: 0,
    errors: 0, warnings: 0, lastCompletedAt: null, updatedAt: null, ovenId: id, ovenName: id,
    href: "/", progressLabel: "0/1 done",
  };
}

test("dashboard row normalization blocks malformed handler rows without hiding healthy handlers", () => {
  const handlers = [
    { id: "null-row", dashboardEntries: () => [null] },
    { id: "missing-field", dashboardEntries: () => [{ id: "missing-field" }] },
    { id: "healthy", dashboardEntries: () => [validRow("healthy")] },
  ];
  const entries = isolatedDashboardEntries({
    handlers,
    contextForHandler: () => ({}),
    repoKeyForRoot: (root) => root,
    blockedEntry: (handler, error) => ({ ...validRow(`blocked-${handler.id}`), ovenId: handler.id, blockers: error.message }),
  });
  assert.equal(entries.some((entry) => entry.id === "healthy"), true);
  assert.deepEqual(entries.filter((entry) => entry.id.startsWith("blocked-")).map((entry) => entry.ovenId).sort(), [
    "missing-field", "null-row",
  ]);
  assert.deepEqual(entries.find((entry) => entry.id === "healthy")?.planPath, null);
  assert.deepEqual(entries.find((entry) => entry.id === "healthy")?.planLabel, null);
});
