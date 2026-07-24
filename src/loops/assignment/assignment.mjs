import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileLoopPackage } from "../dsl/compile.mjs";
import { findBurnlistDir, withLock } from "../../cli/lifecycle-moves.mjs";
import { assignmentStore } from "./store.mjs";
import { buildAssignment, containsLoopMarker, itemDigest, locateItemSpan, validateAssignedItem } from "./item-metadata.mjs";
import { parseItemRef, parseLoopRef } from "./selectors.mjs";
import { repositoryHazardAuthority } from "./hazards.mjs";

function raw(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fail(message) { throw new Error(`Loop assignment: ${message}`); }
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function atomicWrite(path, bytes) {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`); let fd;
  try { fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o666); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temp, path); syncDirectory(dirname(path)); }
  finally { if (fd !== undefined) closeSync(fd); rmSync(temp, { force: true }); }
}

function packageDirectory(loop) {
  if (loop.name !== "review") fail(`installed Loop ${loop.selector} was not found`);
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../loops/review");
}
export async function resolveBuiltin(loop) {
  const compiled = await compileLoopPackage(packageDirectory(loop));
  if (!compiled.ok) fail(`installed Loop ${loop.selector} does not compile`);
  if (loop.executable && loop.executable !== compiled.revisions.executable) fail("LoopRef executable pin does not match current package");
  return compiled;
}

function planPath(repoRoot, item) {
  const found = findBurnlistDir(repoRoot, item.burnlistId);
  if (found.lifecycle.folder !== "inprogress") fail(`burnlist ${item.burnlistId} is not inprogress`);
  return { directory: found.dir, path: join(found.dir, "burnlist.md") };
}
function assertExpected(expected, whole, span, itemRef) {
  if (!expected?.wholeDigest || !expected?.itemDigest) fail("prepared CAS token is required");
  if (expected.itemDigest !== buildItemDigest(itemRef, span)) fail("item CAS failed");
  if (expected.wholeDigest !== raw(whole)) fail("whole-file CAS failed");
}
function buildItemDigest(itemRef, span) { return itemDigest(itemRef, span); }
function assertHazards(authority, input) {
  const hazards = authority(input);
  if (!Array.isArray(hazards)) fail("hazard authority returned invalid result");
  if (hazards.length) fail(`unsafe while ${hazards.join(", ")}`);
}

/** Snapshot before source resolution; the locked mutation compares both bytes. */
export function prepareItemMutation({ repoRoot, itemRef }) {
  const item = parseItemRef(itemRef), target = planPath(repoRoot, item);
  const whole = readFileSync(target.path), located = locateItemSpan(whole, item.itemId);
  return { item, target, wholeDigest: raw(whole), itemDigest: itemDigest(item.selector, located.span) };
}

/** CLI-owned assignment: artifact first, then exactly one locked plan rewrite. */
export async function assignLoopItem({ repoRoot, itemRef, loopRef, prepared, store = assignmentStore(repoRoot) }) {
  const item = parseItemRef(itemRef), loop = parseLoopRef(loopRef);
  const token = prepared ?? prepareItemMutation({ repoRoot, itemRef: item.selector });
  if (token.item?.selector !== item.selector) fail("prepared token item does not match");
  const compiled = await resolveBuiltin(loop);
  const target = planPath(repoRoot, item); const canonicalSelector = loop.selector;
  return withLock(target.directory, () => {
    const whole = readFileSync(target.path); const located = locateItemSpan(whole, item.itemId);
    assertExpected(token, whole, located.span, item.selector);
    if (containsLoopMarker(located)) fail("duplicate, malformed, or handwritten Loop metadata");
    const assignment = buildAssignment(item.selector, located, {
      selector: canonicalSelector, executable: compiled.revisions.executable, packageRevision: compiled.revisions.package,
    });
    const after = Buffer.concat([whole.subarray(0, located.startByte), assignment.assignedSpan, whole.subarray(located.endByte)]);
    store.save({ assignmentId: assignment.assignmentId, itemRef: item.selector, selector: canonicalSelector,
      executionRevision: compiled.revisions.executable, packageRevision: compiled.revisions.package,
      sourceRevision: compiled.revisions.source, unassignedItemDigest: assignment.unassignedDigest,
      assignedItemDigest: assignment.assignedDigest }, compiled);
    atomicWrite(target.path, after);
    return { assignmentId: assignment.assignmentId, selector: canonicalSelector, executionRevision: compiled.revisions.executable,
      packageRevision: compiled.revisions.package, unassignedItemDigest: assignment.unassignedDigest, assignedItemDigest: assignment.assignedDigest };
  });
}

/** Remove only a verified canonical block after a caller proves there are no Run hazards. */
export function unassignLoopItem({ repoRoot, itemRef, prepared, hazardAuthority = repositoryHazardAuthority(repoRoot), store = assignmentStore(repoRoot) }) {
  const item = parseItemRef(itemRef), token = prepared ?? prepareItemMutation({ repoRoot, itemRef: item.selector }); const target = planPath(repoRoot, item);
  if (token.item?.selector !== item.selector) fail("prepared token item does not match");
  return withLock(target.directory, () => {
    const whole = readFileSync(target.path), located = locateItemSpan(whole, item.itemId);
    assertExpected(token, whole, located.span, item.selector);
    const assignment = validateAssignedItem(item.selector, located);
    const artifact = store.load(assignment["Assignment-Id"]);
    if (artifact.itemRef !== item.selector || artifact.assignedItemDigest !== assignment.assignedDigest || artifact.unassignedItemDigest !== assignment.unassignedDigest || artifact.packageRevision !== assignment["Package-Revision"]) fail("stale assignment artifact");
    assertHazards(hazardAuthority, { repoRoot, itemRef: item.selector, assignmentId: assignment["Assignment-Id"], action: "unassign" });
    const after = Buffer.concat([whole.subarray(0, located.startByte), assignment.unassignedSpan, whole.subarray(located.endByte)]);
    atomicWrite(target.path, after);
    return { assignmentId: assignment["Assignment-Id"], unassignedItemDigest: assignment.unassignedDigest };
  });
}

/** Shared legacy gate. Terminal history alone is deliberately not a hazard. */
export function assertDirectBurnAllowed({ repoRoot, itemRef, markdown, hazardAuthority = repositoryHazardAuthority(repoRoot) }) {
  const item = parseItemRef(itemRef); const located = locateItemSpan(markdown, item.itemId);
  if (containsLoopMarker(located)) fail("direct burn is blocked by Loop metadata");
  assertHazards(hazardAuthority, { repoRoot, itemRef: item.selector, assignmentId: null, action: "burn" });
  return located;
}
