import assert from "node:assert/strict";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { buildPayload } from "../../ovens/differential-testing/example/adapter.mjs";
import test from "node:test";
import { httpGet, withServer } from "./dashboard-routes-fixtures.mjs";
test("unreadable binding stores do not affect unrelated routes and healthy Oven data", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [{ repoPath: "bad" }, { repoPath: "good" }],
    ovenData: [{ id: "checklist", payload: { source: "good" }, repoPath: "good", persisted: true, override: false }],
    setup: async ({ fixtureRoot }) => {
      await mkdir(join(fixtureRoot, "bad", ".local", "burnlist", "bindings.json"), { recursive: true });
    },
  }, async ({ baseUrl }) => {
    assert.equal((await httpGet(baseUrl, "/")).status, 200);
    assert.equal((await httpGet(baseUrl, "/favicon.svg")).status, 200);
    assert.equal((await httpGet(baseUrl, "/api/progress?repo=bad&id=fixture")).status, 200);
    const entries = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists;
    const good = entries.find((entry) => entry.ovenId === "checklist" && entry.repo === "good");
    assert.ok(good);
    const data = await httpGet(baseUrl, `/api/oven-data/checklist?repoKey=${good.repoKey}`);
    assert.equal(data.status, 200);
    assert.deepEqual(JSON.parse(data.body).payload, { source: "good" });
  });
});

test("registered Oven routes and dashboard entries isolate malformed custom Oven packages", { timeout: 20_000 }, async () => {
  const timestamp = "2026-01-01T12:00:00.000Z";
  const differentialTestingPayload = buildPayload(
    {
      captureId: "reference-fixture", generatedAt: timestamp,
      fields: [{ id: "position", label: "Position", sourceOwner: "fixture", meaning: "Position", unit: "units", tolerance: 0 }],
      samples: [{ tick: 0, values: { position: 1 } }],
    },
    { captureId: "candidate-fixture", generatedAt: timestamp, samples: [{ tick: 0, values: { position: 1 } }] },
  );
  await withServer({
    withBurnlist: true,
    ovens: [{ id: "malformed-oven", ovenJson: "{" }],
    ovenData: [
      { id: "checklist", payload: { source: "generic" } },
      { id: "differential-testing", payload: differentialTestingPayload },
    ],
  }, async ({ baseUrl }) => {
    const checklist = await httpGet(baseUrl, "/api/oven-data/checklist");
    assert.equal(checklist.status, 200);
    const checklistResponse = JSON.parse(checklist.body);
    assert.deepEqual(checklistResponse.payload, { source: "generic" });
    assert.equal(checklistResponse.validated, false);

    const differentialTesting = await httpGet(baseUrl, "/api/oven-data/differential-testing");
    assert.equal(differentialTesting.status, 200);
    const differentialTestingResponse = JSON.parse(differentialTesting.body);
    assert.equal(differentialTestingResponse.scenarioId, differentialTestingPayload.scenarioCatalog.selectedScenarioId);
    assert.equal(Object.hasOwn(differentialTestingResponse, "validated"), false);

    const entries = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists;
    assert.equal(entries.some((entry) => entry.ovenId === "checklist"), true);
    assert.equal(entries.some((entry) => entry.ovenId === "differential-testing"), true);

    const ovens = await httpGet(baseUrl, "/api/ovens");
    assert.equal(ovens.status, 200);
    assert.equal(JSON.parse(ovens.body).ovens.some((oven) => oven.id === "checklist"), true);
    const malformed = await httpGet(baseUrl, "/api/ovens/malformed-oven");
    assert.equal(malformed.status, 400);
    assert.match(JSON.parse(malformed.body).error, /lineage sidecar is invalid/u);
  });
});

test("an unknown Oven with a data binding remains unvalidated", { timeout: 20_000 }, async () => {
  await withServer({ ovenData: [{ id: "ghost", payload: { ignored: true } }] }, async ({ baseUrl }) => {
    const unknown = await httpGet(baseUrl, "/api/oven-data/ghost");
    assert.equal(unknown.status, 404);
    assert.equal(JSON.parse(unknown.body).validated, false);
  });
});

test("a discovered custom Oven with a data binding is served as unvalidated JSON", { timeout: 20_000 }, async () => {
  await withServer({
    ovens: [{ id: "custom-oven" }],
    ovenData: [{ id: "custom-oven", payload: { source: "custom" } }],
  }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/api/oven-data/custom-oven");
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body).payload, { source: "custom" });
    assert.equal(JSON.parse(response.body).validated, false);
  });
});

