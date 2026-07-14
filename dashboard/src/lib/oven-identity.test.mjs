import assert from "node:assert/strict";
import test from "node:test";
import { ovenActionUrl, ovenCatalogKey, ovenTargetRepoRoot } from "./oven-identity.mjs";

test("custom Oven identity keeps same-id rows distinct and carries repoKey into actions", () => {
  const first = { id: "shared", repoKey: "aaaaaaaaaaaa", builtIn: false };
  const second = { id: "shared", repoKey: "bbbbbbbbbbbb", builtIn: false };
  const repos = [{ repoKey: first.repoKey, root: "/repos/a" }, { repoKey: second.repoKey, root: "/repos/b" }];
  assert.notEqual(ovenCatalogKey(first), ovenCatalogKey(second));
  assert.equal(ovenActionUrl(second), "/api/ovens/shared?repoKey=bbbbbbbbbbbb");
    assert.equal(ovenTargetRepoRoot(second, repos), "/repos/b");
    assert.equal(ovenTargetRepoRoot({ id: "checklist", repoKey: null }, repos), null);
  assert.equal(ovenActionUrl({ id: "checklist", repoKey: null }), "/api/ovens/checklist");
});
