import assert from "node:assert/strict";
import test from "node:test";
import {
  burnlistHref,
  burnlistOvenHref,
  differentialTestingScenarioHref,
  legacyRoute,
  parseRoute,
  repoOvenHref,
  streamingDiffFeedHref,
} from "./route-model.mjs";

test("parseRoute recognizes the dashboard path model", () => {
  assert.deepEqual(parseRoute({ pathname: "/", search: "?filter=active" }), { section: "landing", filter: "active" });
  assert.deepEqual(parseRoute({ pathname: "/ovens", search: "" }), { section: "ovens-catalog" });
  assert.deepEqual(parseRoute({ pathname: "/ovens/new", search: "" }), { section: "new-oven" });
  assert.deepEqual(parseRoute({ pathname: "/ovens/example-oven", search: "" }), { section: "oven-explainer", ovenId: "example-oven" });
  assert.deepEqual(parseRoute({ pathname: "/runs/new", search: "" }), { section: "run-burn" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo%2Fone/list-1", search: "?filter=complete" }), { section: "burnlist", repoKey: "repo/one", burnlistId: "list-1", filter: "complete" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/list", search: "?plan=%2Ftmp%2Fplan.md" }), { section: "burnlist", repoKey: "repo", burnlistId: "list", plan: "/tmp/plan.md" });
  assert.deepEqual(parseRoute({ pathname: "/legacy-repo/list-1", search: "?plan=x" }), { section: "burnlist", repo: "legacy-repo", burnlistId: "list-1", plan: "x" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/o/differential-testing", search: "?scenario=case-1" }), { section: "differential-testing", repoKey: "repo", ovenId: "differential-testing", scenario: "case-1" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/o/model-lab", search: "" }), { section: "model-lab", repoKey: "repo", ovenId: "model-lab" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/o/performance-tracing", search: "" }), { section: "performance-tracing", repoKey: "repo", ovenId: "performance-tracing" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/o/streaming-diff", search: "?worktreeKey=work&session=s1" }), { section: "streaming-diff", repoKey: "repo", ovenId: "streaming-diff", worktreeKey: "work", session: "s1" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/o/visual-parity", search: "" }), { section: "visual-parity", repoKey: "repo", ovenId: "visual-parity" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/list/o/differential-testing", search: "?scenario=case-1" }), { section: "differential-testing", repoKey: "repo", burnlistId: "list", ovenId: "differential-testing", scenario: "case-1" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/list/o/checklist", search: "" }), { section: "burnlist", repoKey: "repo", burnlistId: "list", ovenId: "checklist" });
  assert.deepEqual(parseRoute({ pathname: "/r/repo/list/o/widget-oven", search: "?page=2" }), { section: "custom-oven", repoKey: "repo", burnlistId: "list", ovenId: "widget-oven", page: "2" });
});

test("href builders put repo keys only in path segments", () => {
  assert.equal(burnlistOvenHref({ repoKey: "k", burnlistId: "260721-001", ovenId: "checklist" }), "/r/k/260721-001/o/checklist");
  const hrefs = [
    repoOvenHref({ repoKey: "repo/key", ovenId: "custom oven", query: { filter: "active" } }),
    repoOvenHref({ repoKey: null, ovenId: "custom oven" }),
    burnlistHref({ repoKey: "repo/key", burnlistId: "burn/list", query: { filter: "active" } }),
    burnlistOvenHref({ repoKey: "repo/key", burnlistId: "burn/list", ovenId: "custom oven", query: { filter: "active" } }),
    streamingDiffFeedHref({ repoKey: "repo/key", worktreeKey: "work tree", session: "session 1" }),
    differentialTestingScenarioHref({ repoKey: "repo/key", scenario: "case 1" }),
  ];
  assert.deepEqual(hrefs, [
    "/r/repo%2Fkey/o/custom%20oven?filter=active",
    "/ovens/custom%20oven",
    "/r/repo%2Fkey/burn%2Flist?filter=active",
    "/r/repo%2Fkey/burn%2Flist/o/custom%20oven?filter=active",
    "/r/repo%2Fkey/o/streaming-diff?worktreeKey=work+tree&session=session+1",
    "/r/repo%2Fkey/o/differential-testing?scenario=case+1",
  ]);
  for (const href of hrefs) assert.doesNotMatch(href, /repoKey=/u);
});

test("legacyRoute redirects old oven views and leaves current paths alone", () => {
  assert.equal(legacyRoute({ pathname: "/ovens/model-lab/view", search: "?repoKey=repo%2Fkey" }), "/r/repo%2Fkey/o/model-lab");
  assert.equal(legacyRoute({ pathname: "/ovens/differential-testing/view", search: "?scenario=case+1&repoKey=repo%2Fkey" }), "/r/repo%2Fkey/o/differential-testing?scenario=case+1");
  assert.equal(legacyRoute({ pathname: "/ovens/streaming-diff/view", search: "?repoKey=repo%2Fkey&worktreeKey=work+tree&session=session+1" }), "/r/repo%2Fkey/o/streaming-diff?worktreeKey=work+tree&session=session+1");
  assert.equal(legacyRoute({ pathname: "/ovens/custom-oven/view", search: "?repoKey=repo%2Fkey&filter=active" }), "/r/repo%2Fkey/o/custom-oven?filter=active");
  assert.equal(legacyRoute({ pathname: "/ovens/custom-oven/view", search: "?filter=active" }), "/ovens/custom-oven?filter=active");
  assert.equal(legacyRoute({ pathname: "/r/repo/o/model-lab", search: "" }), null);
});
