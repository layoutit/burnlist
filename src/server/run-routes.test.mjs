import assert from "node:assert/strict";
import { normalizeOvenPackage, ovenRevision } from "../ovens/oven-contract.mjs";
import test from "node:test";
import { detailFixture, httpGet, httpRequest, withServer } from "./dashboard-routes-fixtures.mjs";
test("Burn runs read legacy v3 revisions and write/read v4 revisions", { timeout: 20_000 }, async () => {
  const legacyInstructions = "# Legacy Oven\n\nFollow the checklist.\n";
  const legacyDetail = detailFixture();
  const expectedLegacyRevision = ovenRevision(normalizeOvenPackage({
    id: "legacy-oven",
    instructions: legacyInstructions,
    detail: legacyDetail,
  }));
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
    assert.match(JSON.parse(unsupported.body).error, /schemaVersion must be 3 or 4/u);

    const ovens = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const created = await httpRequest(baseUrl, "/api/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-burnlist-token": ovens.writeToken,
      },
      body: JSON.stringify({ ovenId: "checklist", ovenRepoKey: null, repoRoot, title: "Current run", objective: "Verify revision pinning." }),
    });
    assert.equal(created.status, 201);
    const current = JSON.parse(created.body).run;
    assert.equal(current.schemaVersion, 4);
    assert.equal(current.ovenRepoKey, null);
    assert.match(current.ovenRevision, /^o1-sha256:[a-f0-9]{64}$/u);
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
  const oven = normalizeOvenPackage({ id: "max-size-oven", instructions, detail });
  const instructionsSnapshot = `${oven.instructions}\n`;
  const detailSnapshot = `${JSON.stringify(oven.detail, null, 2)}\n`;
  assert.ok(Buffer.byteLength(instructionsSnapshot) > 65536);
  assert.ok(Buffer.byteLength(detailSnapshot) > 131072);
  assert.ok(Buffer.byteLength(instructionsSnapshot) <= 262144);
  assert.ok(Buffer.byteLength(detailSnapshot) <= 393216);
  const id = "20260714-120004-a1b2c7";
  await withServer({
    runs: [{
      id, schemaVersion: 4, ovenId: oven.id, instructions: oven.instructions, detail: oven.detail,
      ovenRevision: ovenRevision(oven), instructionsSnapshot, detailSnapshot,
    }],
  }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, `/api/runs/${id}`);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).run.ovenRevision, ovenRevision(oven));
  });
});
