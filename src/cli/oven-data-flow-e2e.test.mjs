import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { buildPayload } from "../../ovens/differential-testing/example/adapter.mjs";
import { checklistFixture } from "../../dashboard/src/components/ChecklistDashboard/ChecklistDashboard.fixture.mjs";
import { compileOven } from "../ovens/dsl/oven-compile.mjs";
import { readBindingStore } from "../server/oven-bindings.mjs";
import { canonicalOvenDataPath } from "../server/oven-data-store.mjs";
import { vendoredOvenPath } from "../server/oven-vendor.mjs";
import { useShippedOven } from "./oven-use.mjs";

const packageRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(packageRoot, "bin", "burnlist.mjs");

function fixture(t, name) {
  const root = mkdtempSync(join(tmpdir(), `burnlist-data-flow-${name}-`));
  const repo = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(repo);
  mkdirSync(home);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const context = { root, repo, env: { ...process.env, HOME: home } };
  const initialized = runResult(context, "init", repo);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  assert.match(initialized.stdout, /Initialized 4 lifecycle folders/u);
  assert.match(readFileSync(join(repo, ".git", "info", "exclude"), "utf8"), /\/\.local\//u);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return context;
}

function runResult(context, ...args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: context.repo,
    env: context.env,
    encoding: "utf8",
  });
}

