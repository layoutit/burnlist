import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { repoKey } from "../server/registry.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const binPath = join(repoRoot, "bin", "burnlist.mjs");
const dashboardServerPath = join(repoRoot, "src", "server", "burnlist-dashboard-server.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-lifecycle-cli-"));
  const repo = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(repo);
  mkdirSync(home);
  return { repo, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run({ repo, home }, ...args) {
  return execFileSync(process.execPath, [binPath, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

function runFailure(context, ...args) {
  try {
    run(context, ...args);
    assert.fail(`Expected burnlist ${args.join(" ")} to fail.`);
  } catch (error) {
    assert.notEqual(error.status, 0);
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

function newPlan(context) {
  const output = run(context, "new");
  const [id, planPath, handle] = output.trim().split("\n");
  return { id, planPath, handle, output };
}

test("new creates a protocol-valid draft scaffold", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    assert.match(result.id, /^\d{6}-001$/u);
    assert.equal(readFileSync(result.planPath, "utf8").includes("## Active Checklist\n\n## Completed"), true);
    assert.equal(readFileSync(join(dirname(result.planPath), "goal.md"), "utf8").includes("## Proof Authority"), true);
    assert.match(result.handle, new RegExp(`^${repoKey(realpathSync(context.repo))}/${result.id}$`));
    assert.match(run(context, "--plan", result.planPath, "--check"), /Burnlist check passed: 0 active, 0 completed\./u);
  } finally {
    context.cleanup();
  }
});

test("new allocates incrementing ids and skips an existing draft reservation", () => {
  const context = fixture();
  try {
    const first = newPlan(context);
    const second = newPlan(context);
    assert.equal(second.id, `${first.id.slice(0, 7)}002`);
    mkdirSync(join(context.repo, "notes", "burnlists", "draft", `${first.id.slice(0, 7)}005`));
    writeFileSync(join(context.repo, "notes", "burnlists", "draft", `${first.id.slice(0, 7)}005`, "reserved"), "occupied\n");
    const third = newPlan(context);
    assert.equal(third.id, `${first.id.slice(0, 7)}006`);
    assert.deepEqual(readdirSync(dirname(third.planPath)).sort(), ["burnlist.md", "goal.md"]);
    assert.equal(readFileSync(join(context.repo, "notes", "burnlists", "draft", `${first.id.slice(0, 7)}005`, "reserved"), "utf8"), "occupied\n");
  } finally {
    context.cleanup();
  }
});

function addActiveItem(planPath, repo) {
  writeFileSync(planPath, [
    "# Sample Burnlist",
    "",
    "Status: Burnlist Final",
    `Repo: \`${realpathSync(repo)}\``,
    "Goal: ./goal.md",
    "",
    "## Active Checklist",
    "- [ ] B1 | Inspect lifecycle output",
    "  Files/search: `src/cli/lifecycle-cli.mjs`",
    "  Action: print the lifecycle record",
    "  Done/delete when: the record is visible",
    "  Validate: `node --test`",
    "",
    "## Completed",
    "",
  ].join("\n"));
}

function lifecycleFolder(repo, lifecycle, id) {
  return join(repo, "notes", "burnlists", lifecycle, id);
}

test("show prints a read-only plan summary and copy handle", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    mkdirSync(join(context.home, ".burnlist"));
    writeFileSync(join(context.home, ".burnlist", "server.json"), JSON.stringify({
      pid: process.pid,
      url: "http://127.0.0.1:4510/",
      host: "127.0.0.1",
      port: 4510,
      startedAt: "2026-07-12T12:00:00.000Z",
    }));
    const output = run(context, "show", result.id);
    assert.match(output, /Title: Sample Burnlist/u);
    assert.match(output, /Progress: 0\/1 \(0%\)/u);
    assert.match(output, new RegExp(`Copy handle: ${repoKey(realpathSync(context.repo))}/${result.id}`));
    assert.match(output, new RegExp(`URL: http://127\\.0\\.0\\.1:4510/r/${repoKey(realpathSync(context.repo))}/${result.id}`));
    assert.match(output, new RegExp(`Path: ${result.planPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`));
    assert.match(run(context, "show", result.handle), /Progress: 0\/1 \(0%\)/u);
  } finally {
    context.cleanup();
  }
});

test("show with an item reference prints that item's fields", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    const output = run(context, "show", `${result.id}#B1`);
    assert.match(output, /B1 \| Inspect lifecycle output/u);
    assert.match(output, /Action: print the lifecycle record/u);
    assert.match(output, new RegExp(`Copy handle: ${repoKey(realpathSync(context.repo))}/${result.id}#B1`));
  } finally {
    context.cleanup();
  }
});

