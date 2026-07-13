import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, get } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { registerRoot } from "./registry.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(scriptDirectory, "burnlist-dashboard-server.mjs");

test("/api/projects includes registered empty and unregistered healthy projects", { timeout: 20_000 }, async () => {
  await withServer({ burnlists: [{ repoPath: ".", id: "active" }], scanRoots: ["."] }, async (fixture) => {
    const emptyRoot = join(fixture.root, "registered-empty");
    await mkdir(emptyRoot, { recursive: true });
    registerRoot(emptyRoot, { home: fixture.home });
    const response = await httpGet(fixture.baseUrl, "/api/projects");
    assert.equal(response.status, 200);
    const projects = JSON.parse(response.body).projects;
    const empty = projects.find((project) => project.canonicalRoot === emptyRoot);
    const healthy = projects.find((project) => project.canonicalRoot === fixture.root);
    assert.deepEqual(empty.entries, []);
    assert.equal(empty.registered, true);
    assert.equal(empty.health, "empty");
    assert.equal(healthy.registered, false);
    assert.equal(healthy.health, "healthy");
    assert.deepEqual(healthy.counts, { total: 1, active: 1 });
    assert.equal(healthy.entries[0].repoKey, healthy.repoKey);
    assert.ok(projects.indexOf(healthy) < projects.indexOf(empty));
  });
});

test("repo-key selection distinguishes same-name repositories", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [
      { repoPath: "a/app", id: "shared", title: "First app" },
      { repoPath: "b/app", id: "shared", title: "Second app" },
    ],
    scanRoots: ["a", "b"],
  }, async (fixture) => {
    const projectsResponse = await httpGet(fixture.baseUrl, "/api/projects");
    const projects = JSON.parse(projectsResponse.body).projects;
    const first = projects.find((project) => project.canonicalRoot === join(fixture.root, "a/app"));
    const second = projects.find((project) => project.canonicalRoot === join(fixture.root, "b/app"));
    assert.notEqual(first.repoKey, second.repoKey);

    const shell = await httpGet(fixture.baseUrl, `/r/${second.repoKey}/shared`);
    assert.equal(shell.status, 200);
    const keyed = await httpGet(fixture.baseUrl, `/api/progress?repoKey=${second.repoKey}&id=shared`);
    assert.equal(keyed.status, 200);
    assert.equal(JSON.parse(keyed.body).planPath, fixture.planPaths[1]);
    const ambiguous = await httpGet(fixture.baseUrl, "/api/progress?repo=app&id=shared");
    assert.equal(ambiguous.status, 409);
  });
});

test("/api/projects reports ids duplicated across lifecycle folders", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [
      { repoPath: "repo", id: "repeated", lifecycle: "draft" },
      { repoPath: "repo", id: "repeated", lifecycle: "completed" },
    ],
    scanRoots: ["repo"],
  }, async (fixture) => {
    const response = await httpGet(fixture.baseUrl, "/api/projects");
    assert.equal(response.status, 200);
    const [project] = JSON.parse(response.body).projects;
    assert.deepEqual(project.ambiguousIds, ["repeated"]);
  });
});

async function withServer({ burnlists, scanRoots }, callback) {
  const root = await mkdtemp(join(tmpdir(), "burnlist-projects-api-"));
  const home = join(root, "home");
  const fixtures = burnlists ?? [];
  const planPaths = fixtures.map((fixture) => fixturePlanPath(root, fixture));
  let child = null;
  try {
    await mkdir(home, { recursive: true });
    await Promise.all(fixtures.map(async (fixture, index) => {
      const planPath = planPaths[index];
      await mkdir(dirname(planPath), { recursive: true });
      await Promise.all([
        writeFile(planPath, burnlistMarkdown(fixture.title ?? "Fixture Burnlist")),
        writeFile(join(dirname(planPath), "goal.md"), "# Fixture Goal\n\n## Goal\n\nProject API fixture.\n"),
      ]);
    }));
    const port = await availablePort();
    child = spawn(process.execPath, [
      serverPath,
      "--port", String(port),
      "--auto-port",
      "--scan-root", scanRoots.map((path) => join(root, path)).join(","),
      "--state-dir", join(root, "state"),
    ], { cwd: root, env: { ...process.env, HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
    const baseUrl = await waitForServer(child);
    return await callback({ root: realpathSync(root), home, baseUrl, planPaths: planPaths.map((planPath) => realpathSync(planPath)) });
  } finally {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
}

function fixturePlanPath(root, fixture) {
  return join(root, fixture.repoPath, "notes", "burnlists", fixture.lifecycle ?? "inprogress", fixture.id, "burnlist.md");
}

function burnlistMarkdown(title) {
  return [
    `# ${title}`,
    "",
    "## Active Checklist",
    "",
    "- [ ] PROJECT-01 | Keep the project visible",
    "  Files/search: dashboard",
    "  Action: Group this fixture under its repository.",
    "  Done/delete when: The project API reports the fixture.",
    "  Validate: Run the project API tests.",
    "",
    "## Completed",
    "",
  ].join("\n");
}

function httpGet(baseUrl, path) {
  return new Promise((resolveResponse, reject) => {
    const request = get(new URL(path, baseUrl), (response) => {
      const chunks = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveResponse({ status: response.statusCode, body: chunks.join("") }));
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
