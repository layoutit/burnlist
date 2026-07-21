import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ovenRevision } from "../ovens/oven-contract.mjs";
import {
  readVendoredOven,
  resolveOvenForRepo,
  vendoredOvenPath,
  vendoredOvensDir,
  writeVendoredOven,
} from "./oven-vendor.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-vendor-"));
  const repoRoot = join(root, "repo");
  const builtInOvensDir = join(root, "built-ins");
  const customOvensDir = join(root, "custom");
  mkdirSync(repoRoot);
  mkdirSync(builtInOvensDir);
  mkdirSync(customOvensDir);
  return {
    repoRoot,
    builtInOvensDir,
    customOvensDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function source(id, version, marker) {
  return {
    id,
    instructions: `# ${marker}\n\nInstructions for ${marker}.\n`,
    oven: `<oven id="${id}" version="${version}" contract="checklist-progress@1" theme="checklist">\n  <section-header title="${marker}"/>\n</oven>\n`,
  };
}

function writeSource(root, pkg) {
  const directory = join(root, pkg.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "instructions.md"), pkg.instructions);
  writeFileSync(join(directory, `${pkg.id}.oven`), pkg.oven);
}

function assertIso8601(value) {
  assert.equal(typeof value, "string");
  assert.equal(new Date(value).toISOString(), value);
}

test("writeVendoredOven writes byte copies and an exact content pin", () => {
  const context = fixture();
  const pkg = source("sample-oven", "1.0.0", "Pinned source");
  try {
    writeVendoredOven(context.repoRoot, pkg);
    const expectedPath = join(context.repoRoot, ".burnlist", "ovens", pkg.id);
    assert.equal(vendoredOvensDir(context.repoRoot), join(context.repoRoot, ".burnlist", "ovens"));
    assert.equal(vendoredOvenPath(context.repoRoot, pkg.id), expectedPath);
    assert.deepEqual(readdirSync(expectedPath).sort(), ["instructions.md", "pin.json", `${pkg.id}.oven`]);
    assert.equal(readFileSync(join(expectedPath, "instructions.md"), "utf8"), pkg.instructions);
    assert.equal(readFileSync(join(expectedPath, `${pkg.id}.oven`), "utf8"), pkg.oven);

    const pin = JSON.parse(readFileSync(join(expectedPath, "pin.json"), "utf8"));
    assert.deepEqual(Object.keys(pin).sort(), ["id", "pinnedAt", "revision", "source", "version"]);
    assert.equal(pin.id, pkg.id);
    assert.equal(pin.version, "1.0.0");
    assert.equal(pin.revision, ovenRevision(pkg));
    assert.equal(pin.source, "built-in");
    assertIso8601(pin.pinnedAt);
  } finally { context.cleanup(); }
});

test("readVendoredOven round-trips a pin and returns null for absent or incomplete packages", () => {
  const context = fixture();
  const pkg = source("sample-oven", "1.2.3", "Round trip");
  try {
    assert.equal(readVendoredOven(context.repoRoot, pkg.id), null);
    mkdirSync(vendoredOvenPath(context.repoRoot, "incomplete"), { recursive: true });
    writeFileSync(join(vendoredOvenPath(context.repoRoot, "incomplete"), "instructions.md"), "# Incomplete\n");
    assert.equal(readVendoredOven(context.repoRoot, "incomplete"), null);

    writeVendoredOven(context.repoRoot, pkg);
    const saved = readVendoredOven(context.repoRoot, pkg.id);
    assert.equal(saved.id, pkg.id);
    assert.equal(saved.version, "1.2.3");
    assert.equal(saved.instructions, pkg.instructions);
    assert.equal(saved.oven, pkg.oven);
    assert.equal(saved.revision, ovenRevision(pkg));
    assert.deepEqual(saved.pin, JSON.parse(readFileSync(join(vendoredOvenPath(context.repoRoot, pkg.id), "pin.json"), "utf8")));
  } finally { context.cleanup(); }
});

test("resolveOvenForRepo prefers vendored, then shipped built-in, then custom", () => {
  const context = fixture();
  const vendored = source("sample-oven", "1.0.0", "Vendored");
  const builtIn = source("sample-oven", "2.0.0", "Built in");
  const custom = source("sample-oven", "3.0.0", "Custom");
  const options = {
    repoRoot: context.repoRoot,
    builtInOvensDir: context.builtInOvensDir,
    customOvensDir: context.customOvensDir,
    id: vendored.id,
  };
  try {
    writeSource(context.builtInOvensDir, builtIn);
    writeSource(context.customOvensDir, custom);
    writeVendoredOven(context.repoRoot, vendored);
    assert.equal(resolveOvenForRepo(options).oven, vendored.oven);
    assert.equal(resolveOvenForRepo(options).revision, ovenRevision(vendored));

    rmSync(vendoredOvenPath(context.repoRoot, vendored.id), { recursive: true });
    assert.equal(resolveOvenForRepo(options).oven, builtIn.oven);
    rmSync(join(context.builtInOvensDir, builtIn.id), { recursive: true });
    assert.equal(resolveOvenForRepo(options).oven, custom.oven);
  } finally { context.cleanup(); }
});

test("a shipped source change cannot move a repo pin without an explicit vendored write", () => {
  const context = fixture();
  const initial = source("sample-oven", "1.0.0", "Initial");
  const newer = source("sample-oven", "2.0.0", "Newer");
  const options = {
    repoRoot: context.repoRoot,
    builtInOvensDir: context.builtInOvensDir,
    customOvensDir: context.customOvensDir,
    id: initial.id,
  };
  try {
    writeSource(context.builtInOvensDir, initial);
    writeVendoredOven(context.repoRoot, initial);
    const initialPin = readVendoredOven(context.repoRoot, initial.id).pin;

    writeFileSync(join(context.builtInOvensDir, initial.id, `${initial.id}.oven`), newer.oven);
    writeFileSync(join(context.builtInOvensDir, initial.id, "instructions.md"), newer.instructions);
    const stillPinned = resolveOvenForRepo(options);
    assert.equal(stillPinned.oven, initial.oven);
    assert.equal(stillPinned.revision, ovenRevision(initial));
    assert.deepEqual(readVendoredOven(context.repoRoot, initial.id).pin, initialPin);

    writeVendoredOven(context.repoRoot, newer);
    const upgraded = resolveOvenForRepo(options);
    assert.equal(upgraded.oven, newer.oven);
    assert.equal(upgraded.revision, ovenRevision(newer));
    assert.notEqual(upgraded.revision, initialPin.revision);
    assert.equal(upgraded.pin.version, "2.0.0");
  } finally { context.cleanup(); }
});

test("vendored replacement is all-or-nothing and leaves a plain committed directory", () => {
  const context = fixture();
  const initial = source("sample-oven", "1.0.0", "Stable");
  try {
    writeVendoredOven(context.repoRoot, initial);
    const directory = vendoredOvenPath(context.repoRoot, initial.id);
    const before = Object.fromEntries(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))]));
    assert.throws(() => writeVendoredOven(context.repoRoot, { ...initial, oven: "<not-an-oven>" }));
    const after = Object.fromEntries(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))]));
    assert.deepEqual(after, before);
    assert.deepEqual(readdirSync(vendoredOvensDir(context.repoRoot)), [initial.id]);
    const stat = lstatSync(directory);
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.isSymbolicLink(), false);
  } finally { context.cleanup(); }
});
