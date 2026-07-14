import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { layoutRepoGraph } from "../dashboard/repo-graph-layout.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(scriptDirectory, "burnlist-dashboard-server.mjs");

test("repo graph uses a deterministic force layout with real links and folder halos", () => {
  const files = [
    ["src/app.mjs", 800],
    ["src/geddon/client.mjs", 1_800],
    ["src/geddon/scene/world.mjs", 3_200],
    ["src/geddon/scene/camera.mjs", 1_200],
    ["src/geddon/map/cells.mjs", 2_400],
    ["src/prepare/scene.mjs", 4_800],
    ["src/prepare/assets.mjs", 2_100],
    ["src/assets/types.ts", 900],
  ].map(([path, size], index) => ({ path, size, dirty: index < 2, active: index === 0, recentlyEdited: false, status: index < 2 ? "M" : "" }));
  const edges = [
    ["src/app.mjs", "src/geddon/client.mjs"],
    ["src/geddon/client.mjs", "src/geddon/scene/world.mjs"],
    ["src/geddon/client.mjs", "src/geddon/scene/camera.mjs"],
    ["src/geddon/scene/world.mjs", "src/geddon/map/cells.mjs"],
    ["src/prepare/scene.mjs", "src/prepare/assets.mjs"],
  ].map(([source, target]) => ({ source, target, type: "import" }));
  const first = layoutRepoGraph(files, edges, "src");
  const second = layoutRepoGraph(files, edges, "src");
  const positions = (layout) => layout.nodes.map(({ path, x, y }) => ({ path, x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) }));
  assert.deepEqual(positions(first), positions(second));
  assert.equal(first.nodes.length, files.length);
  assert.equal(first.edges.length, edges.length);
  assert.ok(first.groups.length >= 3);
  assert.ok(new Set(first.nodes.map((node) => Math.round(node.y))).size > 4, "nodes should not collapse into grid rows");
  for (const node of first.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x >= 0 && node.x <= 1000);
    assert.ok(node.y >= 0 && node.y <= 500);
  }
  for (const group of first.groups) assert.ok(group.r > 0 && group.label.endsWith("/"));
  for (let leftIndex = 0; leftIndex < first.groups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < first.groups.length; rightIndex += 1) {
      const left = first.groups[leftIndex];
      const right = first.groups[rightIndex];
      assert.ok(Math.hypot(right.cx - left.cx, right.cy - left.cy) >= left.r + right.r - 1, `${left.id} and ${right.id} overlap`);
    }
  }
});

