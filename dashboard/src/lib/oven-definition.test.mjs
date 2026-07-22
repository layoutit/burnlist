import assert from "node:assert/strict";
import test from "node:test";
import { checklistOvenRepoKey, loadOvenDefinition, ovenDefinitionUrl } from "./oven-definition.mjs";

const ir = { id: "checklist", root: [], controls: [], collections: [] };

test("repository Oven definitions use the scoped API and return its runtime IR", async () => {
  const calls = [];
  const loaded = await loadOvenDefinition({
    id: "checklist",
    repoKey: "repo/key",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ oven: { ir } }) };
    },
  });

  assert.equal(loaded, ir);
  assert.deepEqual(calls, [{
    url: "/api/ovens/checklist?repoKey=repo%2Fkey",
    init: { cache: "no-store" },
  }]);
  assert.equal(ovenDefinitionUrl("visual-parity"), "/api/ovens/visual-parity");
});

test("Checklist definitions use the repository resolved by progress for every selection shape", () => {
  const cases = [
    {
      name: "modern",
      selected: { repoKey: "route-modern", id: "daily" },
      progress: { repoKey: "resolved-modern" },
      expected: "resolved-modern",
    },
    {
      name: "plan-path",
      selected: { plan: "/work/.burnlist/active/plan.md" },
      progress: { repoKey: "resolved-plan" },
      expected: "resolved-plan",
    },
    {
      name: "legacy",
      selected: { repo: "legacy-repository", id: "daily" },
      progress: { repoKey: "resolved-legacy" },
      expected: "resolved-legacy",
    },
  ];

  for (const { name, selected, progress, expected } of cases) {
    const repoKey = checklistOvenRepoKey(progress, selected);
    assert.equal(repoKey, expected, name);
    assert.equal(ovenDefinitionUrl("checklist", repoKey), `/api/ovens/checklist?repoKey=${expected}`, name);
  }
});

test("Checklist definition resolution falls back to the selected repository key", () => {
  assert.equal(checklistOvenRepoKey({ repoKey: null }, { repoKey: "selected-repo" }), "selected-repo");
  assert.equal(checklistOvenRepoKey(null, null), null);
});

test("Oven definition loading rejects failed and malformed responses", async () => {
  await assert.rejects(
    loadOvenDefinition({ id: "checklist", fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) }),
    /Could not load Oven checklist \(404\)/u,
  );
  await assert.rejects(
    loadOvenDefinition({ id: "checklist", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ oven: { ir: { ...ir, id: "other" } } }) }) }),
    /invalid runtime definition/u,
  );
});
