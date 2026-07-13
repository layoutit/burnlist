import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, get, request } from "node:http";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPayload } from "../../ovens/differential-testing/example/adapter.mjs";
import { normalizeOvenPackage, ovenRevision } from "../ovens/oven-contract.mjs";
import test from "node:test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(scriptDirectory, "burnlist-dashboard-server.mjs");

// Upstream serves the built dashboard app for shell routes and exposes read-only JSON APIs
// (/api/progress, /api/burnlists). These tests characterize the JSON data routes our PR-1
// discovery/selection changes touch (the server no longer renders a no-JS HTML fallback).

test("root serves the dashboard shell", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/");
    assert.equal(response.status, 200);
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
    assert.equal(payload.burnlists.some((entry) => entry.id === "fixture"), true);
  });
});

test("Oven data uses registered and generic handlers while unknown ids are unvalidated", { timeout: 20_000 }, async () => {
  const differentialTestingPayload = buildPayload(
    { captureId: "reference-fixture", generatedAt: "2026-01-01T12:00:00.000Z", fields: [], samples: [] },
    { captureId: "candidate-fixture", generatedAt: "2026-01-01T12:00:00.000Z", samples: [] },
  );
  await withServer({
    withBurnlist: true,
    ovenData: [
      { id: "checklist", payload: { source: "generic" } },
      { id: "differential-testing", payload: differentialTestingPayload },
    ],
  }, async ({ baseUrl }) => {
    const checklist = await httpGet(baseUrl, "/api/oven-data/checklist");
    assert.equal(checklist.status, 200);
    assert.deepEqual(JSON.parse(checklist.body).payload, { source: "generic" });

    // The empty fixture has no scenarios, so the base document is served (selectedScenarioId null).
    const differentialTesting = await httpGet(baseUrl, "/api/oven-data/differential-testing");
    assert.equal(differentialTesting.status, 200);
    assert.equal(JSON.parse(differentialTesting.body).scenarioId, null);

    const unknown = await httpGet(baseUrl, "/api/oven-data/not-an-oven");
    assert.equal(unknown.status, 404);
    assert.equal(JSON.parse(unknown.body).validated, false);

    const entries = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists;
    assert.equal(entries.some((entry) => entry.ovenId === "checklist"), true);
    // The empty DT payload publishes no scenarios, so its handler contributes no dashboard rows.
    assert.equal(entries.some((entry) => entry.ovenId === "differential-testing"), false);
  });
});

test("Oven discovery exposes optional lineage and rejects malformed sidecars", { timeout: 20_000 }, async () => {
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
    assert.equal(response.status, 400);
    assert.match(JSON.parse(response.body).error, /lineage sidecar is invalid/u);
  });
});

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
  await withServer({
    runs: [
      { id: legacyRunId, schemaVersion: 3, ovenId: "legacy-oven", instructions: legacyInstructions, detail: legacyDetail },
      { id: unsupportedRunId, schemaVersion: 99, ovenId: "legacy-oven", instructions: legacyInstructions, detail: legacyDetail },
    ],
  }, async ({ baseUrl, repoRoot }) => {
    const legacy = JSON.parse((await httpGet(baseUrl, `/api/runs/${legacyRunId}`)).body).run;
    assert.equal(legacy.schemaVersion, 3);
    assert.equal(legacy.ovenRevision, expectedLegacyRevision);
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
      body: JSON.stringify({ ovenId: "checklist", repoRoot, title: "Current run", objective: "Verify revision pinning." }),
    });
    assert.equal(created.status, 201);
    const current = JSON.parse(created.body).run;
    assert.equal(current.schemaVersion, 4);
    assert.match(current.ovenRevision, /^o1-sha256:[a-f0-9]{64}$/u);
    const reread = JSON.parse((await httpGet(baseUrl, `/api/runs/${current.id}`)).body).run;
    assert.equal(reread.ovenRevision, current.ovenRevision);
  });
});

