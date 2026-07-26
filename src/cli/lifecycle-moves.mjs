import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  LIFECYCLES,
  completionDigestMarkdown,
  localIsoTimestamp,
  parsePlan,
  validatePlan,
} from "../server/plan-model.mjs";
import { safeStat, withLock } from "../server/fs-safe.mjs";
import { publishOvenEvent } from "../events/oven-event-store.mjs";
import {
  ovenLifecycleChangedInput,
  publishCanonicalMutation,
} from "../events/oven-canonical-mutations.mjs";
import { assertDirectBurnAllowed } from "../loops/assignment/assignment.mjs";

export { withLock } from "../server/fs-safe.mjs";

function lifecycleRoot(repoRoot, lifecycle) {
  return join(repoRoot, "notes", "burnlists", lifecycle.folder);
}

function atomicWrite(path, contents) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o666);
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, constants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function fsyncFile(path) {
  const descriptor = openSync(path, constants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function validateOrThrow(plan) {
  const issues = validatePlan(plan);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join(" "));
  return issues;
}

export function assertValidBurnlistId(id) {
  if (typeof id !== "string" || !/^\d{6}-\d{3}$/u.test(id) || id.includes("/") || id.includes("..")) {
    throw new Error(`Invalid Burnlist id: ${id}`);
  }
  return id;
}

export function findBurnlistDir(repoRoot, id) {
  assertValidBurnlistId(id);
  const matches = LIFECYCLES.flatMap((lifecycle) => {
    const dir = join(lifecycleRoot(repoRoot, lifecycle), id);
    return safeStat(dir)?.isDirectory() ? [{ dir, lifecycle }] : [];
  });
  if (!matches.length) throw new Error(`Burnlist ${id} was not found in ${repoRoot}.`);
  if (matches.length > 1) {
    throw new Error(`Burnlist ${id} is ambiguous across ${matches.map((match) => match.lifecycle.folder).join(", ")}.`);
  }
  return matches[0];
}

function appendCompletionDigestIfMissing(plan) {
  if (/^##\s+Completion Digest\b/m.test(plan.markdown)) return false;
  atomicWrite(plan.planPath, `${plan.markdown.replace(/\s*$/u, "")}\n\n${completionDigestMarkdown(plan)}\n`);
  return true;
}

function targetExists(id) {
  return new Error(`${id}: target exists`);
}

function reclaimEmptyTarget(targetDir, id) {
  try {
    rmdirSync(targetDir);
    return;
  } catch (error) {
    if (error?.code === "ENOENT") return;
    if (error?.code === "ENOTEMPTY") throw targetExists(id);
    throw error;
  }
}

function lifecycleEventError(id, from, to, error) {
  console.warn(`Moved Burnlist ${id} from ${from} to ${to}, but could not publish its observational Oven event: ${error.message}`);
}

export function publishLifecycleChange(repoRoot, id, from, to, {
  occurredAt = localIsoTimestamp(),
  publishEvent,
  onError = (error) => lifecycleEventError(id, from, to, error),
} = {}) {
  return publishCanonicalMutation(repoRoot, ovenLifecycleChangedInput({
    burnlistId: id, from, to, occurredAt,
  }), { ...(publishEvent ? { publishEvent } : {}), onError });
}

export function moveLifecycle({ repoRoot, id, from, to, gate, afterMove, eventOptions }) {
  assertValidBurnlistId(id);
  const sourceLifecycle = LIFECYCLES.find((lifecycle) => lifecycle.folder === from);
  const sourceDir = join(lifecycleRoot(repoRoot, sourceLifecycle), id);
  if (!safeStat(sourceDir)?.isDirectory()) {
    const found = findBurnlistDir(repoRoot, id);
    throw new Error(`Burnlist ${id} is not in ${from}; it is in ${found.lifecycle.folder}.`);
  }
  const targetRoot = join(repoRoot, "notes", "burnlists", to);
  const targetDir = join(targetRoot, id);
  const result = withLock(sourceDir, ({ retarget }) => {
    const plan = parsePlan(join(sourceDir, "burnlist.md"));
    validateOrThrow(plan);
    gate(plan);
    mkdirSync(targetRoot, { recursive: true });
    reclaimEmptyTarget(targetDir, id);
    renameSync(sourceDir, targetDir);
    try {
      afterMove?.(parsePlan(join(targetDir, "burnlist.md")));
    } catch (error) {
      renameSync(targetDir, sourceDir);
      throw error;
    }
    retarget(targetDir);
    console.log(`${id}  ${from} -> ${to}`);
    return targetDir;
  });
  publishLifecycleChange(repoRoot, id, from, to, eventOptions);
  return result;
}

export function readyLifecycle(repoRoot, id, eventOptions) {
  return moveLifecycle({
    repoRoot,
    id,
    from: "draft",
    to: "ready",
    gate(plan) {
      const goalPath = join(dirname(plan.planPath), "goal.md");
      if (!safeStat(goalPath)?.isFile() || !readFileSync(goalPath, "utf8").trim()) {
        throw new Error("not ready: goal.md is missing");
      }
      const contentful = plan.items.some((item) => item.id.trim() || item.title.trim());
      if (!contentful) throw new Error("not ready: active checklist is empty");
    },
    eventOptions,
  });
}

export function startLifecycle(repoRoot, id, eventOptions) {
  return moveLifecycle({ repoRoot, id, from: "ready", to: "inprogress", gate() {}, eventOptions });
}

export function closeLifecycle(repoRoot, id, eventOptions) {
  assertValidBurnlistId(id);
  assertNoPendingLoopCompletion(repoRoot, id);
  const inprogressDir = join(repoRoot, "notes", "burnlists", "inprogress", id);
  const completedDir = join(repoRoot, "notes", "burnlists", "completed", id);
  if (!safeStat(inprogressDir)?.isDirectory() && safeStat(completedDir)?.isDirectory()) {
    const result = withLock(completedDir, () => {
      const plan = parsePlan(join(completedDir, "burnlist.md"));
      validateOrThrow(plan);
      assertCloseGate(plan);
      const repaired = appendCompletionDigestIfMissing(plan);
      console.log(repaired ? `${id} completed (digest repaired)` : `${id} already completed`);
      return completedDir;
    });
    publishLifecycleChange(repoRoot, id, "inprogress", "completed", eventOptions);
    return result;
  }
  return moveLifecycle({
    repoRoot,
    id,
    from: "inprogress",
    to: "completed",
    gate: assertCloseGate,
    afterMove: appendCompletionDigestIfMissing,
    eventOptions,
  });
}

// Completion publishes an intent before it rewrites the shrinking plan.  Do
// not move that plan out from under a recoverable intent: the retry owns the
// receipt and is the only writer that may clear it.
function assertNoPendingLoopCompletion(repoRoot, id) {
  const runs = join(repoRoot, ".local", "burnlist", "loop", "m2", "runs");
  if (!safeStat(runs)?.isDirectory()) return;
  for (const entry of readdirSync(runs, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]+$/u.test(entry.name)) continue;
    const intent = join(runs, entry.name, "completion-intent.json"), stat = safeStat(intent);
    if (!stat?.isFile() || stat.size < 2 || stat.size > 8192) continue;
    try {
      const value = JSON.parse(readFileSync(intent, "utf8"));
      if (typeof value?.itemRef === "string" && value.itemRef.startsWith(`item:${id}#`))
        throw new Error(`not ready to close: pending Loop completion for ${value.itemRef}`);
    } catch (error) {
      if (error?.message?.startsWith("not ready to close:")) throw error;
      // A corrupt unrelated scratch record cannot be interpreted as a safe
      // absence.  It is conservative only for the lifecycle being closed.
      throw new Error("not ready to close: pending Loop completion is unreadable");
    }
  }
}

function assertCloseGate(plan) {
  if (plan.items.length || !plan.completed.length) {
    throw new Error("not ready to close: active checklist must be empty with completed entries");
  }
}

function activeRange(lines) {
  const start = lines.findIndex((line) => line.trim() === "## Active Checklist");
  if (start < 0) throw new Error("Missing ## Active Checklist section.");
  const end = lines.findIndex((line, index) => index > start && /^##\s+/u.test(line));
  return { start, end: end < 0 ? lines.length : end };
}

function activeItemId(line) {
  return line.match(/^- \[[ xX]\]\s+([^|]+?)(?:\s+\|\s+.+)?$/u)?.[1]?.trim() ?? null;
}

function removeDetailBlock(lines, itemId) {
  const { start, end } = activeRange(lines);
  const heading = new RegExp(`^###\\s+${itemId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\s*\\||\\s*$)`, "u");
  const detailStart = lines.findIndex((line, index) => index > start && index < end && heading.test(line));
  if (detailStart < 0) return;
  const detailEnd = lines.findIndex((line, index) => index > detailStart && /^#{1,3}\s+/u.test(line));
  lines.splice(detailStart, (detailEnd < 0 ? end : detailEnd) - detailStart);
}

function removeActiveItem(markdown, itemId) {
  const lines = markdown.split(/\r?\n/u);
  const { start, end } = activeRange(lines);
  const itemLine = lines.findIndex((line, index) => index > start && index < end && activeItemId(line) === itemId);
  if (itemLine < 0) throw new Error(`Active item ${itemId} was not found.`);
  const nextItem = lines.findIndex((line, index) => index > itemLine && index < end && activeItemId(line));
  lines.splice(itemLine, (nextItem < 0 ? end : nextItem) - itemLine);
  removeDetailBlock(lines, itemId);
  return lines;
}

function appendCompleted(lines, entry) {
  const heading = lines.findIndex((line) => line.trim() === "## Completed");
  if (heading < 0) {
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    lines.push("", "## Completed", entry, "");
    return;
  }
  const end = lines.findIndex((line, index) => index > heading && /^##\s+/u.test(line));
  lines.splice(end < 0 ? lines.length : end, 0, entry);
}

export function checklistCompletion(id, item, completedAt, plan) {
  const total = plan.items.length + plan.completed.length;
  return {
    ovenId: "checklist",
    subjectId: id,
    kind: "item-burned",
    phase: "completed",
    cursor: `${id}:${item.id}:${completedAt}`,
    occurredAt: completedAt,
    payload: {
      itemId: item.id,
      title: item.title,
      done: plan.completed.length,
      remaining: plan.items.length,
      total,
      percent: total ? Math.round((plan.completed.length / total) * 100) : 100,
    },
  };
}

function printBurnCheck(plan, issues) {
  for (const issue of issues) {
    const stream = issue.severity === "error" ? console.error : console.warn;
    stream(`${issue.severity.toUpperCase()}: ${issue.message}`);
  }
  console.log(`Burnlist check passed: ${plan.items.length} active, ${plan.completed.length} completed.`);
}

export function burnItem(repoRoot, id, itemId, check = false, { hazardAuthority, completedAt: requestedCompletedAt } = {}) {
  assertValidBurnlistId(id);
  const found = findBurnlistDir(repoRoot, id);
  if (found.lifecycle.folder !== "inprogress") {
    throw new Error(`burnlist ${id} is not in inprogress; it is in ${found.lifecycle.folder}`);
  }
  const planPath = join(found.dir, "burnlist.md");
  const completion = withLock(found.dir, () => {
    const plan = parsePlan(planPath);
    const currentIssues = validateOrThrow(plan);
    const item = plan.items.find((entry) => entry.id === itemId);
    if (!item) {
      const completed = plan.completed.find((entry) => entry.id === itemId);
      if (!completed) throw new Error(`Active item ${itemId} was not found.`);
      fsyncFile(planPath);
      fsyncDirectory(dirname(planPath));
      if (check) printBurnCheck(plan, currentIssues);
      return checklistCompletion(id, completed, completed.completedAt, plan);
    }
    // Direct lifecycle burns intentionally remain unchanged for unassigned
    // items, but must never bypass any Loop-shaped metadata.
    assertDirectBurnAllowed({ repoRoot, itemRef: `item:${id}#${itemId}`, markdown: plan.markdown, hazardAuthority });
    const lines = removeActiveItem(plan.markdown, itemId);
    const completedAt = requestedCompletedAt ?? localIsoTimestamp();
    appendCompleted(lines, `- ${item.id} | ${completedAt} | ${item.title}`);
    const nextMarkdown = `${lines.join("\n").replace(/\s*$/u, "")}\n`;
    const temporary = join(dirname(planPath), `.${basename(planPath)}.${randomBytes(8).toString("hex")}.tmp`);
    let checked;
    try {
      const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o666);
      try {
        writeFileSync(descriptor, nextMarkdown);
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      checked = parsePlan(temporary);
      const issues = validateOrThrow(checked);
      renameSync(temporary, planPath);
      fsyncDirectory(dirname(planPath));
      checked = { plan: checked, issues };
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    if (check) printBurnCheck(checked.plan, checked.issues);
    return checklistCompletion(id, item, completedAt, checked.plan);
  });
  try { publishOvenEvent(repoRoot, completion); }
  catch (error) { console.warn(`Burned ${itemId}, but could not publish its observational Oven event: ${error.message}`); }
  return true;
}
