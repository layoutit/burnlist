import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPayload } from "../../ovens/differential-testing/example/adapter.mjs";
import test from "node:test";
import { starterOvenSource } from "../ovens/oven-starter.mjs";
import { repoKey } from "./registry.mjs";
import { httpGet, httpRequest, withServer } from "./dashboard-routes-fixtures.mjs";

test("POST /api/ovens refuses an unignored Git repository without writing an Oven", { timeout: 20_000 }, async () => {
  await withServer({
    setup: async ({ fixtureRoot }) => {
      // Git-init the launch umbrella (where the server writes the oven), not a nested repo.
      execFileSync("git", ["init", "--quiet"], { cwd: fixtureRoot, stdio: "ignore" });
    },
  }, async ({ baseUrl, repoRoot }) => {
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const response = await httpRequest(baseUrl, "/api/ovens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-burnlist-token": catalog.writeToken },
      body: JSON.stringify({
        id: "unignored-oven", name: "Unignored Oven", instructions: "# Unignored Oven\n\nStay local.",
      }),
    });
    assert.equal(response.status, 400);
    assert.match(JSON.parse(response.body).error, /refusing to write \.local\/burnlist\/ovens: not git-ignored/u);
    assert.equal(existsSync(join(repoRoot, ".local", "burnlist", "ovens", "unignored-oven")), false);
  });
});
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
    ovens: [{ id: "malformed-oven", ovenJson: "{", repoPath: "fixture-repo" }],
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
    const fixtureKey = entries.find((entry) => entry.ovenId === "checklist").repoKey;

    const ovens = await httpGet(baseUrl, "/api/ovens");
    assert.equal(ovens.status, 200);
    assert.equal(JSON.parse(ovens.body).ovens.some((oven) => oven.id === "checklist"), true);
    const malformed = await httpGet(baseUrl, `/api/ovens/malformed-oven?repoKey=${fixtureKey}`);
    assert.equal(malformed.status, 400);
    assert.match(JSON.parse(malformed.body).error, /lineage sidecar is invalid/u);
  });
});

test("a generated Differential Testing row href resolves (global built-in, repoKey selects data)", { timeout: 20_000 }, async () => {
  const timestamp = "2026-01-01T12:00:00.000Z";
  const payload = buildPayload(
    {
      captureId: "reference-fixture", generatedAt: timestamp,
      fields: [{ id: "position", label: "Position", sourceOwner: "fixture", meaning: "Position", unit: "units", tolerance: 0 }],
      samples: [{ tick: 0, values: { position: 1 } }],
    },
    { captureId: "candidate-fixture", generatedAt: timestamp, samples: [{ tick: 0, values: { position: 1 } }] },
  );
  await withServer({
    burnlists: [{ repoPath: "app" }],
    ovenData: [{ id: "differential-testing", payload, repoPath: "app", persisted: true, override: false }],
  }, async ({ baseUrl }) => {
    const rows = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists;
    const dtRow = rows.find((row) => row.ovenId === "differential-testing" && row.statusLabel !== "Blocked");
    assert.ok(dtRow, "expected a Differential Testing dashboard row");
    assert.match(dtRow.href, /^\/r\/[a-f0-9]{12}\/o\/differential-testing\?scenario=/u);
    // The generated row link (built-in oven + a repoKey data selector) must resolve, not 404.
    assert.equal((await httpGet(baseUrl, dtRow.href)).status, 200);
    // The oven itself is global; repoKey only selects that repo's data binding.
    assert.equal((await httpGet(baseUrl, `/api/ovens/differential-testing?repoKey=${dtRow.repoKey}`)).status, 200);
    assert.equal((await httpGet(baseUrl, `/api/oven-data/differential-testing?repoKey=${dtRow.repoKey}`)).status, 200);
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
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const oven = catalog.ovens.find((entry) => entry.id === "custom-oven");
    assert.ok(oven);
    assert.equal((await httpGet(baseUrl, "/api/oven-data/custom-oven")).status, 404);
    const response = await httpGet(baseUrl, `/api/oven-data/custom-oven?repoKey=${oven.repoKey}`);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body).payload, { source: "custom" });
    assert.equal(JSON.parse(response.body).validated, false);
  });
});

