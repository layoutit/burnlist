import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  LIFECYCLES,
  completionDigestMarkdown,
  localIsoTimestamp,
  parsePlan,
  validatePlan,
} from "../server/plan-model.mjs";
import { safeStat } from "../server/fs-safe.mjs";

function lifecycleRoot(repoRoot, lifecycle) {
  return join(repoRoot, "notes", "burnlists", lifecycle.folder);
}

function atomicWrite(path, contents) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, contents);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function validateOrThrow(plan) {
  const errors = validatePlan(plan).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join(" "));
}

export function findBurnlistDir(repoRoot, id) {
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

function lockOwnerIsDead(lock) {
  let pid;
  try {
    pid = Number.parseInt(readFileSync(join(lock, "pid"), "utf8").trim(), 10);
  } catch {
    return false;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

export function withLock(dir, fn) {
  let lockedDir = dir;
  for (;;) {
    const lock = join(lockedDir, ".lock");
    try {
      mkdirSync(lock);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!lockOwnerIsDead(lock)) throw new Error(`${basename(dir)} is busy (locked)`);
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    try {
      writeFileSync(join(lock, "pid"), `${process.pid}\n`);
    } catch (error) {
      rmSync(lock, { recursive: true, force: true });
      throw error;
    }
    break;
  }
  try {
    const movedDir = fn();
    if (typeof movedDir === "string") lockedDir = movedDir;
    return movedDir;
  } finally {
    rmSync(join(lockedDir, ".lock"), { recursive: true, force: true });
  }
}

function appendCompletionDigestIfMissing(plan) {
  if (/^##\s+Completion Digest\b/m.test(plan.markdown)) return false;
  atomicWrite(plan.planPath, `${plan.markdown.replace(/\s*$/u, "")}\n\n${completionDigestMarkdown(plan)}\n`);
  return true;
}

export function moveLifecycle({ repoRoot, id, from, to, gate, beforeMove }) {
  const sourceLifecycle = LIFECYCLES.find((lifecycle) => lifecycle.folder === from);
  const sourceDir = join(lifecycleRoot(repoRoot, sourceLifecycle), id);
  if (!safeStat(sourceDir)?.isDirectory()) {
    const found = findBurnlistDir(repoRoot, id);
    throw new Error(`Burnlist ${id} is not in ${from}; it is in ${found.lifecycle.folder}.`);
  }
  const targetRoot = join(repoRoot, "notes", "burnlists", to);
  const targetDir = join(targetRoot, id);
  return withLock(sourceDir, () => {
    const plan = parsePlan(join(sourceDir, "burnlist.md"));
    validateOrThrow(plan);
    gate(plan);
    if (safeStat(targetDir)) throw new Error(`${id}: target exists`);
    beforeMove?.(plan);
    mkdirSync(targetRoot, { recursive: true });
    if (safeStat(targetDir)) throw new Error(`${id}: target exists`);
    try {
      renameSync(sourceDir, targetDir);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") throw new Error(`${id}: target exists`);
      throw error;
    }
    console.log(`${id}  ${from} -> ${to}`);
    return targetDir;
  });
}

export function readyLifecycle(repoRoot, id) {
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
  });
}

export function startLifecycle(repoRoot, id) {
  return moveLifecycle({ repoRoot, id, from: "ready", to: "inprogress", gate() {} });
}

export function closeLifecycle(repoRoot, id) {
  return moveLifecycle({
    repoRoot,
    id,
    from: "inprogress",
    to: "completed",
    gate(plan) {
      if (plan.items.length || !plan.completed.length) {
        throw new Error("not ready to close: active checklist must be empty with completed entries");
      }
    },
    beforeMove: appendCompletionDigestIfMissing,
  });
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

export function burnItem(repoRoot, id, itemId, check = false) {
  const inprogress = LIFECYCLES.find((lifecycle) => lifecycle.folder === "inprogress");
  const inprogressDir = join(lifecycleRoot(repoRoot, inprogress), id);
  const found = safeStat(inprogressDir)?.isDirectory()
    ? { dir: inprogressDir, lifecycle: inprogress }
    : null;
  if (!found) {
    const located = findBurnlistDir(repoRoot, id);
    throw new Error(`burnlist ${id} is not in inprogress; it is in ${located.lifecycle.folder}`);
  }
  const planPath = join(found.dir, "burnlist.md");
  return withLock(found.dir, () => {
    const plan = parsePlan(planPath);
    validateOrThrow(plan);
    const item = plan.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error(`Active item ${itemId} was not found.`);
    const lines = removeActiveItem(plan.markdown, itemId);
    appendCompleted(lines, `- ${item.id} | ${localIsoTimestamp()} | ${item.title}`);
    atomicWrite(planPath, `${lines.join("\n").replace(/\s*$/u, "")}\n`);
    if (!check) return true;
    const checked = parsePlan(planPath);
    const issues = validatePlan(checked);
    for (const issue of issues) {
      const stream = issue.severity === "error" ? console.error : console.warn;
      stream(`${issue.severity.toUpperCase()}: ${issue.message}`);
    }
    if (issues.some((issue) => issue.severity === "error")) return false;
    console.log(`Burnlist check passed: ${checked.items.length} active, ${checked.completed.length} completed.`);
    return true;
  });
}