test("repo-map endpoint is strict, bounded, and read-only", { timeout: 20_000 }, async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "burnlist-repo-map-"));
  const repoRoot = join(fixtureRoot, "fixture-repo");
  let child = null;
  try {
    await Promise.all([
      mkdir(join(repoRoot, "src"), { recursive: true }),
      mkdir(join(repoRoot, "notes", "burnlists", "inprogress", "fixture"), { recursive: true }),
      mkdir(join(fixtureRoot, "runs", "20260101-000000-abcdef"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(fixtureRoot, "outside.mjs"), "export const outside = true;\n"),
      writeFile(join(repoRoot, ".gitignore"), ".local/\n"),
      writeFile(join(repoRoot, "src", "a.mjs"), 'import "./b.mjs";\nexport const a = 1;\n'),
      writeFile(join(repoRoot, "src", "b.mjs"), "export const b = 1;\n"),
      writeFile(join(repoRoot, "src", "deleted.mjs"), "export const deleted = true;\n"),
      writeFile(join(repoRoot, "notes", "burnlists", "inprogress", "fixture", "burnlist.md"), [
        "# Fixture",
        "",
        "## Active Checklist",
        "",
        "- [ ] B001 | Exercise the read-only map",
        "",
        "## Completed",
        "",
      ].join("\n")),
      writeFile(join(fixtureRoot, "runs", "20260101-000000-abcdef", "run.json"), `${JSON.stringify({
        schemaVersion: 3,
        id: "20260101-000000-abcdef",
        typeId: "checklist",
      })}\n`),
    ]);
    await symlink(join(fixtureRoot, "outside.mjs"), join(repoRoot, "src", "outside-link.mjs"));
    git(repoRoot, ["init", "--quiet"]);
    git(repoRoot, ["config", "user.email", "fixture@example.invalid"]);
    git(repoRoot, ["config", "user.name", "Fixture"]);
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "--quiet", "-m", "fixture"]);

    await Promise.all([
      writeFile(join(repoRoot, "src", "b.mjs"), "export const b = 2;\n"),
      writeFile(join(repoRoot, "src", "untracked.mjs"), 'import "./b.mjs";\nexport const untracked = true;\n'),
      mkdir(join(repoRoot, ".local"), { recursive: true }),
      mkdir(join(repoRoot, "bulk"), { recursive: true }),
    ]);
    await Promise.all(Array.from({ length: 895 }, (_, index) => writeFile(
      join(repoRoot, "bulk", `${String(index).padStart(4, "0")}.mjs`),
      `export const value${index} = ${index};\n`,
    )));
    await writeFile(join(repoRoot, ".local", "ignored.mjs"), "export const ignored = true;\n");
    await unlink(join(repoRoot, "src", "deleted.mjs"));

    const statusBefore = git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const port = await availablePort();
    child = spawn(process.execPath, [
      serverPath,
      "--port", String(port),
      "--scan-root", repoRoot,
      "--state-dir", join(fixtureRoot, "state"),
      "--runs-dir", join(fixtureRoot, "runs"),
    ], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer(child, `http://127.0.0.1:${port}/`);

    const response = await fetch(`http://127.0.0.1:${port}/api/repo-map?repo=fixture-repo`, { cache: "no-store" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    assert.equal(payload.schema, "burnlist-repo-map@1");
    assert.equal(payload.available, true);
    assert.equal(payload.repo, "fixture-repo");
    assert.equal(payload.untrackedFiles, 896);
    assert.equal(payload.shownFiles, 900);
    assert.equal(payload.omittedFiles, payload.totalFiles - payload.shownFiles);
    assert.equal(payload.omittedFiles, 0);
    assert.equal(payload.dirtyFiles, 897);
    assert.ok(Array.isArray(payload.workingFiles));
    assert.ok(Array.isArray(payload.workingAllEdges));
    for (const retiredKey of ["files", "edges", "allEdges", "workingEdges"]) {
      assert.equal(Object.hasOwn(payload, retiredKey), false);
    }

    const files = new Map(payload.workingFiles.map((file) => [file.path, file]));
    assert.ok(files.has("src/a.mjs"));
    assert.ok(files.has("src/b.mjs"));
    assert.ok(files.has("src/untracked.mjs"));
    assert.equal(files.has("src/deleted.mjs"), false);
    assert.equal(files.has(".local/ignored.mjs"), false);
    assert.equal(files.has("src/outside-link.mjs"), false);
    assert.equal(files.get("src/b.mjs").dirty, true);
    assert.equal(files.get("src/b.mjs").status, "M");
    assert.equal(files.get("src/untracked.mjs").untracked, true);
    assert.ok(payload.workingAllEdges.some((edge) => edge.source === "src/a.mjs" && edge.target === "src/b.mjs"));

    const cachedResponse = await fetch(`http://127.0.0.1:${port}/api/repo-map?repo=fixture-repo`, { cache: "no-store" });
    assert.equal(cachedResponse.status, 200);
    assert.equal((await cachedResponse.json()).generatedAt, payload.generatedAt);

    for (const [url, method, expectedStatus] of [
      [`http://127.0.0.1:${port}/api/repo-map`, "GET", 400],
      [`http://127.0.0.1:${port}/api/repo-map?repo=fixture-repo&repo=fixture-repo`, "GET", 400],
      [`http://127.0.0.1:${port}/api/repo-map?repo=fixture-repo&extra=1`, "GET", 400],
      [`http://127.0.0.1:${port}/api/repo-map?repo=missing`, "GET", 404],
      [`http://127.0.0.1:${port}/api/repo-map?repo=fixture-repo`, "POST", 405],
      [`http://127.0.0.1:${port}/assets/fallback-burn-types.js`, "GET", 404],
      [`http://127.0.0.1:${port}/types/new`, "GET", 404],
      [`http://127.0.0.1:${port}/api/runs/20260101-000000-abcdef`, "GET", 400],
    ]) {
      const strictResponse = await fetch(url, { method });
      assert.equal(strictResponse.status, expectedStatus, `${method} ${url}`);
    }

    const ovensResponse = await fetch(`http://127.0.0.1:${port}/api/ovens`);
    const { writeToken } = await ovensResponse.json();
    const writeHeaders = {
      "content-type": "application/json",
      "x-burnlist-token": writeToken,
    };
    const retiredOven = await fetch(`http://127.0.0.1:${port}/api/ovens`, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        id: "retired",
        name: "Retired",
        definition: "# Retired",
        dashboard: { columns: 2, rows: 2, cells: [] },
      }),
    });
    assert.equal(retiredOven.status, 400);
    assert.match((await retiredOven.json()).error, /unsupported field/u);
    const retiredRun = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        typeId: "checklist",
        repoRoot,
        title: "Retired",
        objective: "Must be rejected before any run is written.",
      }),
    });
    assert.equal(retiredRun.status, 400);
    assert.match((await retiredRun.json()).error, /unsupported field/u);

    const statusAfter = git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    assert.equal(statusAfter, statusBefore);
  } finally {
    await stopChild(child);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args[0]} failed`);
  return result.stdout;
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
