import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

test("show prints a read-only plan summary and copy handle", () => {
  const context = fixture();
  try {
    const result = newPlan(context);
    addActiveItem(result.planPath, context.repo);
    const output = run(context, "show", result.id);
    assert.match(output, /Title: Sample Burnlist/u);
    assert.match(output, /Progress: 0\/1 \(0%\)/u);
    assert.match(output, new RegExp(`Copy handle: ${repoKey(realpathSync(context.repo))}/${result.id}`));
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
