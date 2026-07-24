import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { checklistCompletion, findBurnlistDir, withLock } from "../../cli/lifecycle-moves.mjs";
import { localIsoTimestamp, parsePlan, validatePlan } from "../../server/plan-model.mjs";
import { publishOvenEvent } from "../../events/oven-event-store.mjs";
import { assignmentStore } from "../assignment/store.mjs";
import { locateItemSpan, validateAssignedItem } from "../assignment/item-metadata.mjs";
import { parseItemRef } from "../assignment/selectors.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { runStore } from "../run/run-store.mjs";

const RECEIPT = "completion-receipt.json", INTENT = "completion-intent.json";
const SHA = /^[a-f0-9]{64}$/u, RUN = /^run:[0-9a-z]{26}$/u, ASSIGNMENT = /^as1-sha256:[a-f0-9]{64}$/u;
const ITEM = /^item:[0-9]{6}-[0-9]{3}#[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;
function fail(message, code = "ELOOP_COMPLETION") { throw Object.assign(new Error(`Loop completion: ${message}`), { code }); }
function exact(value, keys) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key, index) => Object.keys(value)[index] === key); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function lifecycleIdentity(repoRoot, id, directory, expected = null) {
  const root = resolve(repoRoot), paths = [join(root, "notes"), join(root, "notes", "burnlists"), join(root, "notes", "burnlists", "inprogress"), join(root, "notes", "burnlists", "inprogress", id)];
  if (resolve(directory) !== paths.at(-1)) fail("lifecycle directory escapes the repository", "ELOOP_LIFECYCLE_PATH");
  const identities = paths.map((path) => { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) fail("lifecycle path is not a real directory", "ELOOP_LIFECYCLE_PATH"); return { path, dev: stat.dev, ino: stat.ino }; });
  if (expected && identities.some((value, index) => value.dev !== expected[index].dev || value.ino !== expected[index].ino)) fail("lifecycle path changed during completion", "ELOOP_LIFECYCLE_PATH");
  return identities;
}
function atomicWrite(path, bytes) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`); let fd;
  try { fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, path); syncDirectory(dirname(path)); }
  finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
}
function atomicPlanWrite(path, bytes) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`); let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o666); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    const staged = parsePlan(temporary); validateOrThrow(staged); renameSync(temporary, path); syncDirectory(dirname(path)); return staged;
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
}
function readCanonical(path, label) {
  let stat; try { stat = lstatSync(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 8192) fail(`${label} is corrupt`);
  const bytes = readFileSync(path); let value; try { value = JSON.parse(bytes); } catch { fail(`${label} is corrupt`); }
  if (!Buffer.from(`${JSON.stringify(value)}\n`).equals(bytes)) fail(`${label} is not canonical`); return value;
}
function validRecord(value, label) {
  const keys = ["schema", "runId", "itemRef", "assignmentId", "completedAt", "title", "planDigest"];
  if (!exact(value, keys) || value.schema !== "burnlist-loop-completion@1" || !RUN.test(value.runId) || !ITEM.test(value.itemRef) || !ASSIGNMENT.test(value.assignmentId) || !ISO.test(value.completedAt) || typeof value.title !== "string" || !value.title || Buffer.byteLength(value.title) > 4096 || !SHA.test(value.planDigest)) fail(`${label} is invalid`);
  return Object.freeze({ ...value });
}
function entryFor(record) { return `- ${parseItemRef(record.itemRef).itemId} | ${record.completedAt} | ${record.title}`; }
function activeRange(lines) { const start = lines.findIndex((line) => line.trim() === "## Active Checklist"); if (start < 0) fail("active checklist section is missing"); const end = lines.findIndex((line, index) => index > start && /^##\s+/u.test(line)); return { start, end: end < 0 ? lines.length : end }; }
function itemIdFor(line) { return line.match(/^- \[[ xX]\]\s+([^|]+?)(?:\s+\|\s+.+)?$/u)?.[1]?.trim() ?? null; }
function removeDetailBlock(lines, itemId) {
  const { start, end } = activeRange(lines), escaped = itemId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), heading = new RegExp(`^###\\s+${escaped}(?:\\s*\\||\\s*$)`, "u");
  const at = lines.findIndex((line, index) => index > start && index < end && heading.test(line)); if (at < 0) return;
  const next = lines.findIndex((line, index) => index > at && /^#{1,3}\s+/u.test(line)); lines.splice(at, (next < 0 ? end : next) - at);
}
function completedMarkdown(markdown, record) {
  const itemId = parseItemRef(record.itemRef).itemId, lines = markdown.split(/\r?\n/u), { start, end } = activeRange(lines);
  const at = lines.findIndex((line, index) => index > start && index < end && itemIdFor(line) === itemId); if (at < 0) fail(`active item ${itemId} was not found`);
  const next = lines.findIndex((line, index) => index > at && index < end && itemIdFor(line)); lines.splice(at, (next < 0 ? end : next) - at); removeDetailBlock(lines, itemId);
  const heading = lines.findIndex((line) => line.trim() === "## Completed");
  if (heading < 0) { while (lines.length && !lines.at(-1).trim()) lines.pop(); lines.push("", "## Completed", entryFor(record), ""); }
  else { const after = lines.findIndex((line, index) => index > heading && /^##\s+/u.test(line)); lines.splice(after < 0 ? lines.length : after, 0, entryFor(record)); }
  return `${lines.join("\n").replace(/\s*$/u, "")}\n`;
}
function validateOrThrow(plan) { const errors = validatePlan(plan).filter((issue) => issue.severity === "error"); if (errors.length) fail(errors.map((issue) => issue.message).join(" ")); }
function assertApplied(plan, record) {
  const itemId = parseItemRef(record.itemRef).itemId;
  if (plan.items.some((item) => item.id === itemId)) fail("receipt conflicts with an active item");
  const completed = plan.completed.filter((item) => item.id === itemId && item.completedAt === record.completedAt && item.title === record.title);
  if (completed.length !== 1) fail("receipt does not match the current Burnlist");
}
function assertCurrentAssignment({ repoRoot, planBytes, plan, authority, replay, store }) {
  if (replay.projection.state !== "converged" || replay.projection.leaseHeld) fail("Run is not converged and idle", "ERUN_NOT_CONVERGED");
  if (replay.projection.itemRef !== authority.itemRef || authority.runId !== replay.projection.runId) fail("Run authority does not match its journal");
  const current = store.readCurrentRun?.(authority.itemRef);
  if (!current || current.runId !== replay.projection.runId || current.assignmentId !== authority.assignmentId) fail("Run is superseded or not current for its assigned item", "ESTALE_RUN");
  const item = parseItemRef(authority.itemRef); let metadata, artifact;
  try { metadata = validateAssignedItem(item.selector, locateItemSpan(planBytes, item.itemId)); artifact = assignmentStore(repoRoot).load(metadata["Assignment-Id"]); }
  catch { fail("assigned item no longer matches the Run", "ESTALE_ASSIGNMENT"); }
  if (metadata["Assignment-Id"] !== authority.assignmentId || artifact.assignmentId !== authority.assignmentId || artifact.itemRef !== authority.itemRef || artifact.assignedItemDigest !== authority.itemRevision || metadata.assignedDigest !== authority.itemRevision || artifact.executionRevision !== metadata["Execution-Revision"] || artifact.packageRevision !== metadata["Package-Revision"]) fail("assigned item no longer matches the Run", "ESTALE_ASSIGNMENT");
  const frozen = loadFrozenRecipe(Buffer.from(authority.frozenRecipe, "base64")); if (JSON.stringify(frozen.ir) !== JSON.stringify(replay.graph)) fail("Run graph does not match its sealed assignment");
  return { item, title: plan.items.find((entry) => entry.id === item.itemId)?.title };
}
function assertAuthority(authority, runId) {
  if (!authority || authority.schema !== "burnlist-loop-m12-run-authority@1" || authority.runId !== runId || !ITEM.test(authority.itemRef) || !ASSIGNMENT.test(authority.assignmentId) || !/^id1-sha256:[a-f0-9]{64}$/u.test(authority.itemRevision)) fail("sealed Run authority is unavailable"); return authority;
}
function recordFor({ authority, completedAt, title, planDigest }) { return Object.freeze({ schema: "burnlist-loop-completion@1", runId: authority.runId, itemRef: authority.itemRef, assignmentId: authority.assignmentId, completedAt, title, planDigest }); }
function publish(repoRoot, outcome) { if (!outcome.applied) return; try { publishOvenEvent(repoRoot, outcome.event); } catch (error) { console.warn(`Completed ${outcome.item.id}, but could not publish its observational Oven event: ${error.message}`); } }

/** Complete exactly the sealed, converged Run under the normal lifecycle lock. */
export function completeLoopRun({ repoRoot, runId, store = runStore(repoRoot), hooks = {} }) {
  if (!RUN.test(runId) || !store?.read || !store?.readAuthority || !store?.readCurrentRun || !store?.paths?.pathFor) fail("invalid completion input");
  const replay = store.read(runId), authority = assertAuthority(store.readAuthority(runId), runId), item = parseItemRef(authority.itemRef), found = findBurnlistDir(repoRoot, item.burnlistId);
  if (found.lifecycle.folder !== "inprogress") fail(`Burnlist ${item.burnlistId} is not inprogress`);
  const lifecycle = lifecycleIdentity(repoRoot, item.burnlistId, found.dir);
  const result = withLock(found.dir, () => {
    lifecycleIdentity(repoRoot, item.burnlistId, found.dir, lifecycle);
    const planPath = join(found.dir, "burnlist.md"), runDir = store.paths.pathFor(runId), receiptPath = join(runDir, RECEIPT), intentPath = join(runDir, INTENT), bytes = readFileSync(planPath), plan = parsePlan(planPath);
    validateOrThrow(plan); const receipt = readCanonical(receiptPath, "completion receipt");
    if (receipt) {
      const applied = validRecord(receipt, "completion receipt");
      if (applied.runId !== runId || applied.itemRef !== authority.itemRef || applied.assignmentId !== authority.assignmentId) fail("receipt belongs to another Run");
      assertApplied(plan, applied);
      const pending = readCanonical(intentPath, "completion intent");
      if (pending) {
        const intent = validRecord(pending, "completion intent");
        if (JSON.stringify(intent) !== JSON.stringify(applied)) fail("completion intent conflicts with its receipt");
        rmSync(intentPath, { force: true }); syncDirectory(runDir);
      }
      return { applied: false, item: plan.completed.find((entry) => entry.id === item.itemId), record: applied, event: null };
    }
    let record = readCanonical(intentPath, "completion intent");
    if (record) { record = validRecord(record, "completion intent"); if (record.runId !== runId || record.itemRef !== authority.itemRef || record.assignmentId !== authority.assignmentId) fail("completion intent belongs to another Run"); const completed = plan.completed.filter((entry) => entry.id === item.itemId && entry.completedAt === record.completedAt && entry.title === record.title); if (completed.length === 1) { atomicWrite(receiptPath, Buffer.from(`${JSON.stringify(record)}\n`)); rmSync(intentPath, { force: true }); syncDirectory(runDir); return { applied: false, item: completed[0], record, event: null }; } }
    const current = assertCurrentAssignment({ repoRoot, planBytes: bytes, plan, authority, replay, store }); if (!current.title) fail("Run item title is unavailable");
    const completedAt = record?.completedAt ?? localIsoTimestamp(), provisional = recordFor({ authority, completedAt, title: current.title, planDigest: "0".repeat(64) }), next = completedMarkdown(plan.markdown, provisional);
    record = recordFor({ authority, completedAt, title: current.title, planDigest: digest(Buffer.from(next)) });
    const existingIntent = readCanonical(intentPath, "completion intent");
    if (existingIntent && validRecord(existingIntent, "completion intent").planDigest !== record.planDigest) fail("completion intent no longer matches the active Burnlist", "ESTALE_INTENT");
    if (!existingIntent) { atomicWrite(intentPath, Buffer.from(`${JSON.stringify(record)}\n`)); hooks.afterIntent?.(record); }
    lifecycleIdentity(repoRoot, item.burnlistId, found.dir, lifecycle); const staged = atomicPlanWrite(planPath, Buffer.from(next)); hooks.afterPlan?.(record); atomicWrite(receiptPath, Buffer.from(`${JSON.stringify(record)}\n`)); hooks.afterReceipt?.(record); rmSync(intentPath, { force: true }); syncDirectory(runDir);
    return { applied: true, item: { id: item.itemId, title: current.title }, record, event: checklistCompletion(item.burnlistId, { id: item.itemId, title: current.title }, record.completedAt, staged) };
  });
  publish(repoRoot, result); return Object.freeze({ runId, itemRef: authority.itemRef, assignmentId: authority.assignmentId, completedAt: result.record.completedAt, alreadyApplied: !result.applied });
}