async function withServer({ withBurnlist, burnlists, ovenData = [], ovens = [], runs = [], scanRoots }, callback) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "burnlist-dashboard-routes-"));
  const homeRoot = join(fixtureRoot, "home");
  const fixtures = burnlists ?? (withBurnlist ? [{}] : []);
  const planPaths = fixtures.map((fixture) => fixturePlanPath(fixtureRoot, fixture));
  const rootPaths = scanRoots ?? (fixtures.length
    ? fixtures.map((fixture) => fixture.repoPath ?? "fixture-repo")
    : ["fixture-repo"]);
  let child = null;
  try {
    await mkdir(homeRoot, { recursive: true });
    await Promise.all(fixtures.map(async (fixture, index) => {
      const planPath = planPaths[index];
      await mkdir(dirname(planPath), { recursive: true });
      await Promise.all([
        writeFile(planPath, burnlistMarkdown(fixture.title ?? "Fixture Burnlist")),
        writeFile(join(dirname(planPath), "goal.md"), "# Fixture Goal\n\n## Goal\n\nRoute behavior fixture.\n"),
      ]);
    }));
    await Promise.all(ovenData.map(({ id, payload }) => writeFile(
      join(fixtureRoot, `${id}.json`),
      JSON.stringify(payload),
    )));
    await Promise.all(ovens.map((oven) => writeOvenFixture(fixtureRoot, oven)));
    await Promise.all(runs.map((run) => writeRunFixture(fixtureRoot, run)));
    const port = await availablePort();
    const ovenDataBindings = ovenData.map(({ id }) => `${id}=${join(fixtureRoot, `${id}.json`)}`).join(",");
    child = spawn(process.execPath, [
      serverPath,
      "--port", String(port),
      "--auto-port",
      "--scan-root", rootPaths.map((path) => join(fixtureRoot, path)).join(","),
      "--state-dir", join(fixtureRoot, "state"),
      ...(ovenDataBindings ? ["--oven-data", ovenDataBindings] : []),
    ], {
      cwd: fixtureRoot,
      env: { ...process.env, HOME: homeRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const baseUrl = await waitForServer(child);
    // The server canonicalizes scan roots (macOS /var → /private/var), so hand back the realpath'd
    // repo root; POST /api/runs requires the repoRoot to match a canonical scan root.
    const rawRepoRoot = join(fixtureRoot, rootPaths[0]);
    const repoRoot = existsSync(rawRepoRoot) ? realpathSync(rawRepoRoot) : rawRepoRoot;
    return await callback({ baseUrl, planPath: planPaths[0], planPaths, repoRoot });
  } finally {
    await stopChild(child);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function fixturePlanPath(fixtureRoot, fixture) {
  return join(
    fixtureRoot,
    fixture.repoPath ?? "fixture-repo",
    "notes",
    "burnlists",
    fixture.lifecycle ?? "inprogress",
    fixture.id ?? "fixture",
    "burnlist.md",
  );
}

function burnlistMarkdown(title) {
  return [
    `# ${title}`,
    "",
    "## Active Checklist",
    "",
    "- [ ] ROUTE-01 | Keep root on the list",
    "  Files/search: dashboard",
    "  Action: Keep list and detail routes distinct.",
    "  Done/delete when: The route tests pass.",
    "  Validate: Run the route characterization tests.",
    "",
    "## Completed",
    "",
  ].join("\n");
}

function detailFixture() {
  return {
    version: 1,
    columns: 2,
    rows: 2,
    rowHeight: 48,
    cells: [{
      id: "summary",
      title: "Summary",
      description: "Current status.",
      widget: "metric",
      source: "/summary",
      format: "plain",
      column: 1,
      row: 1,
      columnSpan: 2,
      rowSpan: 1,
    }],
  };
}

async function writeOvenFixture(fixtureRoot, fixture) {
  const ovenRoot = join(fixtureRoot, ".local", "burnlist", "ovens", fixture.id);
  await mkdir(ovenRoot, { recursive: true });
  await Promise.all([
    writeFile(join(ovenRoot, "instructions.md"), fixture.instructions ?? "# Fixture Oven\n\nFollow the checklist.\n"),
    writeFile(join(ovenRoot, "detail.json"), JSON.stringify(fixture.detail ?? detailFixture())),
    ...(fixture.ovenJson === undefined
      ? []
      : [writeFile(join(ovenRoot, "oven.json"), typeof fixture.ovenJson === "string" ? fixture.ovenJson : JSON.stringify(fixture.ovenJson))]),
  ]);
}

async function writeRunFixture(fixtureRoot, fixture) {
  const repoRoot = join(fixtureRoot, fixture.repoPath ?? "fixture-repo");
  const runRoot = join(repoRoot, ".local", "burnlist", "runs", fixture.id);
  const createdAt = "2026-07-14T12:00:00.000Z";
  const record = {
    schemaVersion: fixture.schemaVersion,
    id: fixture.id,
    ovenId: fixture.ovenId,
    repoRoot,
    repo: "fixture-repo",
    title: "Fixture run",
    status: "requested",
    createdAt,
    updatedAt: createdAt,
    inputs: { objective: "Exercise run reads." },
    summary: {},
    sections: [],
    ...(fixture.ovenRevision ? { ovenRevision: fixture.ovenRevision } : {}),
  };
  // The repo must be discoverable (repoRoot() requires notes/burnlists) for readBurnRun to search it.
  await mkdir(join(repoRoot, "notes", "burnlists", "inprogress"), { recursive: true });
  await mkdir(runRoot, { recursive: true });
  await Promise.all([
    writeFile(join(runRoot, "run.json"), JSON.stringify(record)),
    writeFile(join(runRoot, "instructions.md"), fixture.instructions),
    writeFile(join(runRoot, "detail.json"), JSON.stringify(fixture.detail)),
  ]);
}

function httpGet(baseUrl, path) {
  return new Promise((resolveResponse, reject) => {
    const request = get(new URL(path, baseUrl), (response) => {
      const chunks = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveResponse({
        status: response.statusCode,
        body: chunks.join(""),
      }));
    });
    request.once("error", reject);
  });
}

function httpRequest(baseUrl, path, { method, headers, body }) {
  return new Promise((resolveResponse, reject) => {
    const req = request(new URL(path, baseUrl), { method, headers }, (response) => {
      const chunks = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveResponse({ status: response.statusCode, body: chunks.join("") }));
    });
    req.once("error", reject);
    req.end(body);
  });
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

function waitForServer(child) {
  return new Promise((resolveReady, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Dashboard test server did not start: ${output}`)), 8_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//u);
      if (!match) return;
      clearTimeout(timeout);
      resolveReady(match[0]);
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Dashboard test server exited with ${code}: ${output}`));
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
