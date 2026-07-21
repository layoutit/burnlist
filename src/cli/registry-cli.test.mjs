import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "burnlist-cli-home-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function run(home, ...args) {
  return execFileSync(process.execPath, ["bin/burnlist.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function gitRepo(parent, name = "repo") {
  const repo = join(parent, name);
  mkdirSync(repo);
  git(repo, "init", "--quiet");
  return repo;
}

function exclude(repo) {
  return readFileSync(join(repo, ".git", "info", "exclude"), "utf8");
}

test("register lists a root and is idempotent", () => {
  const { home, cleanup } = fixture();
  const root = join(home, "root");
  mkdirSync(root);
  const canonicalRoot = realpathSync(root);
  try {
    assert.match(run(home, "register", root), new RegExp(`Registered ${canonicalRoot}`));
    assert.match(run(home, "roots"), new RegExp(`empty\\s+${canonicalRoot}`));
    assert.match(run(home, "register", root), new RegExp(`Already registered ${canonicalRoot}`));
  } finally {
    cleanup();
  }
});

test("unregister removes a root", () => {
  const { home, cleanup } = fixture();
  const root = join(home, "root");
  mkdirSync(root);
  const canonicalRoot = realpathSync(root);
  try {
    run(home, "register", root);
    assert.match(run(home, "unregister", root), new RegExp(`Unregistered ${canonicalRoot}`));
    assert.equal(run(home, "roots"), "No repositories registered.\n");
  } finally {
    cleanup();
  }
});

test("roots --prune removes deleted roots", () => {
  const { home, cleanup } = fixture();
  const root = join(home, "deleted");
  mkdirSync(root);
  try {
    run(home, "register", root);
    rmSync(root, { recursive: true });
    const output = run(home, "roots", "--prune");
    assert.match(output, /Pruned 1 missing repository\./u);
    assert.match(output, /No repositories registered\./u);
  } finally {
    cleanup();
  }
});

test("init creates lifecycle folders, ignores them, and registers the repo", () => {
  const { home, cleanup } = fixture();
  const repo = gitRepo(home, "init-repo");
  const canonicalRepo = realpathSync(repo);
  try {
    const first = run(home, "init", repo);
    for (const folder of ["draft", "ready", "inprogress", "completed"]) {
      assert.equal(statSync(join(repo, "notes", "burnlists", folder)).isDirectory(), true);
    }
    assert.match(exclude(repo), /^\/notes\/burnlists\/$/mu);
    assert.match(exclude(repo), /^\/\.local\/$/mu);
    assert.match(run(home, "roots"), new RegExp(`empty\\s+${canonicalRepo}`));
    assert.match(first, /Ignored \/notes\/burnlists\/ and \/\.local\/ locally\./u);
    run(home, "init", repo);
    assert.equal(exclude(repo).split("\n").filter((line) => line === "/notes/burnlists/").length, 1);
    assert.equal(exclude(repo).split("\n").filter((line) => line === "/.local/").length, 1);
  } finally {
    cleanup();
  }
});

test("init exits 0 on success", () => {
  const { home, cleanup } = fixture();
  const repo = gitRepo(home, "init-exit-repo");
  try {
    const result = spawnSync(process.execPath, ["bin/burnlist.mjs", "init", repo], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Initialized \d+ lifecycle folders?/u);
  } finally {
    cleanup();
  }
});

test("init --track writes gitkeep files, tracks burnlists, and keeps local Oven storage ignored", () => {
  const { home, cleanup } = fixture();
  const repo = gitRepo(home, "tracked-repo");
  try {
    run(home, "init", repo);
    run(home, "init", "--track", repo);
    for (const folder of ["draft", "ready", "inprogress", "completed"]) {
      assert.equal(readFileSync(join(repo, "notes", "burnlists", folder, ".gitkeep"), "utf8"), "");
    }
    assert.doesNotMatch(exclude(repo), /^\/?notes\/burnlists\/$/mu);
    assert.match(exclude(repo), /^\/?\.local\/$/mu);
    const packagePath = join(repo, "oven.json");
    writeFileSync(packagePath, JSON.stringify({
      instructions: "# Tracked Oven\n\nKeep Oven state local.",
      detail: {
        version: 1, columns: 2, rows: 2, rowHeight: 48,
        cells: [{
          id: "summary", title: "Summary", description: "Current state.", widget: "metric", source: "/summary", format: "plain",
          column: 1, row: 1, columnSpan: 2, rowSpan: 1,
        }],
      },
    }));
    run(home, "oven", "create", "tracked-oven", "--package", packagePath, "--repo", repo);
    assert.equal(existsSync(join(repo, ".local", "burnlist", "ovens", "tracked-oven", "current")), true);
  } finally {
    cleanup();
  }
});

test("init respects a tracked gitignore rule", () => {
  const { home, cleanup } = fixture();
  const repo = gitRepo(home, "gitignore-repo");
  writeFileSync(join(repo, ".gitignore"), "notes/burnlists/\n");
  git(repo, "add", ".gitignore");
  const before = exclude(repo);
  try {
    run(home, "init", repo);
    assert.equal(exclude(repo), `${before}/.local/\n`);
  } finally {
    cleanup();
  }
});

test("unknown commands fail closed while version still works", () => {
  const { home, cleanup } = fixture();
  try {
    assert.throws(
      () => execFileSync(process.execPath, ["bin/burnlist.mjs", "bogus"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 3000,
      }),
      (error) => error.status === 2 && error.stderr === "Unknown command: bogus\n",
    );
    assert.match(run(home, "--version"), /^\d+\.\d+\.\d+\n$/u);
  } finally {
    cleanup();
  }
});
