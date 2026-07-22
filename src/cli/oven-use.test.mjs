import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { checklistFixture } from "../../dashboard/src/components/ChecklistDashboard/ChecklistDashboard.fixture.mjs";
import { compileOven } from "../ovens/dsl/oven-compile.mjs";
import { readBindingStore } from "../server/oven-bindings.mjs";
import { canonicalOvenDataPath } from "../server/oven-data-store.mjs";
import { vendoredOvenPath } from "../server/oven-vendor.mjs";
import { useShippedOven } from "./oven-use.mjs";

const packageRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(packageRoot, "bin", "burnlist.mjs");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-use-"));
  const repo = join(root, "repo");
  const builtIns = join(root, "built-ins");
  mkdirSync(repo);
  mkdirSync(builtIns);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, ".gitignore"), ".local/\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repo, builtIns };
}

function shipped(id) {
  const directory = join(packageRoot, "ovens", id);
  return {
    id,
    builtIn: true,
    instructions: readFileSync(join(directory, "instructions.md"), "utf8"),
    oven: readFileSync(join(directory, `${id}.oven`), "utf8"),
  };
}

function installExample(context, id, payload) {
  const directory = join(context.builtIns, id, "example");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "data.json"), JSON.stringify(payload));
}

function callUse(context, id, options = {}) {
  const oven = shipped(id);
  return useShippedOven({
    id,
    repoRoot: context.repo,
    builtInOvensDir: context.builtIns,
    readOvenDir: () => oven,
    now: () => new Date("2026-07-22T00:00:00.000Z"),
    ...options,
  });
}

function runResult(repo, ...args) {
  return spawnSync(process.execPath, [binPath, ...args], { cwd: repo, encoding: "utf8" });
}

async function renderChecklist(payload) {
  const output = mkdtempSync(join(packageRoot, ".oven-use-render-"));
  const runtimeOutput = join(output, "OvenRuntime.mjs");
  const adapterOutput = join(output, "checklist-adapter.mjs");
  const sourceDir = join(packageRoot, "dashboard", "src");
  try {
    await Promise.all([
      build({ entryPoints: [join(sourceDir, "oven", "runtime", "OvenRuntime.tsx")], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: { "@": sourceDir, "@lib": join(sourceDir, "lib"), "@oven": join(sourceDir, "oven") }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [join(sourceDir, "lib", "checklist-adapter.ts")], bundle: true, format: "esm", outfile: adapterOutput, platform: "node", target: "node18" }),
    ]);
    const [{ OvenRuntime }, { adaptChecklist }] = await Promise.all([
      import(`${new URL(`file://${runtimeOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${adapterOutput}`).href}?test=${Date.now()}`),
    ]);
    const compiled = compileOven(shipped("checklist").oven);
    assert.equal(compiled.ok, true);
    return renderToStaticMarkup(createElement(OvenRuntime, { ir: compiled.ir, payload: adaptChecklist(payload) }));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

test("oven use adopts without data when no exact shipped example exists", (t) => {
  const context = fixture(t);
  const result = runResult(context.repo, "oven", "use", "differential-testing", "--repo", context.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(vendoredOvenPath(context.repo, "differential-testing")), true);
  assert.equal(existsSync(canonicalOvenDataPath(context.repo, "differential-testing")), false);
  assert.equal(Object.hasOwn(readBindingStore(context.repo).bindings, "differential-testing"), false);
  assert.match(result.stdout, /No example\/data\.json is shipped; adopted without data/u);
  assert.ok(result.stdout.includes(`burnlist oven set differential-testing <data> --repo ${JSON.stringify(context.repo)}`));

  const duplicate = runResult(context.repo, "oven", "use", "differential-testing", "--repo", context.repo);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /already vendored/u);
  const forced = runResult(context.repo, "oven", "use", "differential-testing", "--repo", context.repo, "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(existsSync(canonicalOvenDataPath(context.repo, "differential-testing")), false);
});

test("oven use validates, transactionally installs, and renders exact example data", async (t) => {
  const context = fixture(t);
  const payload = checklistFixture;
  installExample(context, "checklist", payload);

  const result = callUse(context, "checklist");
  const vendor = vendoredOvenPath(context.repo, "checklist");
  const data = canonicalOvenDataPath(context.repo, "checklist");
  assert.equal(readFileSync(data, "utf8"), `${JSON.stringify(payload, null, 2)}\n`);
  assert.equal(readBindingStore(context.repo).bindings.checklist.path, ".local/burnlist/data/checklist.json");
  assert.deepEqual(readdirSync(vendor).sort(), ["checklist.oven", "instructions.md", "pin.json"]);
  assert.match(result.output, /Adopted Oven checklist/u);
  assert.ok(result.output.includes(`Data: ${data}`));
  const markup = await renderChecklist(JSON.parse(readFileSync(data, "utf8")));
  assert.match(markup, /2 of 2 tasks complete/u);
  assert.match(markup, /Second event/u);
});

test("invalid or interrupted example setup leaves no partial install", (t) => {
  const invalid = fixture(t);
  installExample(invalid, "differential-testing", { schema: "burnlist-differential-testing-data@1" });
  assert.throws(() => callUse(invalid, "differential-testing"), /data validation failed/u);
  assert.equal(existsSync(vendoredOvenPath(invalid.repo, "differential-testing")), false);
  assert.equal(existsSync(canonicalOvenDataPath(invalid.repo, "differential-testing")), false);
  assert.equal(Object.hasOwn(readBindingStore(invalid.repo).bindings, "differential-testing"), false);

  const interrupted = fixture(t);
  installExample(interrupted, "checklist", { ok: true });
  assert.throws(() => callUse(interrupted, "checklist", {
    writeVendor() { throw new Error("injected vendor failure"); },
  }), /injected vendor failure/u);
  assert.equal(existsSync(vendoredOvenPath(interrupted.repo, "checklist")), false);
  assert.equal(existsSync(canonicalOvenDataPath(interrupted.repo, "checklist")), false);
  assert.equal(existsSync(dirname(canonicalOvenDataPath(interrupted.repo, "checklist"))), true);
  assert.equal(Object.hasOwn(readBindingStore(interrupted.repo).bindings, "checklist"), false);
});
