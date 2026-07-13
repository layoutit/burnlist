import { basename, dirname, normalize, relative, resolve } from "node:path";
import { readTextFileWithLimit, safeStat } from "./fs-safe.mjs";

export function twoDigit(value) {
  return String(value).padStart(2, "0");
}

export function localIsoTimestamp(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  return [
    date.getFullYear(),
    "-",
    twoDigit(date.getMonth() + 1),
    "-",
    twoDigit(date.getDate()),
    "T",
    twoDigit(date.getHours()),
    ":",
    twoDigit(date.getMinutes()),
    ":",
    twoDigit(date.getSeconds()),
    sign,
    twoDigit(Math.floor(absoluteOffset / 60)),
    ":",
    twoDigit(absoluteOffset % 60),
  ].join("");
}

export function sectionLines(markdown, heading) {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index])) break;
    out.push(lines[index]);
  }
  return out;
}

export function itemKey(id, title) {
  return `${String(id || "").trim()}|${String(title || "").trim().toLowerCase()}`;
}

export function parseActiveItems(lines) {
  const items = [];
  let current = null;
  let currentField = "";
  for (const rawLine of lines ?? []) {
    const itemMatch = rawLine.match(/^- \[([ xX])\]\s+([^|]+?)(?:\s+\|\s+(.+))?$/u);
    if (itemMatch) {
      current = {
        checked: itemMatch[1].toLowerCase() === "x",
        id: itemMatch[2].trim(),
        title: (itemMatch[3] ?? itemMatch[2]).trim(),
        fields: {},
        body: [],
        key: itemKey(itemMatch[2], itemMatch[3] ?? itemMatch[2]),
      };
      items.push(current);
      currentField = "";
      continue;
    }
    if (!current) continue;
    current.body.push(rawLine);
    const fieldMatch = rawLine.match(/^\s{2,}([A-Za-z][A-Za-z0-9 /_.-]{0,48}):\s*(.*)$/u);
    if (fieldMatch) {
      currentField = fieldMatch[1].trim();
      current.fields[currentField] = fieldMatch[2].trim();
    } else if (currentField && /^\s{2,}\S/u.test(rawLine)) {
      current.fields[currentField] = [current.fields[currentField], rawLine.trim()].filter(Boolean).join("\n");
    }
  }
  return items;
}

export function parseCompleted(lines) {
  const completed = [];
  const malformed = [];
  for (const rawLine of lines ?? []) {
    if (!rawLine.trim() || !rawLine.trim().startsWith("- ")) continue;
    const match = rawLine.match(/^- ([^|]+?) \| ([^|]+?) \| (.+)$/u);
    if (!match) {
      malformed.push(rawLine);
      continue;
    }
    const id = match[1].trim();
    const completedAt = match[2].trim();
    const title = match[3].trim();
    completed.push({ id, completedAt, title, key: itemKey(id, title) });
  }
  return { completed, malformed };
}

export function parsePlan(planPath, maxBytes = 1048576) {
  const markdown = readTextFileWithLimit(planPath, maxBytes, "Burnlist");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(dirname(planPath));
  const activeLines = sectionLines(markdown, "Active Checklist");
  const completedLines = sectionLines(markdown, "Completed");
  const completedResult = parseCompleted(completedLines);
  const repoRoot = repoRootForPlan(planPath);
  return {
    title,
    planPath,
    repoRoot,
    repo: basename(repoRoot),
    planLabel: relative(repoRoot, planPath).replace(/\\/g, "/"),
    activeSectionFound: activeLines != null,
    completedSectionFound: completedLines != null,
    items: parseActiveItems(activeLines),
    completed: completedResult.completed,
    malformedCompleted: completedResult.malformed,
    markdown,
  };
}