function run(context, ...args) {
  const result = runResult(context, ...args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function differentialPayload() {
  const example = join(packageRoot, "ovens", "differential-testing", "example");
  return buildPayload(
    JSON.parse(readFileSync(join(example, "reference.json"), "utf8")),
    JSON.parse(readFileSync(join(example, "candidate.json"), "utf8")),
  );
}

function runtimeInvalidPayload(valid) {
  const invalid = JSON.parse(JSON.stringify(valid));
  invalid.summary.runs.total = 1;
  return invalid;
}

async function renderDifferentialTesting(vendoredSource, payload) {
  const output = mkdtempSync(join(packageRoot, ".oven-data-flow-e2e-"));
  try {
    const runtimeOutput = join(output, "OvenRuntime.mjs");
    const adapterOutput = join(output, "differential-testing-adapter.mjs");
    const sourceDir = join(packageRoot, "dashboard", "src");
    await Promise.all([
      build({ entryPoints: [join(sourceDir, "oven", "runtime", "OvenRuntime.tsx")], bundle: true, format: "esm", outfile: runtimeOutput, platform: "node", alias: { "@": sourceDir, "@lib": join(sourceDir, "lib"), "@oven": join(sourceDir, "oven") }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [join(sourceDir, "lib", "differential-testing-adapter.ts")], bundle: true, format: "esm", outfile: adapterOutput, platform: "node", target: "node18" }),
    ]);
    const cacheKey = `?test=${Date.now()}`;
    const [{ OvenRuntime }, { adaptDifferentialTesting }] = await Promise.all([
      import(`${pathToFileURL(runtimeOutput).href}${cacheKey}`),
      import(`${pathToFileURL(adapterOutput).href}${cacheKey}`),
    ]);
    const compiled = compileOven(vendoredSource, { file: "vendored-differential-testing.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    return renderToStaticMarkup(createElement(OvenRuntime, {
      ir: compiled.ir,
      payload: adaptDifferentialTesting(payload),
    }));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

function createCustomOven(context) {
  const instructions = join(context.repo, "custom-shape.md");
  const source = join(context.repo, "custom-shape.oven");
  writeFileSync(instructions, "# Custom Shape\n\nPointer-only validation fixture.\n");
  writeFileSync(source, `<oven id="custom-shape" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <section-header title="Value" source="/summary/value"/>
</oven>
`);
  run(context, "oven", "create", "custom-shape", "--instructions", instructions, "--oven", source, "--repo", context.repo);
}

function shippedChecklist() {
  const root = join(packageRoot, "ovens", "checklist");
  return {
    id: "checklist",
    builtIn: true,
    instructions: readFileSync(join(root, "instructions.md"), "utf8"),
    oven: readFileSync(join(root, "checklist.oven"), "utf8"),
  };
}

test("initialized repositories enforce the complete validated Oven data flow", async (t) => {
  const context = fixture(t, "existing");
  const valid = differentialPayload();
  const invalid = runtimeInvalidPayload(valid);
  const validPath = join(context.repo, "valid.json");
  const invalidPath = join(context.repo, "invalid.json");
  writeFileSync(validPath, JSON.stringify(valid));
  writeFileSync(invalidPath, JSON.stringify(invalid));

  const used = run(context, "oven", "use", "differential-testing", "--repo", context.repo);
  const vendored = vendoredOvenPath(context.repo, "differential-testing");
  assert.match(used.stdout, /adopted without data/u);
  assert.deepEqual(readdirSync(vendored).sort(), ["differential-testing.oven", "instructions.md", "pin.json"]);
  assert.equal(existsSync(canonicalOvenDataPath(context.repo, "differential-testing")), false);
  assert.equal(Object.hasOwn(readBindingStore(context.repo).bindings, "differential-testing"), false);

  run(context, "oven", "set", "differential-testing", validPath, "--repo", context.repo);
  const dataPath = canonicalOvenDataPath(context.repo, "differential-testing");
  const bindingPath = join(context.repo, ".local", "burnlist", "bindings.json");
  assert.deepEqual(JSON.parse(readFileSync(dataPath, "utf8")), valid);
  assert.equal(readBindingStore(context.repo).bindings["differential-testing"].path, ".local/burnlist/data/differential-testing.json");
  const markup = await renderDifferentialTesting(
    readFileSync(join(vendored, "differential-testing.oven"), "utf8"),
    JSON.parse(readFileSync(dataPath, "utf8")),
  );
  assert.match(markup, /No Differential Testing scenarios/u);

  const priorData = readFileSync(dataPath);
  const priorBinding = readFileSync(bindingPath);
  const rejected = runResult(context, "oven", "set", "differential-testing", invalidPath, "--repo", context.repo);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /total must equal passed \+ failed \+ blocked/u);
  assert.deepEqual(readFileSync(dataPath), priorData);
  assert.deepEqual(readFileSync(bindingPath), priorBinding);

  createCustomOven(context);
  const customAccepted = runResult(context, "oven", "set", "custom-shape", '{"summary":{"value":42}}', "--repo", context.repo);
  assert.equal(customAccepted.status, 0, customAccepted.stderr);
  assert.match(`${customAccepted.stdout}${customAccepted.stderr}`, /shape-only validation checks source pointers, not payload truth/u);
  const customPath = canonicalOvenDataPath(context.repo, "custom-shape");
  const priorCustom = readFileSync(customPath);
  const priorStore = readFileSync(bindingPath);
  const customRejected = runResult(context, "oven", "set", "custom-shape", '{"summary":{}}', "--repo", context.repo);
  assert.notEqual(customRejected.status, 0);
  assert.match(customRejected.stderr, /\/summary\/value.*does not resolve/u);
  assert.deepEqual(readFileSync(customPath), priorCustom);
  assert.deepEqual(readFileSync(bindingPath), priorStore);

  const builtIns = join(context.root, "built-ins");
  mkdirSync(join(builtIns, "checklist", "example"), { recursive: true });
  writeFileSync(join(builtIns, "checklist", "example", "data.json"), JSON.stringify(checklistFixture));
  const exampleUse = useShippedOven({
    id: "checklist",
    repoRoot: context.repo,
    builtInOvensDir: builtIns,
    readOvenDir: () => shippedChecklist(),
    now: () => new Date("2026-07-22T00:00:00.000Z"),
  });
  assert.match(exampleUse.output, /Set shipped example data/u);
  assert.deepEqual(JSON.parse(readFileSync(canonicalOvenDataPath(context.repo, "checklist"), "utf8")), checklistFixture);
  assert.equal(readBindingStore(context.repo).bindings.checklist.path, ".local/burnlist/data/checklist.json");

  const fresh = fixture(t, "fresh");
  const freshInvalid = join(fresh.repo, "invalid.json");
  writeFileSync(freshInvalid, JSON.stringify(invalid));
  const freshRejected = runResult(fresh, "oven", "set", "differential-testing", freshInvalid, "--repo", fresh.repo);
  assert.notEqual(freshRejected.status, 0);
  assert.match(freshRejected.stderr, /data validation failed/u);
  assert.equal(existsSync(canonicalOvenDataPath(fresh.repo, "differential-testing")), false);
  assert.equal(existsSync(join(fresh.repo, ".local", "burnlist", "bindings.json")), false);
});