test("a launched repository custom Oven is listed and requires its umbrella repoKey", { timeout: 20_000 }, async () => {
  await withServer({ ovens: [{ id: "launch-only" }] }, async ({ baseUrl }) => {
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body).ovens;
    const launchOven = catalog.find((oven) => oven.id === "launch-only");
    assert.ok(launchOven);
    assert.notEqual(launchOven.repoKey, null);

    const response = await httpGet(baseUrl, "/api/ovens/launch-only");
    assert.equal(response.status, 404);
    assert.equal((await httpGet(baseUrl, `/api/ovens/launch-only?repoKey=${launchOven.repoKey}`)).status, 200);
    const repos = JSON.parse((await httpGet(baseUrl, "/api/repos")).body).repos;
    assert.equal(repos.some((repo) => repo.repoKey === launchOven.repoKey), true);
  });
});

test("custom Ovens are identified by repository while built-ins remain global", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [{ repoPath: "a" }, { repoPath: "b" }, { repoPath: "c" }],
    scanRoots: ["a", "b", "c"],
    launchCwd: "a",
    ovens: [
      { id: "shared", repoPath: "a", instructions: "# Oven A\n\nA definition.\n" },
      { id: "shared", repoPath: "b", instructions: "# Oven B\n\nB definition.\n" },
    ],
    ovenData: [
      { id: "shared", payload: { source: "A" }, repoPath: "a", persisted: true, override: false },
      { id: "shared", payload: { source: "B" }, repoPath: "b", persisted: true, override: false },
    ],
  }, async ({ baseUrl }) => {
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const shared = catalog.ovens.filter((oven) => oven.id === "shared");
    assert.equal(shared.length, 2);
    assert.equal(new Set(shared.map((oven) => oven.repoKey)).size, 2);
    assert.ok(shared.every((oven) => oven.dataInput === "json-payload"));
    assert.deepEqual(
      Object.keys(shared[0]).sort(),
      ["builtIn", "contract", "dataInput", "description", "id", "name", "ovenRevision", "repoKey", "version"],
    );
    assert.equal(catalog.ovens.find((oven) => oven.id === "checklist").contract, "checklist-progress@1");
    assert.equal(catalog.ovens.find((oven) => oven.id === "checklist").repoKey, null);
    assert.equal(catalog.ovens.find((oven) => oven.id === "checklist").dataInput, "json-payload");
    assert.equal(catalog.ovens.find((oven) => oven.id === "differential-testing").repoKey, null);
    assert.equal(catalog.ovens.find((oven) => oven.id === "streaming-diff").dataInput, "producer-managed");

    const [first, second] = shared;
    const firstOven = await httpGet(baseUrl, `/api/ovens/shared?repoKey=${first.repoKey}`);
    const secondOven = await httpGet(baseUrl, `/api/ovens/shared?repoKey=${second.repoKey}`);
    assert.equal(firstOven.status, 200);
    assert.equal(secondOven.status, 200);
    const firstOvenPackage = JSON.parse(firstOven.body).oven;
    const secondOvenPackage = JSON.parse(secondOven.body).oven;
    assert.notEqual(firstOvenPackage.instructions, secondOvenPackage.instructions);
    assert.equal(firstOvenPackage.oven, starterOvenSource("shared", "Oven A"));
    assert.equal(typeof firstOvenPackage.ir, "object");
    assert.equal(Object.hasOwn(firstOvenPackage, "detail"), false);
    // Custom ovens never resolve without their own repository identity.
    const bare = await httpGet(baseUrl, "/api/ovens/shared");
    assert.equal(bare.status, 404);
    assert.equal((await httpGet(baseUrl, "/api/ovens/shared?repoKey=missing")).status, 404);

    const firstData = await httpGet(baseUrl, `/api/oven-data/shared?repoKey=${first.repoKey}`);
    const secondData = await httpGet(baseUrl, `/api/oven-data/shared?repoKey=${second.repoKey}`);
    assert.notEqual(JSON.parse(firstData.body).payload.source, JSON.parse(secondData.body).payload.source);

    const repos = JSON.parse((await httpGet(baseUrl, "/api/repos")).body).repos;
    const b = repos.find((repo) => repo.name === "b");
    const c = repos.find((repo) => repo.name === "c");
    assert.ok(b);
    assert.ok(c);
    const authored = await httpRequest(baseUrl, "/api/ovens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-burnlist-token": catalog.writeToken },
      body: JSON.stringify({
        id: "b-authored", name: "B Authored", instructions: "# B Authored\n\nB only.\n", repoKey: b.repoKey,
      }),
    });
    assert.equal(authored.status, 201);
    const authoredOven = JSON.parse(authored.body).oven;
    assert.equal(authoredOven.repoKey, b.repoKey);
    assert.match(authoredOven.oven, /<oven id="b-authored"/u);
    assert.equal(Object.hasOwn(authoredOven, "detail"), false);
    const authoredRevision = (await readFile(join(authoredOven.path, "current"), "utf8")).trim();
    assert.equal(
      await readFile(join(authoredOven.path, authoredRevision, "b-authored.oven"), "utf8"),
      authoredOven.oven,
    );
    assert.equal(existsSync(join(authoredOven.path, "detail.json")), false);
    assert.equal((await httpGet(baseUrl, `/api/ovens/b-authored?repoKey=${b.repoKey}`)).status, 200);
    const created = await httpRequest(baseUrl, "/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-burnlist-token": catalog.writeToken },
      body: JSON.stringify({ ovenId: "shared", ovenRepoKey: b.repoKey, repoRoot: b.root, title: "B run", objective: "Use B's Oven." }),
    });
    assert.equal(created.status, 201);
    const run = JSON.parse(created.body).run;
    assert.equal(run.repoRoot, b.root);
    const runDirectory = run.path;
    const snapshot = await readFile(`${runDirectory}/instructions.md`, "utf8");
    assert.match(snapshot, /Oven B/u);
    const wrongOvenRepo = await httpRequest(baseUrl, "/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-burnlist-token": catalog.writeToken },
      body: JSON.stringify({ ovenId: "shared", ovenRepoKey: c.repoKey, repoRoot: b.root, title: "Rejected run", objective: "Reject a missing Oven." }),
    });
    assert.equal(wrongOvenRepo.status, 400);
    assert.match(JSON.parse(wrongOvenRepo.body).error, /Unknown oven shared/u);
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
      assert.match(entry.href, new RegExp(`^/r/${entry.repoKey}/o/differential-testing\\?scenario=${entry.id}$`, "u"));
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
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body).ovens;
    const forkedKey = catalog.find((oven) => oven.id === "forked-oven").repoKey;
    const standaloneKey = catalog.find((oven) => oven.id === "standalone-oven").repoKey;
    const forked = JSON.parse((await httpGet(baseUrl, `/api/ovens/forked-oven?repoKey=${forkedKey}`)).body).oven;
    const standalone = JSON.parse((await httpGet(baseUrl, `/api/ovens/standalone-oven?repoKey=${standaloneKey}`)).body).oven;
    assert.deepEqual(forked.forkedFrom, forkedFrom);
    assert.equal(Object.hasOwn(standalone, "forkedFrom"), false);
  });
  await withServer({
    withBurnlist: true,
    ovens: [{ id: "broken-oven", ovenJson: "{", repoPath: "fixture-repo" }],
  }, async ({ baseUrl }) => {
    const brokenKey = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists
      .find((entry) => entry.ovenId === "checklist").repoKey;
    const response = await httpGet(baseUrl, "/api/ovens");
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).ovens.some((oven) => oven.id === "broken-oven"), false);
    const direct = await httpGet(baseUrl, `/api/ovens/broken-oven?repoKey=${brokenKey}`);
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
  }, async ({ baseUrl, repoRoot }) => {
    const direct = await httpGet(baseUrl, `/api/ovens/escaped-oven?repoKey=${repoKey(realpathSync(repoRoot))}`);
    assert.equal(direct.status, 400);
    assert.match(JSON.parse(direct.body).error, /escapes/u);
  });
});

test("--ovens-dir applies only to the launch repository custom Ovens", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [{ repoPath: "a" }, { repoPath: "b" }],
    scanRoots: ["a", "b"],
    launchCwd: "a",
    ovens: [{ id: "b-local", repoPath: "b" }],
    serverArgs: ["--ovens-dir", ".local/burnlist/launch-ovens"],
    setup: async ({ fixtureRoot }) => {
      const ovenRoot = join(fixtureRoot, "a", ".local", "burnlist", "launch-ovens", "a-override");
      await mkdir(ovenRoot, { recursive: true });
      await Promise.all([
        writeFile(join(ovenRoot, "instructions.md"), "# A Override\n\nLaunch only.\n"),
        writeFile(join(ovenRoot, "a-override.oven"), starterOvenSource("a-override", "A Override")),
      ]);
    },
  }, async ({ baseUrl }) => {
    const ovens = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body).ovens;
    assert.equal(ovens.some((oven) => oven.id === "a-override"), true);
    assert.equal(ovens.some((oven) => oven.id === "b-local"), true);
  });
});
