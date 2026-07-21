import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { buildPayload } from "../../ovens/differential-testing/example/adapter.mjs";
import { readBindingStore } from "../server/oven-bindings.mjs";
import { canonicalOvenDataPath } from "../server/oven-data-store.mjs";

const packageRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(packageRoot, "bin", "burnlist.mjs");

function fixture(t, { ignored = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-set-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  if (ignored) writeFileSync(join(repo, ".gitignore"), ".local/\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return repo;
}

function runResult(repo, args, options = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: repo,
    encoding: "utf8",
    ...options,
  });
}

function run(repo, ...args) {
  const result = runResult(repo, args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function serialized(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function customOven(repo) {
  const root = join(repo, ".local", "burnlist", "ovens", "custom-shape");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "instructions.md"), "# Custom Shape\n\nA pointer-only test Oven.\n");
  writeFileSync(join(root, "custom-shape.oven"), `<oven id="custom-shape" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <section-header title="Value" source="/summary/value"/>
</oven>
`);
}

function validDifferentialPayload() {
  const example = join(packageRoot, "ovens", "differential-testing", "example");
  return buildPayload(
    JSON.parse(readFileSync(join(example, "reference.json"), "utf8")),
    JSON.parse(readFileSync(join(example, "candidate.json"), "utf8")),
  );
}

test("oven set reads a file for a repo-selected vendored built-in", (t) => {
  const repo = fixture(t);
  const input = join(repo, "payload.json");
  const payload = { current: { title: "From a file" }, list: [1, 2] };
  writeFileSync(input, JSON.stringify(payload));
  run(repo, "oven", "adopt", "checklist", "--repo", repo);

  const output = run(repo, "oven", "set", "checklist", input, "--repo", repo);
  const dataPath = canonicalOvenDataPath(repo, "checklist");
  assert.match(output, /Set Oven checklist data/u);
  assert.ok(output.includes(`Data: ${dataPath}`));
  assert.ok(output.includes(`Binding: ${join(repo, ".local", "burnlist", "bindings.json")}`));
  assert.equal(readFileSync(dataPath, "utf8"), serialized(payload));
  assert.equal(readBindingStore(repo).bindings.checklist.path, ".local/burnlist/data/checklist.json");

  const beforeBinding = readFileSync(join(repo, ".local", "burnlist", "bindings.json"), "utf8");
  run(repo, "oven", "set", "checklist", JSON.stringify(payload), "--repo", repo);
  assert.equal(readFileSync(join(repo, ".local", "burnlist", "bindings.json"), "utf8"), beforeBinding);
});

test("oven set reads bounded JSON from stdin", (t) => {
  const repo = fixture(t);
  const payload = { from: "stdin", ok: true };
  const result = runResult(repo, ["oven", "set", "checklist", "-", "--repo", repo], {
    input: JSON.stringify(payload),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(canonicalOvenDataPath(repo, "checklist"), "utf8"), serialized(payload));
});

test("custom set warns that validation is shape-only and rejects missing pointers", (t) => {
  const repo = fixture(t);
  customOven(repo);
  const accepted = runResult(repo, [
    "oven", "set", "custom-shape", '{"summary":{"value":42}}', "--repo", repo,
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(`${accepted.stdout}${accepted.stderr}`, /shape-only/u);
  const dataPath = canonicalOvenDataPath(repo, "custom-shape");
  const priorData = readFileSync(dataPath);
  const priorBinding = readFileSync(join(repo, ".local", "burnlist", "bindings.json"));

  const rejected = runResult(repo, [
    "oven", "set", "custom-shape", '{"summary":{}}', "--repo", repo,
  ]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /\/summary\/value.*does not resolve/u);
  assert.deepEqual(readFileSync(dataPath), priorData);
  assert.deepEqual(readFileSync(join(repo, ".local", "burnlist", "bindings.json")), priorBinding);
});

test("runtime-invalid built-in data is rejected before fresh or replacement mutation", (t) => {
  const freshRepo = fixture(t);
  const invalid = '{"schema":"burnlist-differential-testing-data@1"}';
  const fresh = runResult(freshRepo, [
    "oven", "set", "differential-testing", invalid, "--repo", freshRepo,
  ]);
  assert.notEqual(fresh.status, 0);
  assert.match(fresh.stderr, /Differential Testing data|scenarioCatalog|publishedAt/u);
  assert.equal(existsSync(canonicalOvenDataPath(freshRepo, "differential-testing")), false);
  assert.equal(Object.hasOwn(readBindingStore(freshRepo).bindings, "differential-testing"), false);

  const existingRepo = fixture(t);
  const validPath = join(existingRepo, "valid.json");
  writeFileSync(validPath, JSON.stringify(validDifferentialPayload()));
  run(existingRepo, "oven", "set", "differential-testing", validPath, "--repo", existingRepo);
  const dataPath = canonicalOvenDataPath(existingRepo, "differential-testing");
  const bindingPath = join(existingRepo, ".local", "burnlist", "bindings.json");
  const priorData = readFileSync(dataPath);
  const priorBinding = readFileSync(bindingPath);
  const replacement = runResult(existingRepo, [
    "oven", "set", "differential-testing", invalid, "--repo", existingRepo,
  ]);
  assert.notEqual(replacement.status, 0);
  assert.deepEqual(readFileSync(dataPath), priorData);
  assert.deepEqual(readFileSync(bindingPath), priorBinding);
});

test("producer-managed and unignored targets fail without data state", (t) => {
  const repo = fixture(t);
  const managed = runResult(repo, ["oven", "set", "streaming-diff", "{}", "--repo", repo]);
  assert.notEqual(managed.status, 0);
  assert.match(managed.stderr, /producer-managed/u);
  assert.equal(existsSync(canonicalOvenDataPath(repo, "streaming-diff")), false);

  const unignored = fixture(t, { ignored: false });
  const result = runResult(unignored, ["oven", "set", "checklist", "{}", "--repo", unignored]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not git-ignored/u);
  assert.equal(existsSync(canonicalOvenDataPath(unignored, "checklist")), false);
});
