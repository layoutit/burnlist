import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  legacyOvenRevision,
  normalizeOvenDetail,
  normalizeOvenPackage,
  ovenRevision,
} from "../ovens/oven-contract.mjs";
import test from "node:test";
import { detailFixture, httpGet, httpRequest, withServer } from "./dashboard-routes-fixtures.mjs";
import {
  createProductionRunAuthority,
  fixtureItemRef,
  fixtureRunId,
  m4ProgressOutcomes,
  runM4ProgressFixture,
} from "../loops/run/run-test-fixtures.mjs";
import { createProductionRun } from "../loops/run/binder.mjs";
import { runStore } from "../loops/run/run-store.mjs";

test("selected progress remains independent from the sanitized read-only Loop projection", { timeout: 20_000 }, async () => {
  await withServer({ burnlists: [{ id: "260722-001", title: "Fixture M5" }], setup: async ({ fixtureRoot }) => {
    const repo = `${fixtureRoot}/fixture-repo`;
    createProductionRunAuthority(repo);
    await runM4ProgressFixture({
      repoRoot: repo,
      runId: fixtureRunId,
      itemRef: fixtureItemRef,
      outcomes: m4ProgressOutcomes,
    });
  } }, async ({ baseUrl, planPath }) => {
    const url = `/api/progress?plan=${encodeURIComponent(planPath)}`;
    const first = await httpGet(baseUrl, url), second = await httpGet(baseUrl, url);
    assert.equal(first.status, 200);
    assert.equal(JSON.parse(first.body).loopRun, null);
    assert.equal(JSON.parse(second.body).loopRun, null);
    const projection = await httpRequest(baseUrl, `/api/loop-projection?plan=${encodeURIComponent(planPath)}`, { method: "GET" });
    assert.equal(projection.status, 200);
    const left = JSON.parse(projection.body).loopRun;
    assert.deepEqual(Object.keys(left), ["schema", "runId", "itemRef", "loopId", "loopRevision", "createdAt", "updatedAt", "state", "currentNode", "attempt", "cycle", "latestResult", "latestMaker", "latestCheck", "latestReviewer", "revision", "budget", "graph", "transitions"]);
    assert.equal(left.loopId, "review");
    assert.equal(left.loopRevision, null, "generic fixture has no sealed Run authority");
    assert.equal(Number.isSafeInteger(left.createdAt), true);
    assert.equal(Number.isSafeInteger(left.updatedAt), true);
    assert.ok(left.updatedAt >= left.createdAt);
    assert.match(left.revision, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(left.budget.limits.maxRounds, 3);
    assert.equal(left.state, "converged");
    assert.equal(left.currentNode, "completed");
    assert.deepEqual(left.latestResult, { kind: "approve", summary: "approve" });
    for (const result of [left.latestMaker, left.latestCheck, left.latestReviewer]) {
      assert.equal(typeof result?.summary, "string");
      assert.equal(typeof result?.at, "number");
      assert.ok(result?.candidateId === null || /^cm1-sha256:/u.test(result?.candidateId));
    }
    assert.deepEqual(left.transitions.map(({ from, outcome, to }) => ({ from, outcome, to })), [
      { from: "prepared", outcome: "control", to: "running" },
      { from: "implement", outcome: "complete", to: "verify" },
      { from: "verify", outcome: "pass", to: "review" },
      { from: "review", outcome: "reject", to: "implement" },
      { from: "implement", outcome: "complete", to: "verify" },
      { from: "verify", outcome: "pass", to: "review" },
      { from: "review", outcome: "approve", to: "converged" },
      { from: "converged", outcome: "pass", to: "completed" },
    ]);
    const serialized = JSON.stringify(left);
    for (const forbidden of ["invocationId", "lease", "prompt", "route", "authority"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "u"));
    assert.equal((await httpRequest(baseUrl, url, { method: "POST" })).status, 405);
    const etag = projection.headers.etag;
    assert.match(etag, /^W\/"loop-[a-f0-9]{64}"$/u);
    const unchanged = await httpRequest(baseUrl, `/api/loop-projection?plan=${encodeURIComponent(planPath)}`, { method: "GET", headers: { "if-none-match": etag } });
    assert.equal(unchanged.status, 304);
  });
});

test("unassigned selected progress stays unchanged and Run discovery does not create state", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl, planPath, repoRoot }) => {
    const response = await httpGet(baseUrl, `/api/progress?plan=${encodeURIComponent(planPath)}`);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).loopRun, null);
    assert.equal(existsSync(`${repoRoot}/.local/burnlist/loop/m2/runs`), false);
  });
});

