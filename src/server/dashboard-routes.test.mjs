import assert from "node:assert/strict";
import test from "node:test";
import { httpGet, withServer } from "./dashboard-routes-fixtures.mjs";

test("root serves the dashboard shell", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/");
    assert.equal(response.status, 200);
  });
});

test("reserved and path-scoped dashboard routes serve the SPA shell", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    for (const pathname of [
      "/ovens",
      "/ovens/example-oven",
      "/r/aaaaaaaaaaaa/o/model-lab",
      "/r/aaaaaaaaaaaa/fixture/o/streaming-diff",
    ]) assert.equal((await httpGet(baseUrl, pathname)).status, 200);
  });
});

test("legacy Oven view routes are not live dashboard implementations", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    assert.equal((await httpGet(baseUrl, "/ovens/example-oven/view")).status, 404);
  });
});

test("/api/progress requires an explicit selection when one Burnlist is active", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/api/progress");
    assert.equal(response.status, 409);
    const payload = JSON.parse(response.body);
    assert.equal(payload.error, "Select a Burnlist.");
    assert.equal(payload.burnlists.length, 1);
    assert.equal(Object.hasOwn(payload, "burnlist"), false);
    assert.equal(Object.hasOwn(payload, "planPath"), false);
  });
});

test("/api/progress?plan= resolves a Burnlist by its (non-canonical) absolute path", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl, planPath }) => {
    const response = await httpGet(baseUrl, `/api/progress?plan=${encodeURIComponent(planPath)}`);
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    for (const key of ["percent", "done", "remaining"]) assert.equal(typeof payload[key], "number");
    assert.equal(Array.isArray(payload.history), true);
  });
});

test("/api/progress rejects an unknown plan path", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, `/api/progress?plan=${encodeURIComponent("/no/such/burnlist.md")}`);
    assert.equal(response.status, 409);
    assert.match(JSON.parse(response.body).error, /No Burnlist found/u);
  });
});

test("/api/progress reports ambiguity for duplicate repo names and ids", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [
      { repoPath: "a/app", id: "shared", title: "First app fixture" },
      { repoPath: "b/app", id: "shared", title: "Second app fixture" },
    ],
    scanRoots: ["a", "b"],
  }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/api/progress?repo=app&id=shared");
    assert.equal(response.status, 409);
    assert.match(JSON.parse(response.body).error, /is ambiguous; select by plan path\./u);
  });
});

test("/api/burnlists lists discovered Burnlists across the observer set", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/api/burnlists");
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(Array.isArray(payload.burnlists), true);
    const entry = payload.burnlists.find((candidate) => candidate.id === "fixture");
    assert.ok(entry);
    assert.equal(typeof entry.planPath, "string");
  });
});
