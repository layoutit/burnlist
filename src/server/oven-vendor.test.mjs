import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ovenRevision } from "../ovens/oven-contract.mjs";
import {
  OVEN_PIN_MAX_BYTES,
  readVendoredOven,
  resolveOvenForRepo,
  vendoredOvenPath,
  vendoredOvensDir,
  writeVendoredOven,
} from "./oven-vendor.mjs";
import { OVEN_INSTRUCTIONS_MAX_BYTES, OVEN_SOURCE_MAX_BYTES } from "./oven-storage.mjs";

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

test("vendored writes reject an escaped state symlink before creating outside directories", () => {
  const context = fixture();
  const outside = join(context.repoRoot, "..", "outside");
  try {
    mkdirSync(outside);
    symlinkSync(outside, join(context.repoRoot, ".burnlist"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => writeVendoredOven(context.repoRoot, source("sample-oven", "1.0.0", "Escaped")),
      /escapes/u,
    );
    assert.equal(existsSync(join(outside, "ovens")), false);
  } finally { context.cleanup(); }
});

test("vendored writes reject symlinked storage components without writing outside", () => {
  for (const component of ["ovens", ".oven-locks", "target", "leaf"]) {
    const context = fixture();
    try {
      const outside = join(context.repoRoot, "..", `outside-${component.replace(".", "")}`);
      const state = join(context.repoRoot, ".burnlist");
      const root = join(state, "ovens");
      const target = join(root, "sample-oven");
      mkdirSync(outside);
      mkdirSync(state);
      if (component === "ovens") {
        symlinkSync(outside, root, process.platform === "win32" ? "junction" : "dir");
      } else {
        mkdirSync(root);
        if (component === ".oven-locks") {
          symlinkSync(outside, join(root, ".oven-locks"), process.platform === "win32" ? "junction" : "dir");
        } else if (component === "target") {
          symlinkSync(outside, target, process.platform === "win32" ? "junction" : "dir");
        } else {
          mkdirSync(target);
          writeFileSync(join(outside, "instructions.md"), "outside stays unchanged\n");
          symlinkSync(join(outside, "instructions.md"), join(target, "instructions.md"), process.platform === "win32" ? "file" : undefined);
        }
      }
      assert.throws(
        () => writeVendoredOven(context.repoRoot, source("sample-oven", "1.0.0", "Guarded")),
        /escapes|symbolic link|must be a real directory/u,
      );
      if (component === "leaf") {
        assert.equal(readFileSync(join(outside, "instructions.md"), "utf8"), "outside stays unchanged\n");
      } else {
        assert.deepEqual(readdirSync(outside), []);
      }
    } finally { context.cleanup(); }
  }
});

test("vendored writes never recursively recreate an identity-guarded root through a swapped state path", () => {
  const context = fixture();
  const script = [
    'import fs, { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync } from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'import { join, resolve } from "node:path";',
    'const [fixtureRoot, moduleUrl] = process.argv.slice(1);',
    'const repo = join(fixtureRoot, "boundary-repo");',
    'const outside = join(fixtureRoot, "boundary-outside");',
    'mkdirSync(repo);',
    'mkdirSync(outside);',
    'const vendor = await import(moduleUrl);',
    'const pkg = (marker) => ({',
    '  id: "sample-oven",',
    '  instructions: `# ${marker}\\n`,',
    '  oven: `<oven id="sample-oven" version="1.0.0" contract="checklist-progress@1" theme="checklist"><section-header title="${marker}"/></oven>\\n`,',
    '});',
    'vendor.writeVendoredOven(repo, pkg("Initial"));',
    'const state = join(repo, ".burnlist");',
    'const root = join(state, "ovens");',
    'const nativeMkdir = fs.mkdirSync;',
    'let recursiveRootCalls = 0;',
    'fs.mkdirSync = (path, options) => {',
    '  if (resolve(path) === resolve(root) && options?.recursive) {',
    '    recursiveRootCalls += 1;',
    '    renameSync(state, `${state}.original`);',
    '    symlinkSync(outside, state, process.platform === "win32" ? "junction" : "dir");',
    '  }',
    '  return nativeMkdir(path, options);',
    '};',
    'syncBuiltinESMExports();',
    'let error = null;',
    'try { vendor.writeVendoredOven(repo, pkg("Updated")); } catch (caught) { error = caught.message; }',
    'const instructions = readFileSync(join(root, "sample-oven", "instructions.md"), "utf8");',
    'process.stdout.write(JSON.stringify({ recursiveRootCalls, outsideOvens: existsSync(join(outside, "ovens")), error, instructions }));',
  ].join("\n");
  try {
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      script,
      join(context.repoRoot, ".."),
      new URL("./oven-vendor.mjs", import.meta.url).href,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      recursiveRootCalls: 0,
      outsideOvens: false,
      error: null,
      instructions: "# Updated\n",
    });
  } finally { context.cleanup(); }
});

