import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPayload } from "../examples/differential-testing/adapter.mjs";
import {
  DIFFERENTIAL_TESTING_BUNDLE_SCHEMA,
  DIFFERENTIAL_TESTING_FIELD_RECORD_SCHEMA,
  DIFFERENTIAL_TESTING_PAGE_SCHEMA,
  DIFFERENTIAL_TESTING_SCENARIO_SCHEMA,
} from "./differential-testing-transport.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(scriptDirectory, "burnlist-dashboard-server.mjs");

test("the Differential Testing data route serves bounded bundle pages with stable ETags", { timeout: 20_000 }, async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "burnlist-differential-transport-server-"));
  let child = null;
  try {
    const fixture = await publishBundle(fixtureRoot);
    const port = await availablePort();
    child = spawn(process.execPath, [
      serverPath,
      "--port", String(port),
      "--scan-root", fixtureRoot,
      "--state-dir", join(fixtureRoot, "state"),
      "--oven-data", `differential-testing=${fixture.currentPath}`,
    ], {
      cwd: fixtureRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const baseUrl = `http://127.0.0.1:${port}/`;
    await waitForServer(child, baseUrl);

    const endpoint = `${baseUrl}api/oven-data/differential-testing`;
    const currentResponse = await fetch(endpoint, { cache: "no-store" });
    assert.equal(currentResponse.status, 200);
    const currentEtag = currentResponse.headers.get("etag");
    assert.match(currentEtag, /^W\/"dtb-[a-f0-9]{64}"$/u);
    const current = await currentResponse.json();
    assert.equal(current.scenarioId, fixture.scenarioId);
    assert.equal(current.transport.schema, DIFFERENTIAL_TESTING_PAGE_SCHEMA);
    assert.equal(current.transport.bundleSha256, fixture.bundleSha256);
    assert.equal(current.transport.scenarioSha256, fixture.scenarioSha256);
    assert.equal(Object.hasOwn(current.payload, "fields"), false);
    assert.equal(current.payload.scenarioCatalog.selectedScenarioId, fixture.scenarioId);
    assert.deepEqual(current.frameDeltaMetrics, {
      frameDeviationRatios: [0, 0, 0.5],
      firstFailingFrame: 2,
    });
    assert.deepEqual(
      {
        search: current.fieldPage.search,
        filter: current.fieldPage.filter,
        sort: current.fieldPage.sort,
        page: current.fieldPage.page,
        pageSize: current.fieldPage.pageSize,
        pageCount: current.fieldPage.pageCount,
        total: current.fieldPage.total,
      },
      { search: "", filter: "all", sort: "default", page: 0, pageSize: 25, pageCount: 1, total: 2 },
    );
    assert.deepEqual(current.fieldPage.fields.map((field) => field.id), ["position", "active"]);
    assert.deepEqual(current.fieldPage.telemetryFields, []);

    const unchangedResponse = await fetch(endpoint, { headers: { "If-None-Match": currentEtag } });
    assert.equal(unchangedResponse.status, 304);
    assert.equal(await unchangedResponse.text(), "");

    const explicitResponse = await fetch(`${endpoint}?scenario=${fixture.scenarioId}`);
    assert.equal(explicitResponse.status, 200);
    assert.equal(explicitResponse.headers.get("etag"), currentEtag);

    const filteredResponse = await fetch(`${endpoint}?scenario=${fixture.scenarioId}&search=position&filter=failing&sort=default&page=0&pageSize=25`);
    assert.equal(filteredResponse.status, 200);
    assert.notEqual(filteredResponse.headers.get("etag"), currentEtag);
    const filtered = await filteredResponse.json();
    assert.deepEqual(filtered.fieldPage.fields.map((field) => field.id), ["position"]);
    assert.equal(filtered.fieldPage.total, 1);
    assert.equal(filtered.fieldPage.search, "position");
    assert.equal(filtered.fieldPage.filter, "failing");

    const changedResponse = await fetch(`${endpoint}?sort=changed&pageSize=25`);
    assert.equal(changedResponse.status, 200);
    const changed = await changedResponse.json();
    assert.equal(changed.fieldPage.total, 0);
    assert.deepEqual(changed.fieldPage.fields, []);
    assert.deepEqual(changed.fieldPage.telemetryFields, []);

    const normalizedPageResponse = await fetch(`${endpoint}?page=999`);
    assert.equal(normalizedPageResponse.status, 200);
    assert.equal(normalizedPageResponse.headers.get("etag"), currentEtag);
    assert.equal((await normalizedPageResponse.json()).fieldPage.page, 0);

    for (const query of [
      "search=one&search=two",
      "filter=unknown",
      "sort=unknown",
      "page=-1",
      "page=1.5",
      "pageSize=26",
      `search=${"x".repeat(201)}`,
    ]) {
      const response = await fetch(`${endpoint}?${query}`);
      assert.equal(response.status, 400, query);
    }
    assert.equal((await fetch(`${endpoint}?scenario=..%2F..%2Fetc%2Fpasswd`)).status, 400);
    assert.equal((await fetch(`${endpoint}?scenario=aaaaaaaaaaaaaaaa`)).status, 404);

    const emptyBundleSha256 = await publishEmptyBundle(fixture.currentPath);
    const emptyResponse = await fetch(endpoint, { headers: { "If-None-Match": currentEtag } });
    assert.equal(emptyResponse.status, 200);
    assert.equal(emptyResponse.headers.get("etag"), `W/"dtb-${emptyBundleSha256}"`);
    const empty = await emptyResponse.json();
    assert.equal(empty.scenarioId, null);
    assert.deepEqual(empty.payload.scenarioCatalog, { selectedScenarioId: null, scenarios: [] });
    assert.deepEqual(empty.transport, {
      schema: DIFFERENTIAL_TESTING_PAGE_SCHEMA,
      bundleSha256: emptyBundleSha256,
      scenarioSha256: null,
    });
    assert.equal(empty.fieldPage, null);
    assert.equal(empty.frameDeltaMetrics, null);
    assert.equal((await fetch(`${endpoint}?scenario=${fixture.scenarioId}`)).status, 404);
  } finally {
    await stopChild(child);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function publishBundle(root) {
  const payload = buildPayload(...populatedCaptures());
  const scenarioId = payload.scenarioCatalog.selectedScenarioId;
  const scenarioDirectory = join(root, "bundle", "scenarios", scenarioId);
  await mkdir(scenarioDirectory, { recursive: true });

  const indexed = payload.fields
    .map((field, ordinal) => ({ field, ordinal }))
    .sort((left, right) => left.field.id.localeCompare(right.field.id));
  const recordChunks = [];
  const fieldIndex = [];
  let offset = 0;
  for (const { field, ordinal } of indexed) {
    const record = {
      schema: DIFFERENTIAL_TESTING_FIELD_RECORD_SCHEMA,
      scenarioId,
      id: field.id,
      ordinal,
      field,
      telemetry: null,
    };
    const recordBytes = Buffer.from(JSON.stringify(record));
    const { samples: _samples, ...fieldProjection } = field;
    fieldIndex.push({
      id: field.id,
      ordinal,
      field: fieldProjection,
      telemetry: null,
      record: { offset, size: recordBytes.length, sha256: sha256(recordBytes) },
    });
    recordChunks.push(recordBytes, Buffer.from("\n"));
    offset += recordBytes.length + 1;
  }
  const recordsBytes = Buffer.concat(recordChunks);
  await writeFile(join(scenarioDirectory, "fields.ndjson"), recordsBytes);

  const compact = structuredClone(payload);
  delete compact.fields;
  const ticks = payload.fields[0].samples.map((sample) => sample[0]);
  const frameDelta = {
    ticks,
    activeCounts: ticks.map((_tick, index) => payload.fields.filter((field) => field.samples[index][3] !== 4).length),
    nonPassCounts: ticks.map((_tick, index) => payload.fields.filter((field) => ![0, 4].includes(field.samples[index][3])).length),
  };
  const scenario = {
    schema: DIFFERENTIAL_TESTING_SCENARIO_SCHEMA,
    scenarioId,
    data: compact,
    frameDelta,
    fieldIndex,
    records: {
      path: "fields.ndjson",
      size: recordsBytes.length,
      sha256: sha256(recordsBytes),
      count: fieldIndex.length,
    },
  };
  const scenarioBytes = Buffer.from(`${JSON.stringify(scenario)}\n`);
  await writeFile(join(scenarioDirectory, "scenario.json"), scenarioBytes);

  const manifest = {
    schema: DIFFERENTIAL_TESTING_BUNDLE_SCHEMA,
    publishedAt: payload.publishedAt,
    scenarioCatalog: payload.scenarioCatalog,
    scenarioBindings: [{
      scenarioId,
      path: `scenarios/${scenarioId}/scenario.json`,
      size: scenarioBytes.length,
      sha256: sha256(scenarioBytes),
    }],
    emptyData: null,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const currentPath = join(root, "bundle", "current.json");
  await writeFile(currentPath, manifestBytes);
  return {
    bundleSha256: sha256(manifestBytes),
    currentPath,
    scenarioId,
    scenarioSha256: sha256(scenarioBytes),
  };
}

async function publishEmptyBundle(currentPath) {
  const generatedAt = "2026-01-01T12:01:00.000Z";
  const payload = buildPayload(
    { captureId: "empty-reference", generatedAt, fields: [], samples: [] },
    { captureId: "empty-candidate", generatedAt, samples: [] },
  );
  const manifest = {
    schema: DIFFERENTIAL_TESTING_BUNDLE_SCHEMA,
    publishedAt: payload.publishedAt,
    scenarioCatalog: payload.scenarioCatalog,
    scenarioBindings: [],
    emptyData: payload,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  await writeFile(currentPath, manifestBytes);
  return sha256(manifestBytes);
}

function populatedCaptures() {
  return [
    {
      captureId: "reference-fixture",
      generatedAt: "2026-01-01T12:00:00.000Z",
      fields: [
        { id: "position", label: "Position", sourceOwner: "engine/state", meaning: "One-dimensional position after the update", unit: "units", tolerance: 0.01 },
        { id: "active", label: "Active", sourceOwner: "engine/state", meaning: "Whether the object is active after the update", unit: null, tolerance: 0 },
      ],
      samples: [
        { tick: 0, values: { position: 0, active: false } },
        { tick: 1, values: { position: 1, active: true } },
        { tick: 2, values: { position: 2, active: true } },
      ],
    },
    {
      captureId: "candidate-fixture",
      generatedAt: "2026-01-01T12:00:00.000Z",
      samples: [
        { tick: 0, values: { position: 0, active: false } },
        { tick: 1, values: { position: 1.005, active: true } },
        { tick: 2, values: { position: 2.1, active: true } },
      ],
    },
  ];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not reserve a test port."));
        else resolvePort(port);
      });
    });
  });
}

function waitForServer(child, expectedUrl) {
  return new Promise((resolveReady, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start.\n${stdout}\n${stderr}`)), 8_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!stdout.includes(expectedUrl)) return;
      clearTimeout(timeout);
      resolveReady();
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with ${code}.\n${stdout}\n${stderr}`));
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timeout = setTimeout(resolveExit, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}