test("loop projection is a bounded byte-stable conditional read", { timeout: 20_000 }, async () => {
  await withServer({ burnlists: [{ id: "260722-001", title: "Loop route" }], setup: async ({ fixtureRoot }) => {
    const repo = `${fixtureRoot}/fixture-repo`;
    createProductionRunAuthority(repo);
    await runM4ProgressFixture({ repoRoot: repo, runId: fixtureRunId, itemRef: fixtureItemRef, outcomes: m4ProgressOutcomes });
  } }, async ({ baseUrl, planPath }) => {
    const path = `/api/loop-projection?plan=${encodeURIComponent(planPath)}`;
    const first = await httpRequest(baseUrl, path, { method: "GET" });
    const second = await httpRequest(baseUrl, path, { method: "GET" });
    assert.equal(first.status, 200);
    assert.equal(first.body, second.body, "canonical projection serialization is byte-stable");
    assert.equal(first.headers.etag, second.headers.etag);
    assert.equal(first.headers.etag, `W/"loop-${createHash("sha256").update(first.body).digest("hex")}"`);
    assert.equal(Number(first.headers["content-length"]), Buffer.byteLength(first.body));
    assert.ok(Buffer.byteLength(first.body) <= 65_536, "sanitized loop response remains bounded");
    assert.deepEqual(Object.keys(JSON.parse(first.body)), ["loopRun"]);
    const unchanged = await httpRequest(baseUrl, path, { method: "GET", headers: { "if-none-match": first.headers.etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.body, "");
    assert.equal((await httpRequest(baseUrl, path, { method: "POST" })).status, 405);
  });
});

test("loop projection distinguishes missing state from corrupt run storage", { timeout: 40_000 }, async () => {
  const missing = async ({ fixtureRoot }) => { createProductionRunAuthority(`${fixtureRoot}/fixture-repo`); };
  const corrupt = async ({ fixtureRoot }) => {
    const repo = `${fixtureRoot}/fixture-repo`;
    createProductionRunAuthority(repo);
    mkdirSync(`${repo}/.local/burnlist/loop/m2/runs/not-a-run`, { recursive: true });
  };
  for (const [setup, expectedStatus] of [[missing, 200], [corrupt, 409]]) {
    await withServer({ burnlists: [{ id: "260722-001", title: "Loop route" }], setup }, async ({ baseUrl, planPath }) => {
      const progress = await httpRequest(baseUrl, `/api/progress?plan=${encodeURIComponent(planPath)}`, { method: "GET" });
      assert.equal(progress.status, 200, "progress remains usable when Loop storage is corrupt");
      const response = await httpRequest(baseUrl, `/api/loop-projection?plan=${encodeURIComponent(planPath)}`, { method: "GET" });
      assert.equal(response.status, expectedStatus);
      if (expectedStatus === 200) assert.equal(JSON.parse(response.body).loopRun, null);
      else assert.equal(JSON.parse(response.body).error, "Loop projection is unavailable; retaining the last verified projection.");
    });
  }
});

test("sealed production authority corruption returns the dedicated projection conflict while progress stays healthy", { timeout: 60_000 }, async () => {
  for (const mutation of ["missing", "malformed"]) {
    await withServer({ burnlists: [{ id: "260722-001", title: `Loop authority ${mutation}` }], setup: async ({ fixtureRoot }) => {
      const repo = `${fixtureRoot}/fixture-repo`;
      createProductionRunAuthority(repo);
      const store = runStore(repo);
      await createProductionRun({ repoRoot: repo, store, itemRef: fixtureItemRef, runId: fixtureRunId });
      const authorityPath = store.paths.authorityPath(fixtureRunId);
      if (mutation === "missing") rmSync(authorityPath);
      else writeFileSync(authorityPath, "{not-json\n");
    } }, async ({ baseUrl, planPath }) => {
      const progress = await httpRequest(baseUrl, `/api/progress?plan=${encodeURIComponent(planPath)}`, { method: "GET" });
      assert.equal(progress.status, 200, `progress remains usable with ${mutation} sealed authority`);
      assert.equal(JSON.parse(progress.body).loopRun, null);
      const projection = await httpRequest(baseUrl, `/api/loop-projection?plan=${encodeURIComponent(planPath)}`, { method: "GET" });
      assert.equal(projection.status, 409, `${mutation} sealed authority is projection corruption`);
      assert.deepEqual(JSON.parse(projection.body), { error: "Loop projection is unavailable; retaining the last verified projection." });
    });
  }
});
test("Burn runs read legacy v3/v4 revisions and write/read v5 revisions", { timeout: 20_000 }, async () => {
  const legacyInstructions = "# Legacy Oven\n\nFollow the checklist.\n";
  const legacyDetail = detailFixture();
  const expectedLegacyRevision = legacyOvenRevision({
    instructions: legacyInstructions,
    detail: normalizeOvenDetail(legacyDetail),
  });
  const legacyRunId = "20260714-120000-a1b2c3";
  const unsupportedRunId = "20260714-120001-a1b2c4";
  const matchingV4RunId = "20260714-120002-a1b2c5";
  const mismatchedV4RunId = "20260714-120003-a1b2c6";
  await withServer({
    runs: [
      { id: legacyRunId, schemaVersion: 3, ovenId: "legacy-oven", instructions: legacyInstructions, detail: legacyDetail },
      { id: unsupportedRunId, schemaVersion: 99, ovenId: "legacy-oven", instructions: legacyInstructions, detail: legacyDetail },
      { id: matchingV4RunId, schemaVersion: 4, ovenId: "legacy-oven", instructions: legacyInstructions, detail: legacyDetail, ovenRevision: expectedLegacyRevision },
      { id: mismatchedV4RunId, schemaVersion: 4, ovenId: "legacy-oven", instructions: legacyInstructions, detail: legacyDetail, ovenRevision: `o1-sha256:${"f".repeat(64)}` },
    ],
  }, async ({ baseUrl, repoRoot }) => {
    const legacy = JSON.parse((await httpGet(baseUrl, `/api/runs/${legacyRunId}`)).body).run;
    assert.equal(legacy.schemaVersion, 3);
    assert.equal(legacy.ovenRevision, expectedLegacyRevision);
    const matchingV4 = await httpGet(baseUrl, `/api/runs/${matchingV4RunId}`);
    assert.equal(matchingV4.status, 200);
    assert.equal(JSON.parse(matchingV4.body).run.ovenRevision, expectedLegacyRevision);
    const mismatchedV4 = await httpGet(baseUrl, `/api/runs/${mismatchedV4RunId}`);
    assert.equal(mismatchedV4.status, 400);
    assert.match(JSON.parse(mismatchedV4.body).error, /revision does not match its snapshot/u);
    const unsupported = await httpGet(baseUrl, `/api/runs/${unsupportedRunId}`);
    assert.equal(unsupported.status, 400);
    assert.match(JSON.parse(unsupported.body).error, /schemaVersion must be 3, 4, or 5/u);

    const ovens = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const created = await httpRequest(baseUrl, "/api/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-burnlist-token": ovens.writeToken,
      },
      body: JSON.stringify({ ovenId: "checklist", repoRoot, title: "Current run", objective: "Verify revision pinning." }),
    });
    assert.equal(created.status, 201);
    const current = JSON.parse(created.body).run;
    assert.equal(current.schemaVersion, 5);
    assert.equal(current.ovenRepoKey, null);
    assert.match(current.ovenRevision, /^o1-sha256:[a-f0-9]{64}$/u);
    const instructionsSnapshot = await readFile(`${current.path}/instructions.md`, "utf8");
    const sourceSnapshot = await readFile(`${current.path}/checklist.oven`, "utf8");
    assert.equal(existsSync(`${current.path}/detail.json`), false);
    assert.equal(current.ovenRevision, ovenRevision(normalizeOvenPackage({
      id: "checklist",
      instructions: instructionsSnapshot,
      oven: sourceSnapshot,
    })));
    const reread = JSON.parse((await httpGet(baseUrl, `/api/runs/${current.id}`)).body).run;
    assert.equal(reread.ovenRevision, current.ovenRevision);
  });
});