test("Differential Testing bindings remain distinct for each repository", { timeout: 20_000 }, async () => {
  const timestamp = "2026-01-01T12:00:00.000Z";
  const payloadFor = (captureId) => buildPayload(
    {
      captureId, generatedAt: timestamp,
      fields: [{ id: "position", label: "Position", sourceOwner: "fixture", meaning: "Position", unit: "units", tolerance: 0 }],
      samples: [{ tick: 0, values: { position: 1 } }],
    },
    { captureId: `${captureId}-candidate`, generatedAt: timestamp, samples: [{ tick: 0, values: { position: 1 } }] },
  );
  const first = payloadFor("first-repo");
  const second = payloadFor("second-repo");
  await withServer({
    burnlists: [{ repoPath: "a/first" }, { repoPath: "b/second" }],
    scanRoots: ["a", "b"],
    ovenData: [
      { id: "differential-testing", payload: first, repoPath: "a/first", persisted: true, override: false },
      { id: "differential-testing", payload: second, repoPath: "b/second", persisted: true, override: false },
    ],
  }, async ({ baseUrl }) => {
    const entries = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists
      .filter((entry) => entry.ovenId === "differential-testing");
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map((entry) => entry.repoKey)).size, 2);
    for (const entry of entries) {
      assert.equal(entry.planPath, null);
      assert.equal(entry.planLabel, null);
      assert.match(entry.href, new RegExp(`^/ovens/differential-testing/view\\?scenario=${entry.id}&repoKey=${entry.repoKey}$`, "u"));
    }

    const firstEntry = entries.find((entry) => entry.title === "first-repo");
    const secondEntry = entries.find((entry) => entry.title === "second-repo");
    assert.ok(firstEntry);
    assert.ok(secondEntry);
    const firstResponse = await httpGet(baseUrl, `/api/oven-data/differential-testing?repoKey=${firstEntry.repoKey}`);
    const secondResponse = await httpGet(baseUrl, `/api/oven-data/differential-testing?repoKey=${secondEntry.repoKey}`);
    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.equal(JSON.parse(firstResponse.body).payload.subtitle, "first-repo / first-repo-candidate");
    assert.equal(JSON.parse(secondResponse.body).payload.subtitle, "second-repo / second-repo-candidate");
  });
});

test("invalid Differential Testing bindings render blocked rows without hiding valid bindings or Checklists", { timeout: 20_000 }, async () => {
  const timestamp = "2026-01-01T12:00:00.000Z";
  const valid = buildPayload(
    {
      captureId: "valid-repo", generatedAt: timestamp,
      fields: [{ id: "position", label: "Position", sourceOwner: "fixture", meaning: "Position", unit: "units", tolerance: 0 }],
      samples: [{ tick: 0, values: { position: 1 } }],
    },
    { captureId: "valid-repo-candidate", generatedAt: timestamp, samples: [{ tick: 0, values: { position: 1 } }] },
  );
  await withServer({
    burnlists: [{ repoPath: "a/broken" }, { repoPath: "b/valid" }],
    scanRoots: ["a", "b"],
    ovenData: [
      { id: "differential-testing", payload: {}, repoPath: "a/broken", persisted: true, override: false },
      { id: "differential-testing", payload: valid, repoPath: "b/valid", persisted: true, override: false },
    ],
  }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/api/burnlists");
    assert.equal(response.status, 200);
    const entries = JSON.parse(response.body).burnlists;
    assert.equal(entries.filter((entry) => entry.ovenId === "checklist").length, 2);
    const blocked = entries.find((entry) => entry.ovenId === "differential-testing" && entry.statusLabel === "Blocked");
    assert.ok(blocked);
    assert.equal(blocked.status, "active");
    assert.equal(typeof blocked.blockers, "string");
    assert.equal(entries.some((entry) => entry.ovenId === "differential-testing" && entry.statusLabel === "Active"), true);
  });
});

