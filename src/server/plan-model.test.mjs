import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { completedDetailMap, documentSections, repoRootForPlan } from "./plan-model.mjs";

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

test("completedDetailMap accepts common agent heading separators without splitting stable ids", () => {
  const sections = documentSections(`# Completed Work

## B1 | Canonical pipe

- Pipe detail.

## B2 — Em dash

- Em detail.

## B3 – En dash

- En detail.

## auth-07 - Hyphen

- Hyphen detail.

## Completion Digest

Not an item.`);
  assert.deepEqual([...completedDetailMap(sections)], [
    ["B1", { title: "Canonical pipe", detail: "- Pipe detail." }],
    ["B2", { title: "Em dash", detail: "- Em detail." }],
    ["B3", { title: "En dash", detail: "- En detail." }],
    ["auth-07", { title: "Hyphen", detail: "- Hyphen detail." }],
  ]);
});