test("ready rejects an empty draft and moves a contentful draft", () => {
  const context = fixture();
  try {
    const empty = newPlan(context);
    assert.match(runFailure(context, "ready", empty.id), /not ready: active checklist is empty/u);
    assert.equal(existsSync(lifecycleFolder(context.repo, "draft", empty.id)), true);

    const contentful = newPlan(context);
    addActiveItem(contentful.planPath, context.repo);
    assert.match(run(context, "ready", contentful.id), new RegExp(`${contentful.id}  draft -> ready`));
    assert.equal(existsSync(lifecycleFolder(context.repo, "ready", contentful.id)), true);
  } finally {
    context.cleanup();
  }
});

test("ready requires a non-empty goal.md", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    rmSync(join(dirname(result.planPath), "goal.md"));
    assert.match(runFailure(context, "ready", result.id), /not ready: goal\.md is missing/u);
    assert.equal(existsSync(lifecycleFolder(context.repo, "draft", result.id)), true);
  } finally {
    context.cleanup();
  }
});

test("start moves a ready Burnlist to inprogress", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    run(context, "ready", result.id);
    assert.match(run(context, "start", result.id), new RegExp(`${result.id}  ready -> inprogress`));
    assert.equal(existsSync(lifecycleFolder(context.repo, "inprogress", result.id)), true);
  } finally {
    context.cleanup();
  }
});

test("lifecycle moves reject a populated target folder", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    mkdirSync(lifecycleFolder(context.repo, "ready", result.id), { recursive: true });
    writeFileSync(join(lifecycleFolder(context.repo, "ready", result.id), "existing"), "keep\n");
    assert.match(runFailure(context, "ready", result.id), /target exists/u);
  } finally {
    context.cleanup();
  }
});

test("lifecycle moves reclaim an empty target folder", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    mkdirSync(lifecycleFolder(context.repo, "ready", result.id), { recursive: true });
    assert.match(run(context, "ready", result.id), new RegExp(`${result.id}  draft -> ready`));
    assert.equal(existsSync(lifecycleFolder(context.repo, "draft", result.id)), false);
    assert.equal(existsSync(lifecycleFolder(context.repo, "ready", result.id)), true);
  } finally {
    context.cleanup();
  }
});

test("close requires a finished queue and writes a completion digest in the target", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    run(context, "ready", result.id);
    run(context, "start", result.id);
    assert.match(runFailure(context, "close", result.id), /not ready to close/u);

    const activePath = join(lifecycleFolder(context.repo, "inprogress", result.id), "burnlist.md");
    writeFileSync(activePath, readFileSync(activePath, "utf8")
      .replace(/- \[ \] B1 \| Inspect lifecycle output[\s\S]*?\n\n## Completed/u, "## Completed")
      .replace("## Completed", "## Completed\n- B1 | 2026-07-12T12:00:00+00:00 | Inspect lifecycle output"));
    assert.match(run(context, "close", result.id), new RegExp(`${result.id}  inprogress -> completed`));
    const completedPlan = join(lifecycleFolder(context.repo, "completed", result.id), "burnlist.md");
    assert.equal(readFileSync(completedPlan, "utf8").includes("## Completion Digest"), true);
  } finally {
    context.cleanup();
  }
});

test("burn removes an active item, appends its ledger entry, and can check the result", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    run(context, "ready", result.id);
    run(context, "start", result.id);
    const activePath = join(lifecycleFolder(context.repo, "inprogress", result.id), "burnlist.md");
    const output = run(context, "burn", result.id, "B1", "--check");
    const burned = readFileSync(activePath, "utf8");
    assert.equal(burned.includes("- [ ] B1 | Inspect lifecycle output"), false);
    assert.match(burned, /- B1 \| \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \| Inspect lifecycle output/u);
    assert.match(output, /Burnlist check passed: 0 active, 1 completed\./u);
  } finally {
    context.cleanup();
  }
});

test("burn rejects a burnlist outside inprogress", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    assert.match(runFailure(context, "burn", result.id, "B1"), new RegExp(`burnlist ${result.id} is not in inprogress; it is in draft`));
    assert.match(readFileSync(result.planPath, "utf8"), /- \[ \] B1 \| Inspect lifecycle output/u);
  } finally {
    context.cleanup();
  }
});