test("Burn runs read max-size normalized v4 Oven snapshots", { timeout: 20_000 }, async () => {
  const maxText = (length) => "\u0800".repeat(length);
  const instructions = `# ${maxText(65534)}`;
  const detail = {
    version: 1, columns: 24, rows: 32, rowHeight: 120,
    cells: Array.from({ length: 32 }, (_, index) => ({
      id: `section-${String(index).padStart(2, "0")}-${"a".repeat(37)}`,
      title: maxText(80), description: maxText(2000), widget: "comparison",
      source: `/${maxText(159)}`, format: "timestamp",
      column: (index % 24) + 1, row: Math.floor(index / 24) + 1, columnSpan: 1, rowSpan: 1,
    })),
  };
  const normalizedDetail = normalizeOvenDetail(detail);
  const instructionsSnapshot = `${instructions}\n`;
  const detailSnapshot = `${JSON.stringify(normalizedDetail, null, 2)}\n`;
  assert.ok(Buffer.byteLength(instructionsSnapshot) > 65536);
  assert.ok(Buffer.byteLength(detailSnapshot) > 131072);
  assert.ok(Buffer.byteLength(instructionsSnapshot) <= 262144);
  assert.ok(Buffer.byteLength(detailSnapshot) <= 393216);
  const id = "20260714-120004-a1b2c7";
  await withServer({
    runs: [{
      id, schemaVersion: 4, ovenId: "max-size-oven", instructions, detail: normalizedDetail,
      ovenRevision: legacyOvenRevision({ instructions: instructionsSnapshot, detail: normalizedDetail }),
      instructionsSnapshot, detailSnapshot,
    }],
  }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, `/api/runs/${id}`);
    assert.equal(response.status, 200);
    assert.equal(
      JSON.parse(response.body).run.ovenRevision,
      legacyOvenRevision({ instructions: instructionsSnapshot, detail: normalizedDetail }),
    );
  });
});
