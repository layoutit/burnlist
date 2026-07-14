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

function blockedEntry(handler, error) {
  return { ...validRow(`blocked-${handler.id}`), ovenId: handler.id, blockers: error.message };
}

test("dashboard row normalization isolates malformed rows without hiding their healthy siblings", () => {
  const handlers = [
    {
      id: "mixed", dashboardEntries: () => [
        { ...validRow("older"), updatedAt: "2026-01-01T00:00:00Z" },
        null,
        { ...validRow("newer"), updatedAt: "2026-01-03T00:00:00Z" },
      ],
    },
    { id: "throws", dashboardEntries: () => { throw new Error("handler failed"); } },
  ];
  const entries = isolatedDashboardEntries({
    handlers,
    contextForHandler: () => ({}),
    repoKeyForRoot: (root) => root,
    blockedEntry,
  });
  assert.deepEqual(entries.map((entry) => entry.id), ["newer", "older", "blocked-mixed-1", "blocked-throws"]);
  assert.equal(entries.find((entry) => entry.id === "blocked-mixed-1")?.blockers, "Dashboard handler returned a malformed row.");
  assert.equal(entries.find((entry) => entry.id === "blocked-throws")?.blockers, "handler failed");
});

test("dashboard row normalization blocks a non-slug oven id", () => {
  const entries = isolatedDashboardEntries({
    handlers: [{ id: "contract", dashboardEntries: () => [{ ...validRow("valid"), ovenId: "Not a slug" }] }],
    contextForHandler: () => ({}),
    repoKeyForRoot: (root) => root,
    blockedEntry,
  });
  assert.deepEqual(entries.map((entry) => entry.id), ["blocked-contract-0"]);
  assert.match(entries[0].blockers, /Oven id must be a lowercase slug/u);
});
