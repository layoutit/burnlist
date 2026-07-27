import { describe, expect, test } from "bun:test";
import { groupBurnlists, orderedBurnlists } from "./landing-groups";
import type { BurnlistSummary, LandingSnapshot } from "./types";

const entry = (repoKey: string, repo: string, id: string): BurnlistSummary => ({
  id, repo, repoKey, repoRoot: null, title: id, planPath: null, planLabel: null,
  status: "active", statusLabel: "Active", total: 1, done: 0, remaining: 1,
  percent: 0, errors: 0, warnings: 0, updatedAt: null, lastCompletedAt: null,
  ovenId: "checklist", ovenName: "Checklist", href: "/", progressLabel: "0/1",
});

test("groups Burnlists in project catalog order", () => {
  const landing: LandingSnapshot = {
    generatedAt: "now", ovens: [],
    projects: [
      { repoKey: "b", displayName: "Beta", canonicalRoot: null, health: "healthy", counts: { total: 1, active: 1 } },
      { repoKey: "a", displayName: "Alpha", canonicalRoot: null, health: "healthy", counts: { total: 2, active: 2 } },
    ],
    burnlists: [entry("a", "alpha", "a1"), entry("b", "beta", "b1"), entry("a", "alpha", "a2")],
  };
  expect(groupBurnlists(landing).map((group) => [group.label, group.entries.map((item) => item.id)])).toEqual([
    ["Beta", ["b1"]], ["Alpha", ["a1", "a2"]],
  ]);
  expect(orderedBurnlists(landing).map((item) => item.id)).toEqual(["b1", "a1", "a2"]);
});
