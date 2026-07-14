import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
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

function isPositivePid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function lockOwner(lockPath) {
  const owner = readLock(lockPath);
  return isPositivePid(owner?.pid) && typeof owner.token === "string" && owner.token ? owner : null;
}

function pidIsDead(pid) {
  if (!isPositivePid(pid)) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

export function withLock(dir, fn) {
  let lockedDir = dir;
  const token = randomBytes(16).toString("hex");
  const lockPath = join(lockedDir, ".lock");
  const temporary = join(lockedDir, `.lock.${token}.tmp`);
  const busy = () => new Error(`${basename(dir)} is busy (locked)`);
  try {
    writeFileSync(temporary, JSON.stringify({ token, pid: process.pid }));
    try {
      linkSync(temporary, lockPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = lockOwner(lockPath);
      if (!owner || !pidIsDead(owner.pid)) throw busy();
      const claim = `${lockPath}.claim.${token}`;
      try {
        renameSync(lockPath, claim);
      } catch (takeoverError) {
        if (takeoverError?.code === "ENOENT") throw busy();
        throw takeoverError;
      }
      try {
        rmSync(claim, { force: true });
        linkSync(temporary, lockPath);
      } catch (takeoverError) {
        if (takeoverError?.code === "EEXIST") throw busy();
        throw takeoverError;
      }
    }
  } finally {
    rmSync(temporary, { force: true });
  }
  try {
    const movedDir = fn({
      retarget(movedDir) {
        if (typeof movedDir === "string") lockedDir = movedDir;
      },
    });
    if (typeof movedDir === "string") lockedDir = movedDir;
    return movedDir;
  } finally {
    const finalLockPath = join(lockedDir, ".lock");
    if (readLock(finalLockPath)?.token === token) rmSync(finalLockPath, { force: true });
  }
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

export function moveLifecycle({ repoRoot, id, from, to, gate, afterMove }) {
  assertValidBurnlistId(id);
  const sourceLifecycle = LIFECYCLES.find((lifecycle) => lifecycle.folder === from);
  const sourceDir = join(lifecycleRoot(repoRoot, sourceLifecycle), id);
  if (!safeStat(sourceDir)?.isDirectory()) {
    const found = findBurnlistDir(repoRoot, id);
    throw new Error(`Burnlist ${id} is not in ${from}; it is in ${found.lifecycle.folder}.`);
  }
  const targetRoot = join(repoRoot, "notes", "burnlists", to);
  const targetDir = join(targetRoot, id);
  return withLock(sourceDir, ({ retarget }) => {
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
  assertValidBurnlistId(id);
  const inprogressDir = join(repoRoot, "notes", "burnlists", "inprogress", id);
  const completedDir = join(repoRoot, "notes", "burnlists", "completed", id);
  if (!safeStat(inprogressDir)?.isDirectory() && safeStat(completedDir)?.isDirectory()) {
    return withLock(completedDir, () => {
      const plan = parsePlan(join(completedDir, "burnlist.md"));
      validateOrThrow(plan);
      assertCloseGate(plan);
      const repaired = appendCompletionDigestIfMissing(plan);
      console.log(repaired ? `${id} completed (digest repaired)` : `${id} already completed`);
      return completedDir;
    });
  }
  return moveLifecycle({
    repoRoot,
    id,
    from: "inprogress",
    to: "completed",
    gate: assertCloseGate,
    afterMove: appendCompletionDigestIfMissing,
  });
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

export function burnItem(repoRoot, id, itemId, check = false) {
  assertValidBurnlistId(id);
  const found = findBurnlistDir(repoRoot, id);
  if (found.lifecycle.folder !== "inprogress") {
    throw new Error(`burnlist ${id} is not in inprogress; it is in ${found.lifecycle.folder}`);
  }
  const planPath = join(found.dir, "burnlist.md");
  return withLock(found.dir, () => {
    const plan = parsePlan(planPath);
    validateOrThrow(plan);
    const item = plan.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error(`Active item ${itemId} was not found.`);
    const lines = removeActiveItem(plan.markdown, itemId);
    appendCompleted(lines, `- ${item.id} | ${localIsoTimestamp()} | ${item.title}`);
    const nextMarkdown = `${lines.join("\n").replace(/\s*$/u, "")}\n`;
    const temporary = join(dirname(planPath), `.${basename(planPath)}.${randomBytes(8).toString("hex")}.tmp`);
    let checked;
    try {
      writeFileSync(temporary, nextMarkdown);
      checked = parsePlan(temporary);
      const issues = validateOrThrow(checked);
      renameSync(temporary, planPath);
      checked = { plan: checked, issues };
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    if (!check) return true;
    for (const issue of checked.issues) {
      const stream = issue.severity === "error" ? console.error : console.warn;
      stream(`${issue.severity.toUpperCase()}: ${issue.message}`);
    }
    console.log(`Burnlist check passed: ${checked.plan.items.length} active, ${checked.plan.completed.length} completed.`);
    return true;
  });
}
