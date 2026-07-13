import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { repoKey } from "../server/registry.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const binPath = join(repoRoot, "bin", "burnlist.mjs");

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
    const third = newPlan(context);
    assert.equal(third.id, `${first.id.slice(0, 7)}006`);
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

test("lifecycle moves reject an existing target folder", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    mkdirSync(lifecycleFolder(context.repo, "ready", result.id), { recursive: true });
    assert.match(runFailure(context, "ready", result.id), /target exists/u);
  } finally {
    context.cleanup();
  }
});

test("close requires a finished queue and writes a completion digest before moving", () => {
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
    const output = run(context, "burn", result.id, "B1", "--check");
    const burned = readFileSync(result.planPath, "utf8");
    assert.equal(burned.includes("- [ ] B1 | Inspect lifecycle output"), false);
    assert.match(burned, /- B1 \| \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \| Inspect lifecycle output/u);
    assert.match(output, /Burnlist check passed: 0 active, 1 completed\./u);
  } finally {
    context.cleanup();
  }
});

test("lifecycle verbs reject an existing per-id lock", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    mkdirSync(join(dirname(result.planPath), ".lock"));
    assert.match(runFailure(context, "ready", result.id), new RegExp(`${result.id} is busy \\(locked\\)`));
  } finally {
    context.cleanup();
  }
});
