import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, get } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(scriptDirectory, "burnlist-dashboard-server.mjs");
const dashboardDirectory = resolve(scriptDirectory, "../dashboard");

// Upstream serves the built dashboard app for shell routes and exposes read-only JSON APIs
// (/api/progress, /api/burnlists). These tests characterize the JSON data routes our PR-1
// discovery/selection changes touch (the server no longer renders a no-JS HTML fallback).

test("root serves the dashboard shell", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    const response = await httpGet(baseUrl, "/");
    assert.equal(response.status, 200);
  });
});

test("checklist detail reuses the Differential Testing visual shell", async () => {
  const [component, app, styles] = await Promise.all([
    readFile(resolve(dashboardDirectory, "src/checklist-dashboard.tsx"), "utf8"),
    readFile(resolve(dashboardDirectory, "src/app.tsx"), "utf8"),
    readFile(resolve(dashboardDirectory, "src/index.css"), "utf8"),
  ]);
  assert.match(component, /className="driving-parity-kpi-strip has-burns checklist-kpi-strip"/u);
  assert.ok(component.includes("className={`shell detail-view-shell driving-parity-view checklist-detail-shell"));
  assert.match(component, /className="detail-view" id="burnlist-detail"/u);
  assert.match(component, /className="work-panel-title">Progress<\/div>/u);
  assert.doesNotMatch(component, /<h2>Progress<\/h2>/u);
  assert.match(component, /clientHeight/u);
  assert.match(component, /data-plot-bottom=/u);
  assert.match(component, /className="axis-label y-axis-label" dominantBaseline="central" textAnchor="end" x=\{chart\.width - 4\}/u);
  assert.match(component, /document\.body\.classList\.add\("driving-parity-view", "checklist-detail-view"\)/u);
  assert.ok(app.includes("title && <div className=\"dashboard-oven-title\">{title}</div>"));
  assert.match(app, /className="dashboard-detail-time"/u);
  assert.match(styles, /Checklist detail — reuse the Differential Testing visual system\./u);
  assert.match(styles, /\.checklist-detail-shell \.detail-repo-graph-panel/u);
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

test("/api/progress numbers completed history in timestamp order", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [{
      completed: [
        "- B3 | 2026-07-13T20:15:00-03:00 | Third completion",
        "- B2 | 2026-07-13T20:10:00-03:00 | Second completion",
        "- B1 | 2026-07-13T20:05:00-03:00 | First completion",
      ],
    }],
  }, async ({ baseUrl, planPath }) => {
    const response = await httpGet(baseUrl, `/api/progress?plan=${encodeURIComponent(planPath)}`);
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.deepEqual(payload.history.slice(0, -1).map((point) => point.done), [1, 2, 3]);
    assert.deepEqual(payload.history.slice(0, -1).map((point) => point.remaining), [3, 2, 1]);
    assert.deepEqual(payload.completed.map((item) => item.id), ["B3", "B2", "B1"]);
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

async function withServer({ withBurnlist, burnlists, scanRoots }, callback) {
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
        writeFile(planPath, burnlistMarkdown(fixture.title ?? "Fixture Burnlist", fixture.completed)),
        writeFile(join(dirname(planPath), "goal.md"), "# Fixture Goal\n\n## Goal\n\nRoute behavior fixture.\n"),
      ]);
    }));
    const port = await availablePort();
    child = spawn(process.execPath, [
      serverPath,
      "--port", String(port),
      "--auto-port",
      "--scan-root", rootPaths.map((path) => join(fixtureRoot, path)).join(","),
      "--state-dir", join(fixtureRoot, "state"),
    ], {
      cwd: fixtureRoot,
      env: { ...process.env, HOME: homeRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const baseUrl = await waitForServer(child);
    return await callback({ baseUrl, planPath: planPaths[0], planPaths });
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

function burnlistMarkdown(title, completed = []) {
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
    ...completed,
    "",
  ].join("\n");
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