test("burn validates its source before mutating it", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    run(context, "ready", result.id);
    run(context, "start", result.id);
    const planPath = join(lifecycleFolder(context.repo, "inprogress", result.id), "burnlist.md");
    writeFileSync(planPath, readFileSync(planPath, "utf8").replace("- [ ] B1", "- [x] B1"));
    const before = readFileSync(planPath, "utf8");
    assert.match(runFailure(context, "burn", result.id, "B1", "--check"), /Active item B1 is checked/u);
    assert.equal(readFileSync(planPath, "utf8"), before);
  } finally {
    context.cleanup();
  }
});

test("mutating lifecycle verbs reject traversal ids before touching the repository", () => {
  const context = fixture();
  try {
    assert.match(runFailure(context, "ready", "../evil"), /Invalid Burnlist id: \.\.\/evil/u);
    assert.match(runFailure(context, "close", "../../x"), /Invalid Burnlist id: \.\.\/\.\.\/x/u);
    assert.match(runFailure(context, "start", "../evil"), /Invalid Burnlist id: \.\.\/evil/u);
    assert.match(runFailure(context, "burn", "../evil", "B1"), /Invalid Burnlist id: \.\.\/evil/u);
    assert.equal(existsSync(join(context.repo, "notes")), false);
  } finally {
    context.cleanup();
  }
});

test("lifecycle verbs reject an existing per-id lock", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    writeFileSync(join(dirname(result.planPath), ".lock"), JSON.stringify({ token: "foreign", pid: process.pid }));
    assert.match(runFailure(context, "ready", result.id), new RegExp(`${result.id} is busy \\(locked\\)`));
  } finally {
    context.cleanup();
  }
});

test("lifecycle verbs reclaim a dead lock owner", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    writeFileSync(join(dirname(result.planPath), ".lock"), JSON.stringify({ token: "dead", pid: 999999999 }));
    assert.match(run(context, "ready", result.id), new RegExp(`${result.id}  draft -> ready`));
  } finally {
    context.cleanup();
  }
});

const gitAvailable = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

test("full lifecycle from a linked worktree uses the primary repository", { skip: !gitAvailable }, () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-lifecycle-worktree-"));
  const primary = join(root, "primary");
  const linked = join(root, "linked");
  const home = join(root, "home");
  try {
    mkdirSync(primary);
    mkdirSync(home);
    execFileSync("git", ["init", "--quiet", primary]);
    execFileSync("git", ["-C", primary, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", primary, "config", "user.name", "Burnlist Test"]);
    mkdirSync(join(primary, "notes", "burnlists"), { recursive: true });
    writeFileSync(join(primary, "README.md"), "# primary\n");
    execFileSync("git", ["-C", primary, "add", "README.md"]);
    execFileSync("git", ["-C", primary, "commit", "--quiet", "-m", "initial"]);
    execFileSync("git", ["-C", primary, "worktree", "add", "--detach", linked], { stdio: "ignore" });

    const context = { repo: linked, home };
    const result = newPlan(context);
    assert.equal(result.planPath.startsWith(`${realpathSync(primary)}/`), true);
    addActiveItem(result.planPath, primary);
    run(context, "ready", result.id);
    run(context, "start", result.id);
    run(context, "burn", result.id, "B1");
    run(context, "close", result.id);
    assert.equal(existsSync(lifecycleFolder(primary, "completed", result.id)), true);
    assert.equal(existsSync(lifecycleFolder(linked, "completed", result.id)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard stop leaves malformed and foreign live global runtime records alone", () => {
  const context = fixture();
  try {
    const stateDir = join(context.repo, "runtime");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "index.server.json"), JSON.stringify({ pid: 999999999, startedAt: "ours" }));
    mkdirSync(join(context.home, ".burnlist"));
    const globalPath = join(context.home, ".burnlist", "server.json");
    writeFileSync(globalPath, JSON.stringify({ pid: process.pid, startedAt: "foreign" }));
    execFileSync(process.execPath, [dashboardServerPath, "--stop", "--state-dir", stateDir], {
      cwd: context.repo,
      env: { ...process.env, HOME: context.home },
    });
    assert.equal(existsSync(globalPath), true);

    writeFileSync(globalPath, JSON.stringify({ pid: -17, startedAt: "corrupt" }));
    execFileSync(process.execPath, [dashboardServerPath, "--stop", "--state-dir", stateDir], {
      cwd: context.repo,
      env: { ...process.env, HOME: context.home },
    });
    assert.equal(existsSync(globalPath), true);

    writeFileSync(globalPath, JSON.stringify({ pid: 999999999 }));
    execFileSync(process.execPath, [dashboardServerPath, "--stop", "--state-dir", stateDir], {
      cwd: context.repo,
      env: { ...process.env, HOME: context.home },
    });
    assert.equal(existsSync(globalPath), false);
  } finally {
    context.cleanup();
  }
});
