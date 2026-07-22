import assert from "node:assert/strict";
import test from "node:test";
import { httpGet, httpRequest, withServer } from "./dashboard-routes-fixtures.mjs";

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

test("/api/oven-catalog is official-only while /api/ovens remains origin-labeled inventory", { timeout: 20_000 }, async () => {
  await withServer({
    withBurnlist: true,
    ovens: [{ id: "local-only", repoPath: "fixture-repo" }],
  }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/api/oven-catalog");
    assert.equal(response.status, 200);
    const catalog = JSON.parse(response.body);
    assert.equal(catalog.schema, "burnlist-official-oven-catalog@1");
    assert.equal(catalog.catalogVersion, "1.0.0");
    assert.match(catalog.catalogRevision, /^[a-f0-9]{64}$/u);
    assert.deepEqual(catalog.entries.map(({ id }) => id), [
      "checklist",
      "differential-testing",
      "model-lab",
      "performance-tracing",
      "streaming-diff",
      "visual-parity",
    ]);
    assert.equal(catalog.entries.some(({ id }) => id === "local-only"), false);
    for (const entry of catalog.entries) {
      assert.equal(entry.acceptance.fixtureEvidence, "forbidden");
      assert.equal(Object.hasOwn(entry, "repoKey"), false);
      assert.match(entry.ovenRevision, /^o1-sha256:[a-f0-9]{64}$/u);
    }

    const inventory = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body).ovens;
    const official = inventory.filter(({ origin }) => origin === "official");
    const local = inventory.find(({ id }) => id === "local-only");
    assert.deepEqual(official.map(({ id }) => id), catalog.entries.map(({ id }) => id));
    assert.ok(official.every((entry) => entry.catalogRevision === catalog.catalogRevision));
    assert.match(
      official.find(({ id }) => id === "streaming-diff").description,
      /recently published, session-scoped pre-to-post diff cards\..*selected-feed component view\.$/u,
    );
    assert.equal(local.origin, "custom");
    assert.equal(local.catalogRevision, null);
    assert.ok(local.repoKey);

    const rejected = await httpRequest(baseUrl, "/api/oven-catalog", { method: "POST", headers: {}, body: "" });
    assert.equal(rejected.status, 405);
  });
});