test("vendored reads reject a persistent package-parent replacement between leaf lstat and open", () => {
  const context = fixture();
  const script = [
    'import fs, { mkdirSync, renameSync } from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'import { join, resolve } from "node:path";',
    'const [fixtureRoot, moduleUrl] = process.argv.slice(1);',
    'const repo = join(fixtureRoot, "read-repo");',
    'const replacementRepo = join(fixtureRoot, "replacement-repo");',
    'mkdirSync(repo);',
    'mkdirSync(replacementRepo);',
    'const vendor = await import(moduleUrl);',
    'const pkg = (marker) => ({',
    '  id: "sample-oven",',
    '  instructions: `# ${marker}\\n`,',
    '  oven: `<oven id="sample-oven" version="1.0.0" contract="checklist-progress@1" theme="checklist"><section-header title="${marker}"/></oven>\\n`,',
    '});',
    'vendor.writeVendoredOven(repo, pkg("Original"));',
    'vendor.writeVendoredOven(replacementRepo, pkg("Replacement"));',
    'const target = vendor.vendoredOvenPath(repo, "sample-oven");',
    'const replacement = vendor.vendoredOvenPath(replacementRepo, "sample-oven");',
    'const instructionsPath = join(target, "instructions.md");',
    'const nativeOpen = fs.openSync;',
    'let swaps = 0;',
    'fs.openSync = (path, ...args) => {',
    '  if (swaps === 0 && resolve(path) === resolve(instructionsPath)) {',
    '    renameSync(target, `${target}.original`);',
    '    renameSync(replacement, target);',
    '    swaps += 1;',
    '  }',
    '  return nativeOpen(path, ...args);',
    '};',
    'syncBuiltinESMExports();',
    'let returned = null;',
    'let error = null;',
    'try { returned = vendor.readVendoredOven(repo, "sample-oven")?.instructions ?? null; } catch (caught) { error = caught.message; }',
    'process.stdout.write(JSON.stringify({ swaps, returned, error }));',
  ].join("\n");
  try {
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      script,
      join(context.repoRoot, ".."),
      new URL("./oven-vendor.mjs", import.meta.url).href,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const boundary = JSON.parse(result.stdout);
    assert.equal(boundary.swaps, 1);
    assert.equal(boundary.returned, null);
    assert.match(boundary.error, /package changed while it was being read/u);
  } finally { context.cleanup(); }
});

test("vendored reads reject leaf symlinks", () => {
  const context = fixture();
  const pkg = source("sample-oven", "1.0.0", "Linked read");
  try {
    writeVendoredOven(context.repoRoot, pkg);
    const outside = join(context.repoRoot, "..", "outside-instructions.md");
    const instructions = join(vendoredOvenPath(context.repoRoot, pkg.id), "instructions.md");
    writeFileSync(outside, pkg.instructions);
    rmSync(instructions);
    symlinkSync(outside, instructions, process.platform === "win32" ? "file" : undefined);
    assert.throws(() => readVendoredOven(context.repoRoot, pkg.id), /symbolic link/u);
  } finally { context.cleanup(); }
});

test("vendored and fallback package reads enforce per-file byte limits", () => {
  const context = fixture();
  const pkg = source("sample-oven", "1.0.0", "Bounded");
  try {
    writeVendoredOven(context.repoRoot, pkg);
    const directory = vendoredOvenPath(context.repoRoot, pkg.id);
    const cases = [
      ["instructions.md", OVEN_INSTRUCTIONS_MAX_BYTES, /Vendored Oven instructions.*byte limit/u],
      [`${pkg.id}.oven`, OVEN_SOURCE_MAX_BYTES, /Vendored Oven source.*byte limit/u],
      ["pin.json", OVEN_PIN_MAX_BYTES, /Vendored Oven pin.*byte limit/u],
    ];
    for (const [name, limit, pattern] of cases) {
      const path = join(directory, name);
      const before = readFileSync(path, "utf8");
      writeFileSync(path, "x".repeat(limit + 1));
      assert.throws(() => readVendoredOven(context.repoRoot, pkg.id), pattern);
      writeFileSync(path, before);
    }
    assert.throws(
      () => writeVendoredOven(context.repoRoot, { ...source("oversized-pin", "1.0.0", "Pin"), source: "x".repeat(OVEN_PIN_MAX_BYTES) }),
      /Vendored Oven pin.*byte limit/u,
    );
    assert.equal(existsSync(vendoredOvenPath(context.repoRoot, "oversized-pin")), false);

    const fallback = source("fallback-oven", "1.0.0", "Fallback");
    writeSource(context.builtInOvensDir, fallback);
    writeFileSync(join(context.builtInOvensDir, fallback.id, "instructions.md"), "x".repeat(OVEN_INSTRUCTIONS_MAX_BYTES + 1));
    assert.throws(() => resolveOvenForRepo({
      repoRoot: context.repoRoot,
      builtInOvensDir: context.builtInOvensDir,
      customOvensDir: context.customOvensDir,
      id: fallback.id,
    }), /Oven instructions.*byte limit/u);
  } finally { context.cleanup(); }
});
