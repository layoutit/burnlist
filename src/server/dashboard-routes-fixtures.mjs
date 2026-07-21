import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createServer, get, request } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { starterOvenSource } from "../ovens/oven-starter.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(scriptDirectory, "burnlist-dashboard-server.mjs");
async function withServer({
  withBurnlist, burnlists, ovenData = [], ovens = [], runs = [], scanRoots,
  launchCwd = ".", ovensRoot = ".", setup, serverArgs = [],
}, callback) {
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
    const writtenOvenData = await Promise.all(ovenData.map(async (entry, index) => {
      const path = join(fixtureRoot, entry.repoPath ?? "", entry.fileName ?? `${entry.id}-${index}.json`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(entry.payload));
      return { ...entry, path };
    }));
    const persistedBindings = new Map();
    for (const entry of writtenOvenData.filter((candidate) => candidate.persisted)) {
      const repoRoot = join(fixtureRoot, entry.repoPath);
      const bindings = persistedBindings.get(repoRoot) ?? {};
      bindings[entry.id] = { path: relative(repoRoot, entry.path), boundAt: "2026-07-14T12:00:00.000Z" };
      persistedBindings.set(repoRoot, bindings);
    }
    await Promise.all([...persistedBindings].map(async ([repoRoot, bindings]) => {
      const storePath = join(repoRoot, ".local", "burnlist", "bindings.json");
      await mkdir(dirname(storePath), { recursive: true });
      await writeFile(storePath, JSON.stringify({ schemaVersion: 1, bindings }));
    }));
    if (setup) await setup({ fixtureRoot, homeRoot });
    await Promise.all(ovens.map((oven) => writeOvenFixture(join(fixtureRoot, oven.repoPath ?? ovensRoot), oven)));
    await Promise.all(runs.map((run) => writeRunFixture(fixtureRoot, run)));
    await mkdir(join(fixtureRoot, launchCwd), { recursive: true });
    const port = await availablePort();
    const ovenDataBindings = writtenOvenData
      .filter((entry) => entry.override !== false)
      .map((entry) => `${entry.id}=${entry.path}`).join(",");
    child = spawn(process.execPath, [
      serverPath,
      "--port", String(port),
      "--auto-port",
      "--scan-root", rootPaths.map((path) => join(fixtureRoot, path)).join(","),
      "--state-dir", join(fixtureRoot, "state"),
      ...(ovenDataBindings ? ["--oven-data", ovenDataBindings] : []),
      ...serverArgs,
    ], {
      cwd: join(fixtureRoot, launchCwd),
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

async function writeOvenFixture(root, fixture) {
  const ovenRoot = join(root, ".local", "burnlist", "ovens", fixture.id);
  const instructions = fixture.instructions ?? "# Fixture Oven\n\nFollow the checklist.\n";
  const heading = instructions.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line.trim()));
  const name = heading ? heading.trim().replace(/^#\s+/u, "").trim() : fixture.id;
  const oven = fixture.oven ?? starterOvenSource(fixture.id, name);
  await mkdir(ovenRoot, { recursive: true });
  await Promise.all([
    writeFile(join(ovenRoot, "instructions.md"), instructions),
    writeFile(join(ovenRoot, `${fixture.id}.oven`), oven),
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
    writeFile(join(runRoot, "instructions.md"), fixture.instructionsSnapshot ?? fixture.instructions),
    writeFile(join(runRoot, "detail.json"), fixture.detailSnapshot ?? JSON.stringify(fixture.detail)),
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

export { detailFixture, httpGet, httpRequest, withServer };
