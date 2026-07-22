import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { readOvenEvents } from "../events/oven-event-store.mjs";
import { normalizeOvenPackage, ovenRevision } from "../ovens/oven-contract.mjs";

const packageRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(packageRoot, "bin", "burnlist.mjs");
const builtInId = "checklist";
const builtInPath = join(packageRoot, "ovens", builtInId);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-vendor-cli-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return { repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runResult(context, ...args) {
  return spawnSync(process.execPath, [binPath, ...args], { cwd: context.repo, encoding: "utf8" });
}

function run(context, ...args) {
  const result = runResult(context, ...args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function shippedSource() {
  return {
    id: builtInId,
    instructions: readFileSync(join(builtInPath, "instructions.md"), "utf8"),
    oven: readFileSync(join(builtInPath, `${builtInId}.oven`), "utf8"),
  };
}

function vendoredPath(context) {
  return join(context.repo, ".burnlist", "ovens", builtInId);
}

function readPin(context) {
  return JSON.parse(readFileSync(join(vendoredPath(context), "pin.json"), "utf8"));
}

function assertValidPin(pin, pkg) {
  const normalized = normalizeOvenPackage(pkg);
  assert.deepEqual(Object.keys(pin).sort(), ["id", "pinnedAt", "revision", "source", "version"]);
  assert.equal(pin.id, builtInId);
  assert.equal(pin.version, normalized.version);
  assert.equal(pin.revision, ovenRevision(pkg));
  assert.equal(pin.source, "built-in");
  assert.equal(new Date(pin.pinnedAt).toISOString(), pin.pinnedAt);
}

test("oven adopt copies a shipped built-in into a repo with a valid pin", () => {
  const context = fixture();
  const shipped = shippedSource();
  try {
    const output = run(context, "oven", "adopt", builtInId, "--repo", context.repo);
    const directory = vendoredPath(context);
    const pin = readPin(context);
    assert.deepEqual(readdirSync(directory).sort(), [`${builtInId}.oven`, "instructions.md", "pin.json"]);
    assert.equal(readFileSync(join(directory, "instructions.md"), "utf8"), shipped.instructions);
    assert.equal(readFileSync(join(directory, `${builtInId}.oven`), "utf8"), shipped.oven);
    assertValidPin(pin, shipped);
    assert.match(output, /Adopted Oven checklist/u);
    assert.ok(output.includes(directory));
    assert.ok(output.includes(`${builtInId}@${pin.version}`));
    assert.deepEqual(readOvenEvents(context.repo, { ovenIds: [builtInId] }).map((event) => event.payload.action), ["adopted"]);
  } finally { context.cleanup(); }
});

test("oven adopt rejects unknown and existing pins unless forced", () => {
  const context = fixture();
  try {
    const unknown = runResult(context, "oven", "adopt", "not-shipped", "--repo", context.repo);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /(?:not|unknown).{0,40}shipped built-in/iu);

    run(context, "oven", "adopt", builtInId, "--repo", context.repo);
    const duplicate = runResult(context, "oven", "adopt", builtInId, "--repo", context.repo);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /already (?:vendored|adopted)/iu);
    assert.match(run(context, "oven", "adopt", builtInId, "--repo", context.repo, "--force"), /Adopted Oven checklist/u);
  } finally { context.cleanup(); }
});

test("an adopted package is a complete standalone byte copy", () => {
  const context = fixture();
  const shipped = shippedSource();
  try {
    run(context, "oven", "adopt", builtInId, "--repo", context.repo);
    const directory = vendoredPath(context);
    const ovenBytes = readFileSync(join(directory, `${builtInId}.oven`));
    const instructionsBytes = readFileSync(join(directory, "instructions.md"));
    const pinBytes = readFileSync(join(directory, "pin.json"));
    assert.deepEqual(ovenBytes, readFileSync(join(builtInPath, `${builtInId}.oven`)));
    assert.deepEqual(instructionsBytes, readFileSync(join(builtInPath, "instructions.md")));
    assertValidPin(JSON.parse(pinBytes), shipped);
    const directoryStat = lstatSync(directory);
    assert.equal(directoryStat.isDirectory(), true);
    assert.equal(directoryStat.isSymbolicLink(), false);
    for (const name of [`${builtInId}.oven`, "instructions.md", "pin.json"]) {
      const stat = lstatSync(join(directory, name));
      assert.equal(stat.isFile(), true);
      assert.equal(stat.isSymbolicLink(), false);
    }
    assert.deepEqual(readFileSync(join(directory, `${builtInId}.oven`)), ovenBytes);
    assert.deepEqual(readFileSync(join(directory, "pin.json")), pinBytes);
  } finally { context.cleanup(); }
});

test("oven upgrade is opt-in and re-copies the shipped source after adoption", async () => {
  const context = fixture();
  const shipped = shippedSource();
  try {
    const missing = runResult(context, "oven", "upgrade", builtInId, "--repo", context.repo);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /(?:not adopted|adopt.{0,20}first)/iu);

    run(context, "oven", "adopt", builtInId, "--repo", context.repo);
    const before = readPin(context);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    const output = run(context, "oven", "upgrade", builtInId, "--repo", context.repo);
    const after = readPin(context);
    assertValidPin(after, shipped);
    assert.notEqual(after.pinnedAt, before.pinnedAt);
    assert.equal(readFileSync(join(vendoredPath(context), "instructions.md"), "utf8"), shipped.instructions);
    assert.equal(readFileSync(join(vendoredPath(context), `${builtInId}.oven`), "utf8"), shipped.oven);
    assert.match(output, /Upgraded Oven checklist/u);
    assert.ok(output.includes(vendoredPath(context)));
    assert.ok(output.includes(`${builtInId}@${after.version}`));
    assert.ok(output.includes(after.revision));
    assert.deepEqual(readOvenEvents(context.repo, { ovenIds: [builtInId] }).map((event) => event.payload.action), [
      "adopted",
      "upgraded",
    ]);
  } finally { context.cleanup(); }
});

test("adopted oven files are not ignored by Git", () => {
  const context = fixture();
  try {
    run(context, "oven", "adopt", builtInId, "--repo", context.repo);
    const pinPath = join(".burnlist", "ovens", builtInId, "pin.json");
    const ignored = spawnSync("git", ["check-ignore", "--", pinPath], { cwd: context.repo, encoding: "utf8" });
    assert.equal(ignored.status, 1, `${ignored.stdout}${ignored.stderr}`);
  } finally { context.cleanup(); }
});
