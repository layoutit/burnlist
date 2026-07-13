import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mutatorRepoRoots, observerRepoRoots } from "./discovery.mjs";
import { registerRoot, registryPath } from "./registry.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-discovery-"));
  const home = join(root, "home");
  const repoA = join(root, "repo-a");
  const repoB = join(root, "repo-b");
  mkdirSync(home);
  createRepo(repoA);
  createRepo(repoB);
  return { home, repoA, repoB, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function createRepo(root) {
  mkdirSync(join(root, "notes", "burnlists", "inprogress"), { recursive: true });
}

function completedBurnlist(root, id) {
  const path = join(root, "notes", "burnlists", "inprogress", id, "burnlist.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    `# ${id}`,
    "",
    "## Active Checklist",
    "",
    "## Completed",
    "",
    `- ${id}-01 | 2026-07-12T12:00:00+00:00 | Completed work`,
    "",
  ].join("\n"));
}

test("observer discovery unions registered roots", () => {
  const { home, repoA, repoB, cleanup } = fixture();
  try {
    registerRoot(repoB, { home });
    assert.deepEqual(observerRepoRoots({ cwd: repoA, home }), [realpathSync(repoA), realpathSync(repoB)].sort((a, b) => a.localeCompare(b)));
  } finally { cleanup(); }
});

test("mutator discovery excludes registered roots", () => {
  const { home, repoA, repoB, cleanup } = fixture();
  try {
    registerRoot(repoB, { home });
    assert.deepEqual(mutatorRepoRoots({ cwd: repoA }), [realpathSync(repoA)]);
  } finally { cleanup(); }
});

test("observer scan root is a hard override", () => {
  const { home, repoA, repoB, cleanup } = fixture();
  try {
    registerRoot(repoB, { home });
    assert.deepEqual(observerRepoRoots({ cwd: repoA, home, scanRoot: repoA }), [realpathSync(repoA)]);
  } finally { cleanup(); }
});

test("observer discovery skips deleted registered roots", () => {
  const { home, repoA, repoB, cleanup } = fixture();
  try {
    registerRoot(repoB, { home });
    rmSync(repoB, { recursive: true });
    assert.deepEqual(observerRepoRoots({ cwd: repoA, home }), [realpathSync(repoA)]);
  } finally { cleanup(); }
});

test("observer discovery tolerates a corrupt registry", () => {
  const { home, repoA, cleanup } = fixture();
  try {
    const path = registryPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json");
    assert.deepEqual(observerRepoRoots({ cwd: repoA, home }), [realpathSync(repoA)]);
  } finally { cleanup(); }
});

test("close-completed only moves burnlists in the mutator root", () => {
  const { home, repoA, repoB, cleanup } = fixture();
  try {
    completedBurnlist(repoA, "a-complete");
    completedBurnlist(repoB, "b-complete");
    registerRoot(repoB, { home });
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    execFileSync(process.execPath, [join(packageRoot, "bin", "burnlist.mjs"), "--close-completed"], {
      cwd: repoA,
      env: { ...process.env, HOME: home },
      stdio: "pipe",
    });
    assert.equal(existsSync(join(repoA, "notes", "burnlists", "completed", "a-complete", "burnlist.md")), true);
    assert.equal(existsSync(join(repoB, "notes", "burnlists", "inprogress", "b-complete", "burnlist.md")), true);
  } finally { cleanup(); }
});