test("Oven data repo binding falls back to the global override", { timeout: 20_000 }, async () => {
  const timestamp = "2026-01-01T12:00:00.000Z";
  const payloadFor = (captureId) => buildPayload(
    {
      captureId, generatedAt: timestamp,
      fields: [{ id: "position", label: "Position", sourceOwner: "fixture", meaning: "Position", unit: "units", tolerance: 0 }],
      samples: [{ tick: 0, values: { position: 1 } }],
    },
    { captureId: `${captureId}-candidate`, generatedAt: timestamp, samples: [{ tick: 0, values: { position: 1 } }] },
  );
  const override = payloadFor("global-override");
  const exact = payloadFor("exact-repo");
  await withServer({
    burnlists: [
      { repoPath: "a/first", title: "First repository" },
      { repoPath: "b/second", title: "Second repository" },
    ],
    scanRoots: ["a", "b"],
    ovenData: [
      { id: "differential-testing", payload: override },
      { id: "differential-testing", payload: exact, repoPath: "a/first", persisted: true, override: false },
    ],
  }, async ({ baseUrl }) => {
    const burnlists = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists;
    const dtEntries = burnlists.filter((entry) => entry.ovenId === "differential-testing");
    // repoKeys come from the checklist entries (DT entry titles are scenario labels, not repo titles).
    const firstChecklist = burnlists.find((entry) => entry.ovenId === "checklist" && entry.title === "First repository");
    const secondChecklist = burnlists.find((entry) => entry.ovenId === "checklist" && entry.title === "Second repository");
    assert.ok(firstChecklist);
    assert.ok(secondChecklist);
    // a/first has its own persisted binding → a DT row; b/second (unbound) gets no fabricated row.
    assert.equal(dtEntries.some((entry) => entry.repoKey === firstChecklist.repoKey), true);
    assert.equal(dtEntries.some((entry) => entry.repoKey === secondChecklist.repoKey), false);
    const exactResponse = await httpGet(baseUrl, `/api/oven-data/differential-testing?repoKey=${firstChecklist.repoKey}`);
    const fallbackResponse = await httpGet(baseUrl, `/api/oven-data/differential-testing?repoKey=${secondChecklist.repoKey}`);
    assert.equal(exactResponse.status, 200);
    assert.equal(fallbackResponse.status, 200);
    assert.equal(JSON.parse(exactResponse.body).payload.subtitle, "exact-repo / exact-repo-candidate");
    assert.equal(JSON.parse(fallbackResponse.body).payload.subtitle, "global-override / global-override-candidate");
  });
});

test("Oven discovery exposes optional lineage, skips malformed catalog entries, and keeps direct reads closed", { timeout: 20_000 }, async () => {
  const forkedFrom = { ovenId: "source-oven", revision: `o1-sha256:${"a".repeat(64)}` };
  await withServer({
    ovens: [
      { id: "forked-oven", ovenJson: { forkedFrom } },
      { id: "standalone-oven" },
    ],
  }, async ({ baseUrl }) => {
    const forked = JSON.parse((await httpGet(baseUrl, "/api/ovens/forked-oven")).body).oven;
    const standalone = JSON.parse((await httpGet(baseUrl, "/api/ovens/standalone-oven")).body).oven;
    assert.deepEqual(forked.forkedFrom, forkedFrom);
    assert.equal(Object.hasOwn(standalone, "forkedFrom"), false);
  });
  await withServer({ ovens: [{ id: "broken-oven", ovenJson: "{" }] }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/api/ovens");
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).ovens.some((oven) => oven.id === "broken-oven"), false);
    const direct = await httpGet(baseUrl, "/api/ovens/broken-oven");
    assert.equal(direct.status, 400);
    assert.match(JSON.parse(direct.body).error, /lineage sidecar is invalid/u);
  });
});

test("dashboard custom Oven storage follows its umbrella root and rejects symlink escapes", { timeout: 20_000 }, async () => {
  await withServer({
    withBurnlist: true,
    launchCwd: "fixture-repo/work/nested",
    ovensRoot: "fixture-repo",
    ovens: [{ id: "umbrella-oven" }],
  }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/api/ovens");
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).ovens.some((oven) => oven.id === "umbrella-oven"), true);
  });

  await assert.rejects(() => withServer({
    withBurnlist: true,
    launchCwd: "fixture-repo",
    setup: async ({ fixtureRoot }) => {
      const repo = join(fixtureRoot, "fixture-repo");
      const outside = join(fixtureRoot, "outside");
      await mkdir(outside);
      await symlink(outside, join(repo, ".local"), "dir");
    },
  }, async () => assert.fail("server must refuse an escaped custom Oven directory")), /escapes/u);

  await withServer({
    withBurnlist: true,
    launchCwd: "fixture-repo",
    setup: async ({ fixtureRoot }) => {
      const ovens = join(fixtureRoot, "fixture-repo", ".local", "burnlist", "ovens");
      const outside = join(fixtureRoot, "id-outside");
      await mkdir(ovens, { recursive: true });
      await mkdir(outside);
      await symlink(outside, join(ovens, "escaped-oven"), "dir");
    },
  }, async ({ baseUrl }) => {
    const direct = await httpGet(baseUrl, "/api/ovens/escaped-oven");
    assert.equal(direct.status, 400);
    assert.match(JSON.parse(direct.body).error, /escapes/u);
  });
});