export function documentSections(markdown) {
  const sections = [];
  let current = null;
  for (const rawLine of String(markdown || "").split(/\r?\n/u)) {
    const heading = rawLine.match(/^#{1,3}\s+(.+)$/u);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    if (current) current.body.push(rawLine);
  }
  return sections
    .map((section) => ({ title: section.title, body: section.body.join("\n").trim() }))
    .filter((section) => section.title || section.body);
}

export function documentPayloadForPlan(planPath, filename, label, maxBytes = 1048576) {
  const documentPath = resolve(dirname(planPath), filename);
  const repoRoot = repoRootForPlan(planPath);
  const path = relative(repoRoot, documentPath).replace(/\\/g, "/") || filename;
  const stat = safeStat(documentPath);
  if (!stat?.isFile()) return { available: false, label, path, sections: [] };
  try {
    return {
      available: true,
      label,
      path,
      sections: documentSections(readTextFileWithLimit(documentPath, maxBytes, label)),
    };
  } catch (err) {
    return { available: false, label, path, sections: [], error: err.message };
  }
}

export function completedDetailMap(sections) {
  const details = new Map();
  for (const section of sections) {
    const match = String(section.title || "").match(/^([^|]+?)\s*\|\s*(.+)$/u);
    if (!match) continue;
    details.set(match[1].trim(), { title: match[2].trim(), detail: section.body });
  }
  return details;
}

const REQUIRED_FIELDS = ["Files/search", "Action", "Done/delete when", "Validate"];

export function validatePlan(plan) {
  const issues = [];
  const add = (severity, message) => issues.push({ severity, message });
  if (!plan.activeSectionFound) add("error", "Missing ## Active Checklist section.");
  if (!plan.completedSectionFound) add("error", "Missing ## Completed section.");
  for (const line of plan.malformedCompleted) add("error", `Malformed completed ledger line: ${line}`);

  const activeIds = new Map();
  for (const item of plan.items) {
    if (!item.id) add("error", `Active item is missing a stable id: ${item.title}`);
    activeIds.set(item.id, (activeIds.get(item.id) ?? 0) + 1);
    if (item.checked) add("error", `Active item ${item.id} is checked; burn it or uncheck it.`);
    for (const field of REQUIRED_FIELDS) {
      if (!String(item.fields[field] ?? "").trim()) add("warning", `Active item ${item.id} is missing ${field}.`);
    }
  }
  for (const [id, count] of activeIds) {
    if (count > 1) add("error", `Duplicate active id ${id}.`);
  }

  const completedIds = new Map();
  for (const entry of plan.completed) {
    completedIds.set(entry.id, (completedIds.get(entry.id) ?? 0) + 1);
    if (!Number.isFinite(Date.parse(entry.completedAt))) {
      add("error", `Completed item ${entry.id} has an invalid timestamp.`);
    }
    if (activeIds.has(entry.id)) add("error", `Completed id ${entry.id} is still active.`);
  }
  for (const [id, count] of completedIds) {
    if (count > 1) add("error", `Duplicate completed id ${id}.`);
  }
  return issues;
}

export function timestampMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

export function durationLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function completionDigestMarkdown(plan) {
  const completed = plan.completed
    .map((entry) => ({ ...entry, ms: timestampMs(entry.completedAt) }))
    .filter((entry) => entry.ms != null)
    .sort((a, b) => a.ms - b.ms);
  const finishedAt = completed.at(-1)?.completedAt ?? null;
  const elapsedMs = completed.length > 1 ? completed.at(-1).ms - completed[0].ms : null;
  const averageMs = completed.length > 1 ? Math.round(elapsedMs / (completed.length - 1)) : null;
  return [
    "## Completion Digest",
    `- Finished: ${finishedAt ?? "unknown"}.`,
    `- Completed: ${plan.completed.length} items; final progress 100%.`,
    `- Timing: ${durationLabel(elapsedMs)} elapsed; ~${durationLabel(averageMs)} per item.`,
    `- Scope movement: ${plan.completed.length} final item(s); active queue empty.`,
    "- Source: completed ledger only; historical metadata only.",
  ].join("\n");
}

export function repoRootForPlan(path) {
  const normalized = normalize(path).replace(/\\/g, "/");
  const marker = "/notes/burnlists/";
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? normalized.slice(0, index) || "/" : dirname(path);
}

export function burnlistIdForPlan(path) {
  return basename(dirname(path));
}

export const LIFECYCLES = [
  { folder: "draft", status: "draft", label: "Draft" },
  { folder: "ready", status: "ready", label: "Ready" },
  { folder: "inprogress", status: "active", label: "Active" },
  { folder: "completed", status: "complete", label: "Done" },
];

export function lifecycleForPlan(path) {
  const normalized = normalize(path).replace(/\\/g, "/");
  const folder = normalized.split("/").at(-3);
  return LIFECYCLES.find((entry) => entry.folder === folder) ?? LIFECYCLES[2];
}

export function summaryForPlan(path, maxBytes) {
  const lifecycle = lifecycleForPlan(path);
  try {
    const plan = parsePlan(path, maxBytes);
    const issues = validatePlan(plan);
    const total = plan.items.length + plan.completed.length;
    const done = plan.completed.length;
    const remaining = plan.items.length;
    const completedButUnmoved = lifecycle.status === "active" && total > 0 && remaining === 0 && done === total;
    return {
      id: burnlistIdForPlan(path),
      repo: plan.repo,
      title: plan.title,
      repoRoot: plan.repoRoot,
      planPath: path,
      planLabel: plan.planLabel,
      status: completedButUnmoved ? "complete" : lifecycle.status,
      statusLabel: completedButUnmoved ? "Done" : lifecycle.label,
      lifecycleStatus: lifecycle.status,
      needsLifecycleMove: completedButUnmoved,
      total,
      done,
      remaining,
      percent: total ? Math.round((done / total) * 100) : 0,
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      lastCompletedAt: plan.completed.reduce((latest, entry) => {
        const time = Date.parse(entry.completedAt);
        return Number.isFinite(time) && (!latest || time > Date.parse(latest)) ? entry.completedAt : latest;
      }, null),
      updatedAt: safeStat(path)?.mtime?.toISOString?.() ?? null,
    };
  } catch (err) {
    const repoRoot = repoRootForPlan(path);
    return {
      id: burnlistIdForPlan(path),
      repo: basename(repoRoot),
      title: burnlistIdForPlan(path),
      repoRoot,
      planPath: path,
      planLabel: relative(repoRoot, path).replace(/\\/g, "/"),
      status: lifecycle.status,
      statusLabel: lifecycle.label,
      total: 0,
      done: 0,
      remaining: 0,
      percent: 0,
      errors: 1,
      warnings: 0,
      lastCompletedAt: null,
      error: err.message,
      updatedAt: safeStat(path)?.mtime?.toISOString?.() ?? null,
    };
  }
}
