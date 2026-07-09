#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertKnownKeys,
  boundedText,
  normalizeOvenDetail,
  normalizeOvenPackage,
  ovenId,
} from "./oven-contract.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, "true");
  }
}

const launchCwd = process.cwd();
const checkMode = args.has("check");
const digestMode = args.has("digest");
const closeCompletedMode = args.has("close-completed");
const reportMode = checkMode || digestMode || closeCompletedMode;
const host = args.get("host") ?? "127.0.0.1";
const initialPort = positiveInteger(args.get("port") ?? process.env.PORT ?? "4510", "port");
const autoPort = args.has("auto-port");
const maxPlanBytes = positiveInteger(args.get("max-plan-bytes") ?? "1048576", "max-plan-bytes");
const maxHistoryEntries = positiveInteger(args.get("max-history-entries") ?? "1000", "max-history-entries");
const stateDir = resolve(launchCwd, args.get("state-dir") ?? ".local/burnlist/checklist-progress");
const runtimePath = resolve(stateDir, "index.server.json");
const historyPath = resolve(stateDir, "index.history.jsonl");
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fallbackBurnOvensScriptPath = resolve(skillDir, "dashboard", "fallback-burn-ovens.js");
const builtInOvensDir = resolve(skillDir, "ovens");
const customOvensDir = resolve(launchCwd, args.get("ovens-dir") ?? ".local/burnlist/ovens");
// Read-only compatibility for the short-lived pre-Oven schema. New writes never use these paths.
const legacyBuiltInTypesDir = resolve(skillDir, "types");
const legacyCustomTypesDir = resolve(launchCwd, args.get("types-dir") ?? ".local/burnlist/types");
const runsDir = resolve(launchCwd, args.get("runs-dir") ?? ".local/burnlist/runs");
const writeToken = randomBytes(24).toString("hex");
const legacyDetailOrigin = String(args.get("legacy-detail-origin") ?? "").replace(/\/+$/u, "");

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`Invalid --${name}: ${value}`);
    process.exit(2);
  }
  return parsed;
}

function twoDigit(value) {
  return String(value).padStart(2, "0");
}

function localIsoTimestamp(date = new Date()) {
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

if (args.has("stamp")) {
  console.log(localIsoTimestamp());
  process.exit(0);
}

function isLoopbackHost(value) {
  return value === "127.0.0.1" || value === "localhost" || value === "::1" || value === "[::1]";
}

if (!reportMode && !isLoopbackHost(host) && !args.has("allow-non-loopback")) {
  console.error(`Refusing to bind non-loopback host "${host}". Pass --allow-non-loopback to override.`);
  process.exit(2);
}

if ((checkMode || digestMode) && !args.has("plan")) {
  console.error("Usage: burnlist --plan <path> --check|--digest");
  console.error("       burnlist --close-completed [--scan-root <repo[,repo...]>]");
  console.error("       burnlist --stamp");
  process.exit(2);
}

function readTextFileWithLimit(path, maxBytes, label) {
  const stat = statSync(path);
  if (stat.size > maxBytes) throw new Error(`${label} is ${stat.size} bytes, over the ${maxBytes} byte limit`);
  return readFileSync(path, "utf8");
}

function sectionLines(markdown, heading) {
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

function itemKey(id, title) {
  return `${String(id || "").trim()}|${String(title || "").trim().toLowerCase()}`;
}

function parseActiveItems(lines) {
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

function parseCompleted(lines) {
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

function parsePlan(planPath) {
  const markdown = readTextFileWithLimit(planPath, maxPlanBytes, "Burnlist");
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

function documentSections(markdown) {
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

function documentPayloadForPlan(planPath, filename, label) {
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
      sections: documentSections(readTextFileWithLimit(documentPath, maxPlanBytes, label)),
    };
  } catch (err) {
    return { available: false, label, path, sections: [], error: err.message };
  }
}

function completedDetailMap(sections) {
  const details = new Map();
  for (const section of sections) {
    const match = String(section.title || "").match(/^([^|]+?)\s*\|\s*(.+)$/u);
    if (!match) continue;
    details.set(match[1].trim(), { title: match[2].trim(), detail: section.body });
  }
  return details;
}

const REQUIRED_FIELDS = ["Files/search", "Action", "Done/delete when", "Validate"];

function validatePlan(plan) {
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

function runCheck() {
  try {
    const plan = parsePlan(resolve(launchCwd, args.get("plan")));
    const issues = validatePlan(plan);
    for (const issue of issues) {
      const stream = issue.severity === "error" ? console.error : console.warn;
      stream(`${issue.severity.toUpperCase()}: ${issue.message}`);
    }
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length) process.exit(1);
    console.log(`Burnlist check passed: ${plan.items.length} active, ${plan.completed.length} completed.`);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

function timestampMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function durationLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function completionDigestMarkdown(plan) {
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

function runDigest() {
  try {
    const plan = parsePlan(resolve(launchCwd, args.get("plan")));
    const issues = validatePlan(plan);
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length) {
      for (const issue of errors) console.error(`ERROR: ${issue.message}`);
      process.exit(1);
    }
    if (plan.items.length) {
      console.error(`Completion digest blocked: ${plan.items.length} active item(s) remain.`);
      process.exit(1);
    }
    console.log(completionDigestMarkdown(plan));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (checkMode) runCheck();
if (digestMode) runDigest();

function repoRootForPlan(path) {
  const normalized = normalize(path).replace(/\\/g, "/");
  const marker = "/notes/burnlists/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(0, index) || "/" : dirname(path);
}

function burnlistIdForPlan(path) {
  return basename(dirname(path));
}

const LIFECYCLES = [
  { folder: "draft", status: "draft", label: "Draft" },
  { folder: "ready", status: "ready", label: "Ready" },
  { folder: "inprogress", status: "active", label: "Active" },
  { folder: "completed", status: "complete", label: "Done" },
];

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function candidateRepoRoots() {
  const roots = new Set();
  const addIfRepo = (root) => {
    const burnlistsRoot = join(root, "notes", "burnlists");
    if (safeStat(burnlistsRoot)?.isDirectory()) roots.add(resolve(root));
  };
  const addRootAndChildren = (root) => {
    const stat = safeStat(root);
    if (!stat?.isDirectory()) return;
    addIfRepo(root);
    for (const name of readdirSync(root)) {
      if (name.startsWith(".")) continue;
      const child = join(root, name);
      if (safeStat(child)?.isDirectory()) addIfRepo(child);
    }
  };
  const explicit = String(args.get("scan-root") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (explicit.length) {
    for (const root of explicit) addRootAndChildren(resolve(launchCwd, root));
  } else {
    addRootAndChildren(launchCwd);
    if (process.env.HOME) addRootAndChildren(resolve(process.env.HOME, "fed"));
  }
  return [...roots].sort((a, b) => a.localeCompare(b));
}

function burnlistPaths() {
  const paths = [];
  for (const repoRoot of candidateRepoRoots()) {
    for (const lifecycle of LIFECYCLES) {
      const lifecycleRoot = join(repoRoot, "notes", "burnlists", lifecycle.folder);
      if (!safeStat(lifecycleRoot)?.isDirectory()) continue;
      for (const id of readdirSync(lifecycleRoot)) {
        if (id.startsWith(".")) continue;
        const planPath = join(lifecycleRoot, id, "burnlist.md");
        if (safeStat(planPath)?.isFile()) paths.push(planPath);
      }
    }
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

function lifecycleForPlan(path) {
  const normalized = normalize(path).replace(/\\/g, "/");
  const folder = normalized.split("/").at(-3);
  return LIFECYCLES.find((entry) => entry.folder === folder) ?? LIFECYCLES[2];
}

function summaryForPlan(path) {
  const lifecycle = lifecycleForPlan(path);
  try {
    const plan = parsePlan(path);
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
      error: err.message,
      updatedAt: safeStat(path)?.mtime?.toISOString?.() ?? null,
    };
  }
}

function discoverBurnlists() {
  return burnlistPaths().map(summaryForPlan);
}

function instructionsName(instructions, fallback) {
  const heading = instructions.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line.trim()));
  return heading ? heading.trim().replace(/^#\s+/u, "").trim() : fallback;
}

function instructionsDescription(instructions) {
  return instructions
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) ?? "";
}

function readOven(root, id, builtIn) {
  const safeId = ovenId(id);
  const ovenRoot = join(root, safeId);
  const canonicalInstructionsPath = join(ovenRoot, "instructions.md");
  const canonicalDetailPath = join(ovenRoot, "detail.json");
  const legacyInstructionsPath = join(ovenRoot, "definition.md");
  const legacyDetailPath = join(ovenRoot, "dashboard.json");
  const instructionsPath = safeStat(canonicalInstructionsPath)?.isFile() ? canonicalInstructionsPath : legacyInstructionsPath;
  const detailPath = safeStat(canonicalDetailPath)?.isFile() ? canonicalDetailPath : legacyDetailPath;
  if (!safeStat(instructionsPath)?.isFile() || !safeStat(detailPath)?.isFile()) return null;
  const ovenPackage = normalizeOvenPackage({
    id: safeId,
    instructions: readTextFileWithLimit(instructionsPath, 65536, "Oven instructions"),
    detail: JSON.parse(readTextFileWithLimit(detailPath, 131072, "Oven detail template")),
  });
  return {
    id: ovenPackage.id,
    name: instructionsName(ovenPackage.instructions, safeId),
    description: instructionsDescription(ovenPackage.instructions),
    builtIn,
    instructions: ovenPackage.instructions,
    detail: ovenPackage.detail,
  };
}

function ovensIn(root, builtIn) {
  if (!safeStat(root)?.isDirectory()) return [];
  return readdirSync(root)
    .filter((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))
    .map((id) => readOven(root, id, builtIn))
    .filter(Boolean);
}

function discoverOvens() {
  const byId = new Map();
  for (const oven of ovensIn(builtInOvensDir, true)) byId.set(oven.id, oven);
  for (const oven of ovensIn(legacyBuiltInTypesDir, true)) {
    if (!byId.has(oven.id)) byId.set(oven.id, oven);
  }
  for (const oven of ovensIn(legacyCustomTypesDir, false)) {
    if (!byId.has(oven.id)) byId.set(oven.id, oven);
  }
  for (const oven of ovensIn(customOvensDir, false)) {
    if (!byId.get(oven.id)?.builtIn) byId.set(oven.id, oven);
  }
  return [...byId.values()].sort((left, right) => Number(right.builtIn) - Number(left.builtIn) || left.name.localeCompare(right.name));
}

function ovenSummary(oven) {
  return {
    id: oven.id,
    name: oven.name,
    description: oven.description,
    builtIn: oven.builtIn,
    detail: {
      columns: oven.detail.columns,
      rows: oven.detail.rows,
      sections: oven.detail.cells.length,
    },
  };
}

function atomicDirectory(parent, id, files) {
  mkdirSync(parent, { recursive: true });
  const target = join(parent, id);
  if (existsSync(target)) throw new Error(`${id} already exists.`);
  const temporary = join(parent, `.${id}.${randomBytes(6).toString("hex")}`);
  mkdirSync(temporary);
  try {
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(temporary, name), contents);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return target;
}

function createOven(value) {
  assertKnownKeys(value, new Set(["id", "name", "instructions", "detail", "definition", "dashboard"]), "Oven");
  const id = ovenId(value.id);
  if (discoverOvens().some((oven) => oven.id === id)) throw new Error(`Oven ${id} already exists.`);
  const name = boundedText(value.name, "Oven name", 80);
  let instructions = boundedText(value.instructions ?? value.definition, "Markdown instructions", 65536);
  const instructionLines = instructions.split(/\r?\n/u);
  const titleLine = instructionLines.findIndex((line) => /^#\s+\S/u.test(line.trim()));
  if (titleLine === -1) instructionLines.unshift(`# ${name}`, "");
  else instructionLines[titleLine] = `# ${name}`;
  instructions = instructionLines.join("\n");
  const detail = normalizeOvenDetail(value.detail ?? value.dashboard);
  const ovenPackage = normalizeOvenPackage({ id, instructions, detail });
  const path = atomicDirectory(customOvensDir, id, {
    "instructions.md": `${ovenPackage.instructions}\n`,
    "detail.json": `${JSON.stringify(ovenPackage.detail, null, 2)}\n`,
  });
  return { ...readOven(customOvensDir, id, false), path };
}

function discoveredRepos() {
  return candidateRepoRoots().map((root) => ({ name: basename(root), root }));
}

function runId(date = new Date()) {
  return [
    date.getFullYear(),
    twoDigit(date.getMonth() + 1),
    twoDigit(date.getDate()),
    "-",
    twoDigit(date.getHours()),
    twoDigit(date.getMinutes()),
    twoDigit(date.getSeconds()),
    "-",
    randomBytes(3).toString("hex"),
  ].join("");
}

function createBurnRun(value) {
  assertKnownKeys(value, new Set(["ovenId", "typeId", "repoRoot", "title", "objective"]), "Burn run");
  const selectedOvenId = ovenId(value.ovenId ?? value.typeId);
  const oven = discoverOvens().find((entry) => entry.id === selectedOvenId);
  if (!oven) throw new Error(`Unknown oven ${selectedOvenId}.`);
  const requestedRoot = resolve(boundedText(value.repoRoot, "Repository", 4096));
  const repo = discoveredRepos().find((entry) => entry.root === requestedRoot);
  if (!repo) throw new Error("Repository must be one of the dashboard scan roots.");
  const title = boundedText(value.title, "Run title", 120);
  const objective = boundedText(value.objective, "Run objective", 12000);
  const id = runId();
  const createdAt = new Date().toISOString();
  const record = {
    schemaVersion: 3,
    id,
    ovenId: selectedOvenId,
    repoRoot: repo.root,
    repo: repo.name,
    title,
    status: "requested",
    createdAt,
    updatedAt: createdAt,
    inputs: { objective },
    summary: {},
    sections: [],
  };
  const path = atomicDirectory(runsDir, id, {
    "run.json": `${JSON.stringify(record, null, 2)}\n`,
    "instructions.md": `${oven.instructions.trim()}\n`,
    "detail.json": `${JSON.stringify(oven.detail, null, 2)}\n`,
  });
  return { ...record, ovenName: oven.name, path };
}

function readBurnRun(id) {
  const safeId = boundedText(id, "Run id", 48);
  if (!/^\d{8}-\d{6}-[a-f0-9]{6}$/u.test(safeId)) throw new Error("Invalid run id.");
  const path = join(runsDir, safeId, "run.json");
  if (!safeStat(path)?.isFile()) return null;
  const record = JSON.parse(readTextFileWithLimit(path, 131072, "Burn run"));
  return { ...record, ovenId: record.ovenId ?? record.typeId };
}

async function readJsonRequest(req) {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json.");
    error.status = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 262144) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function assertWriteRequest(req) {
  const fetchSite = String(req.headers["sec-fetch-site"] ?? "");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    const error = new Error("Cross-site writes are not allowed.");
    error.status = 403;
    throw error;
  }
  const origin = String(req.headers.origin ?? "");
  const requestHost = String(req.headers.host ?? "");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (!originHost || originHost !== requestHost) {
      const error = new Error("Write origin does not match this dashboard.");
      error.status = 403;
      throw error;
    }
  }
  if (String(req.headers["x-burnlist-token"] ?? "") !== writeToken) {
    const error = new Error("Missing or invalid dashboard write token.");
    error.status = 403;
    throw error;
  }
}

function routeSelection(url) {
  const parts = url.pathname.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts.length === 2 && !["api", "targets", "ovens", "types", "runs"].includes(parts[0])) return { repo: parts[0], id: parts[1] };
  return null;
}

function selectedBurnlist(url) {
  const burnlists = discoverBurnlists();
  const requestedPlan = url.searchParams.get("plan");
  if (requestedPlan) {
    const match = burnlists.find((entry) => entry.planPath === requestedPlan);
    return match ? { burnlist: match, burnlists } : { error: `No Burnlist found for ${requestedPlan}`, burnlists };
  }
  const route = routeSelection(url);
  const repo = url.searchParams.get("repo") || route?.repo || "";
  const id = url.searchParams.get("id") || route?.id || "";
  if (repo && id) {
    const matches = burnlists.filter((entry) => entry.repo === repo && entry.id === id);
    if (matches.length === 1) return { burnlist: matches[0], burnlists };
    if (matches.length > 1) return { error: `Burnlist ${repo}/${id} is ambiguous; select by plan path.`, burnlists };
    return { error: `No Burnlist found for ${repo}/${id}`, burnlists };
  }
  const active = burnlists.filter((entry) => entry.status === "active" && !entry.errors);
  if (active.length === 1) return { burnlist: active[0], burnlists };
  return { error: active.length ? "Select a Burnlist." : "No active Burnlist found.", burnlists };
}

function appendHistory(snapshot) {
  if (reportMode) return;
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(snapshot)}\n`);
  const rows = readHistory();
  writeFileSync(historyPath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

function readHistory() {
  if (!existsSync(historyPath)) return [];
  return readFileSync(historyPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-maxHistoryEntries);
}

function payloadForPlan(selection) {
  const plan = parsePlan(selection.planPath);
  const goal = documentPayloadForPlan(selection.planPath, "goal.md", "Goal");
  const completedLog = documentPayloadForPlan(selection.planPath, "completed.md", "Completed log");
  const completedDetails = completedDetailMap(completedLog.sections);
  const issues = validatePlan(plan);
  const total = plan.items.length + plan.completed.length;
  const done = plan.completed.length;
  const remaining = plan.items.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const generatedAt = new Date().toISOString();
  const current = { time: generatedAt, planPath: selection.planPath, done, remaining, total, percent };
  appendHistory(current);
  const ledgerHistory = plan.completed
    .map((entry, index) => {
      const itemDone = index + 1;
      return {
        time: entry.completedAt,
        done: itemDone,
        remaining: Math.max(0, total - itemDone),
        total,
        percent: total ? Math.round((itemDone / total) * 100) : 100,
      };
    })
    .filter((entry) => Number.isFinite(Date.parse(entry.time)));
  const history = [...ledgerHistory, current].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return {
    generatedAt,
    burnlists: discoverBurnlists(),
    burnlistId: burnlistIdForPlan(selection.planPath),
    repo: plan.repo,
    repoRoot: plan.repoRoot,
    title: plan.title,
    planPath: selection.planPath,
    planLabel: plan.planLabel,
    total,
    done,
    remaining,
    percent,
    warnings: issues,
    goal,
    active: plan.items,
    completed: plan.completed.map((entry) => ({
      ...entry,
      detail: completedDetails.get(entry.id)?.detail ?? "",
    })),
    history,
  };
}

function appendCompletionDigestIfMissing(plan) {
  if (/^##\s+Completion Digest\b/m.test(plan.markdown)) return false;
  const digest = completionDigestMarkdown(plan);
  writeFileSync(plan.planPath, `${plan.markdown.replace(/\s*$/u, "")}\n\n${digest}\n`);
  return true;
}

function runCloseCompleted() {
  const moved = [];
  const skipped = [];
  const errors = [];
  for (const path of burnlistPaths()) {
    const lifecycle = lifecycleForPlan(path);
    if (lifecycle.status !== "active") continue;
    try {
      const plan = parsePlan(path);
      const issues = validatePlan(plan);
      if (issues.some((issue) => issue.severity === "error")) {
        skipped.push(`${plan.repo}/${burnlistIdForPlan(path)}: protocol errors`);
        continue;
      }
      if (plan.items.length || !plan.completed.length) {
        skipped.push(`${plan.repo}/${burnlistIdForPlan(path)}: ${plan.items.length} active item(s) remain`);
        continue;
      }
      const sourceDir = dirname(path);
      const targetRoot = join(plan.repoRoot, "notes", "burnlists", "completed");
      const targetDir = join(targetRoot, burnlistIdForPlan(path));
      if (existsSync(targetDir)) {
        errors.push(`${plan.repo}/${burnlistIdForPlan(path)}: target exists`);
        continue;
      }
      const appended = appendCompletionDigestIfMissing(plan);
      mkdirSync(targetRoot, { recursive: true });
      renameSync(sourceDir, targetDir);
      moved.push(`${plan.repo}/${burnlistIdForPlan(path)} -> ${relative(plan.repoRoot, targetDir)}${appended ? " with digest" : ""}`);
    } catch (err) {
      errors.push(`${path}: ${err.message}`);
    }
  }
  if (moved.length) {
    console.log(`Closed ${moved.length} completed Burnlist(s).`);
    for (const line of moved) console.log(`- ${line}`);
  } else {
    console.log("No completed in-progress Burnlists found.");
  }
  if (skipped.length) {
    console.error(`Skipped ${skipped.length} active Burnlist(s).`);
    for (const line of skipped) console.error(`- ${line}`);
  }
  if (errors.length) {
    console.error(`Failed ${errors.length} Burnlist closeout(s).`);
    for (const line of errors) console.error(`- ${line}`);
    process.exit(1);
  }
  process.exit(0);
}

if (closeCompletedMode) runCloseCompleted();

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function html(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function javascript(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function fallbackTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value || "—");
}

const fallbackPageSize = 20;

function fallbackPage(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function fallbackListHref(filter, page = 1) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

function detailHref(repo, id, filter, page = 1) {
  const params = new URLSearchParams({ filter });
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  const path = `/${encodeURIComponent(repo)}/${encodeURIComponent(id)}?${search}`;
  return legacyDetailOrigin ? `${legacyDetailOrigin}${path}` : path;
}

const FALLBACK_STYLE = `<style>
.burnlist-fallback{--panel:#111;--text:#e8e8e8;--muted:#a8a8a8;--line:#262626;--done:#43c46b;--active:#5aa2ff;width:min(1180px,calc(100% - 64px));margin:0 auto;padding:20px 0 28px;color:var(--text);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}.burnlist-fallback h1{margin:0;font:400 26px/1.08 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}.burnlist-fallback h2{font-size:17px}.burnlist-fallback p{color:var(--muted)}.burnlist-fallback a{color:inherit;text-decoration:none}.burnlist-fallback .timestamp{font-size:13px}.burnlist-fallback .page-header{border-bottom:1px solid var(--line);padding-bottom:14px}.burnlist-fallback .brand-lockup{display:flex;align-items:center;gap:12px}.burnlist-fallback .brand-mark{width:40px;height:40px;flex:0 0 auto;border-radius:9px}.burnlist-fallback .page-header p{margin:8px 0 0}.burnlist-fallback .filters{display:flex;gap:4px;margin:16px 0}.burnlist-fallback .filters a{height:28px;display:inline-flex;align-items:center;padding:0 8px;border:1px solid transparent;border-radius:4px;color:var(--muted)}.burnlist-fallback .filters a.selected{border-color:rgba(67,196,107,.26);color:var(--text);background:rgba(67,196,107,.055)}.burnlist-fallback .filters a:hover{color:var(--text);background:rgba(163,172,183,.06);border-color:rgba(163,172,183,.16)}.burnlist-fallback .table-wrap,.burnlist-fallback .card{border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}.burnlist-fallback .table-wrap{padding:16px}.burnlist-fallback table{width:100%;border-collapse:collapse;color:rgba(210,216,224,.72);font-size:14px}.burnlist-fallback th{padding:0 18px 10px 0;color:var(--muted);font-weight:400;text-align:left;white-space:nowrap}.burnlist-fallback td{padding:10px 18px 10px 0;border-bottom:1px solid rgba(163,172,183,.09);text-align:left;vertical-align:middle}.burnlist-fallback th:last-child,.burnlist-fallback td:last-child{padding-right:0}.burnlist-fallback tbody tr:last-child td{border-bottom:0}.burnlist-fallback tbody tr:hover td{background:rgba(90,162,255,.08)}.burnlist-fallback .row-title{display:block;color:rgba(242,245,248,.92);overflow-wrap:anywhere}.burnlist-fallback .row-title:hover{color:var(--active);text-decoration:underline;text-underline-offset:3px}.burnlist-fallback .row-subtitle{display:block;margin-top:3px;color:var(--muted);overflow-wrap:anywhere}.burnlist-fallback .pill{display:inline-block;border:1px solid rgba(163,172,183,.22);border-radius:4px;padding:1px 6px;color:var(--muted);font-size:12px}.burnlist-fallback .pill.complete{border-color:rgba(67,196,107,.32);color:var(--done)}.burnlist-fallback .pill.active{border-color:rgba(90,162,255,.32);color:var(--active)}.burnlist-fallback .bar{height:6px;margin-top:6px;border:1px solid #2a2a2a;border-radius:4px;background:#202020;overflow:hidden}.burnlist-fallback .bar>span{display:block;height:100%;background:var(--done)}.burnlist-fallback .pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.burnlist-fallback .page-controls{display:flex;align-items:center;gap:8px}.burnlist-fallback .page-controls a,.burnlist-fallback .page-controls .disabled{display:inline-flex;min-height:28px;align-items:center;justify-content:center;padding:0 8px;border:1px solid var(--line);border-radius:4px}.burnlist-fallback .page-controls a{color:var(--text)}.burnlist-fallback .page-controls a:hover{border-color:rgba(163,172,183,.32);background:rgba(163,172,183,.06)}.burnlist-fallback .page-controls .disabled{opacity:.45}.burnlist-fallback .back{display:inline-block;margin-bottom:20px;color:var(--active)}.burnlist-fallback .hero{padding:22px;margin-bottom:18px}.burnlist-fallback .hero h1{font-size:24px}.burnlist-fallback .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.burnlist-fallback .metric{padding:14px}.burnlist-fallback .metric strong{display:block;font-size:24px}.burnlist-fallback .section{padding:20px;margin-bottom:18px}.burnlist-fallback .document-section,.burnlist-fallback .completion{padding:16px 0;border-top:1px solid var(--line)}.burnlist-fallback .document-section:first-of-type,.burnlist-fallback .completion:first-of-type{border-top:0}.burnlist-fallback pre{margin:10px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:#c4c4cc;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:700px){.burnlist-fallback{width:calc(100% - 40px);padding:20px 0}.burnlist-fallback .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.burnlist-fallback table{min-width:650px}.burnlist-fallback .table-wrap{overflow:auto}.burnlist-fallback .pagination{align-items:flex-start;flex-direction:column}}
</style>`;

const OVEN_STYLE = `<style>
.burnlist-fallback.oven-page,.burnlist-fallback.oven-page *{box-sizing:border-box}
.burnlist-fallback .table-toolbar,.burnlist-fallback .burn-actions,.burnlist-fallback .form-actions{display:flex;align-items:center;gap:8px}
.burnlist-fallback .table-toolbar{justify-content:space-between;flex-wrap:wrap;margin:16px 0}.burnlist-fallback .table-toolbar .filters{margin:0}
.burnlist-fallback .action-button,.burnlist-fallback button.action-button{display:inline-flex;min-height:32px;align-items:center;justify-content:center;padding:0 11px;border:1px solid rgba(163,172,183,.28);border-radius:5px;background:#181b1f;color:var(--text);font:600 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}.burnlist-fallback .action-button.primary,.burnlist-fallback button.action-button.primary{border-color:rgba(90,162,255,.48);background:rgba(90,162,255,.13);color:#dcecff}.burnlist-fallback .action-button:hover,.burnlist-fallback button.action-button:hover{border-color:rgba(163,172,183,.5);background:#20242a}.burnlist-fallback button.action-button:disabled{cursor:not-allowed;opacity:.5}
.burnlist-fallback.oven-page{width:calc(100% - 40px);max-width:none}.burnlist-fallback .form-shell{display:grid;gap:16px}.burnlist-fallback .form-card{padding:18px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}.burnlist-fallback .form-grid{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}.burnlist-fallback .oven-definition-card{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}.burnlist-fallback .oven-fields-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.burnlist-fallback .oven-definition-card .field{margin-bottom:0}.burnlist-fallback .oven-definition-card .hint{margin:0}.burnlist-fallback .field{display:grid;gap:6px;margin-bottom:14px}.burnlist-fallback .field>span{color:var(--muted);font-size:12px}.burnlist-fallback input,.burnlist-fallback textarea,.burnlist-fallback select{width:100%;border:1px solid var(--line);border-radius:5px;background:#0e1012;color:var(--text);padding:8px 9px;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.burnlist-fallback textarea{min-height:160px;resize:vertical}
.burnlist-fallback .hint{color:var(--muted);font-size:12px}
.burnlist-fallback .oven-builder{overflow-x:auto}.burnlist-fallback .oven-grid{display:grid;position:relative;width:100%;border-top:1px solid #30363d;border-left:1px solid #30363d;background:#0d0f11;touch-action:none;user-select:none;cursor:crosshair}.burnlist-fallback .base-grid-cell{min-width:0;border-right:1px solid #30363d;border-bottom:1px solid #30363d;background:transparent}
.burnlist-fallback .grid-selector,.burnlist-fallback .saved-grid-area{position:absolute;inset:1px;min-width:0;box-sizing:border-box;overflow:auto}.burnlist-fallback .grid-selector.is-selecting{border:1px solid rgba(253,216,53,.95);background:rgba(253,216,53,.28);pointer-events:none}.burnlist-fallback .grid-selector.is-draft{border:2px solid rgba(253,216,53,.95);background:#151515;box-shadow:0 8px 28px rgba(0,0,0,.35)}
.burnlist-fallback .saved-grid-area{border:1px solid #32363b;background:#151719;color:var(--text);transition:border-color .12s,box-shadow .12s}.burnlist-fallback .saved-grid-area:hover,.burnlist-fallback .saved-grid-area:focus-within{z-index:5!important;border-color:rgba(253,216,53,.95);box-shadow:inset 0 0 0 2px rgba(253,216,53,.35)}
.burnlist-fallback .grid-area-editor{display:grid;min-height:100%;align-content:center;gap:4px;padding:6px}.burnlist-fallback .saved-area-editor{padding-top:30px}.burnlist-fallback .grid-chart-picker{display:flex;flex-wrap:wrap;gap:4px}.burnlist-fallback .grid-chart-type{display:grid;width:28px;height:28px;place-items:center;padding:0;border:1px solid #383d43;border-radius:4px;background:#0e1012;color:var(--muted);cursor:pointer}.burnlist-fallback .grid-chart-type:hover{border-color:rgba(253,216,53,.65);color:var(--text)}.burnlist-fallback .grid-chart-type.is-selected{border-color:rgba(253,216,53,.95);background:rgba(253,216,53,.95);color:#171717}.burnlist-fallback .grid-chart-icon{display:block;width:16px;height:16px}.burnlist-fallback .grid-metric-description{display:grid;gap:2px}.burnlist-fallback .grid-metric-label{color:var(--muted);font-size:10px}.burnlist-fallback textarea.grid-area-description{min-height:48px;height:48px;padding:4px 6px;border-color:#383d43;font-size:11px;line-height:1.35;resize:none}.burnlist-fallback .grid-area-actions{display:flex;justify-content:flex-end;gap:4px}.burnlist-fallback .grid-area-toolbar{position:absolute;top:0;right:0;z-index:4;display:flex;opacity:0;transition:opacity .12s}.burnlist-fallback .saved-grid-area:hover .grid-area-toolbar,.burnlist-fallback .saved-grid-area:focus-within .grid-area-toolbar{opacity:1}.burnlist-fallback .saved-grid-area.is-edit .grid-area-action.edit,.burnlist-fallback .saved-grid-area.is-preview .grid-area-action.preview{display:none}
.burnlist-fallback .grid-area-action{min-height:22px;border:0;border-left:1px solid rgba(0,0,0,.22);border-radius:0;background:rgba(253,216,53,.96);color:#171717;padding:0 6px;font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}.burnlist-fallback .grid-area-action:hover{background:#e1b802}.burnlist-fallback .grid-area-action.delete:hover{background:#c83b42;color:#fff}.burnlist-fallback .grid-area-action.add{background:#6db6ff}.burnlist-fallback .grid-area-action.cancel{background:#d7d7d7}.burnlist-fallback .grid-area-preview{display:grid;min-height:100%;place-content:center;gap:7px;padding:10px;text-align:center}.burnlist-fallback .grid-area-preview-icon{display:grid;place-items:center;color:rgba(253,216,53,.95)}.burnlist-fallback .grid-area-preview-icon .grid-chart-icon{width:24px;height:24px}.burnlist-fallback .grid-area-preview-description{margin:0;color:var(--text);font-size:12px;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere}
.burnlist-fallback .form-actions{justify-content:flex-end;margin-top:16px}.burnlist-fallback .form-status{display:block;min-height:20px;margin-top:10px;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere}.burnlist-fallback .form-status.error{color:var(--bad)}.burnlist-fallback .run-summary{margin-top:12px;padding:12px;border:1px solid rgba(67,196,107,.26);border-radius:6px;background:rgba(67,196,107,.055);color:var(--done)}
@media(max-width:900px){.burnlist-fallback .table-toolbar{align-items:flex-start;flex-direction:column}.burnlist-fallback .oven-fields-row{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.burnlist-fallback .oven-fields-row{grid-template-columns:1fr}}
</style>`;

function fallbackIndex(url) {
  const filter = ["draft", "ready", "active", "complete", "all"].includes(url.searchParams.get("filter"))
    ? url.searchParams.get("filter")
    : "all";
  const labels = { draft: "Draft", ready: "Ready", active: "Active", complete: "Done", all: "All" };
  const filters = Object.keys(labels).map((value) => {
    return `<a class="${filter === value ? "selected" : ""}" href="${fallbackListHref(value)}">${labels[value]}</a>`;
  }).join("");
  const filteredRows = discoverBurnlists().filter((entry) => filter === "all" || entry.status === filter);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / fallbackPageSize));
  const page = Math.min(fallbackPage(url.searchParams.get("page")), totalPages);
  const firstIndex = (page - 1) * fallbackPageSize;
  const visibleRows = filteredRows.slice(firstIndex, firstIndex + fallbackPageSize);
  const rows = visibleRows.map((entry) => {
    const href = detailHref(entry.repo, entry.id, filter, page);
    return `<tr><td><a href="${href}"><span class="row-title">${escapeHtml(entry.repo)}/${escapeHtml(entry.id)}</span><span class="row-subtitle">${escapeHtml(entry.title)}</span></a></td><td><span class="pill ${escapeHtml(entry.status)}">${escapeHtml(entry.statusLabel)}</span></td><td>${entry.done}/${entry.total} done · ${entry.percent}%<div class="bar"><span style="width:${entry.percent}%"></span></div></td><td class="timestamp">${escapeHtml(fallbackTimestamp(entry.updatedAt))}</td></tr>`;
  }).join("") || `<tr><td colspan="4">No Burnlists in this lifecycle view.</td></tr>`;
  const previous = page > 1
    ? `<a rel="prev" href="${fallbackListHref(filter, page - 1)}">Previous</a>`
    : `<span class="disabled" aria-disabled="true">Previous</span>`;
  const next = page < totalPages
    ? `<a rel="next" href="${fallbackListHref(filter, page + 1)}">Next</a>`
    : `<span class="disabled" aria-disabled="true">Next</span>`;
  const pagination = totalPages > 1
    ? `<nav class="pagination" aria-label="Burnlist table pages"><span>Showing ${firstIndex + 1}–${Math.min(firstIndex + fallbackPageSize, filteredRows.length)} of ${filteredRows.length}</span><span class="page-controls">${previous}<span>Page ${page} of ${totalPages}</span>${next}</span></nav>`
    : "";
  return `<main class="burnlist-fallback">${FALLBACK_STYLE}${OVEN_STYLE}<header class="page-header"><div class="brand-lockup"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 512 512"><path fill="#d4d4d8" fill-rule="evenodd" d="M278 32 C246 54 220 88 204 126 C188 166 196 219 184 238 C172 258 153 249 157 221 C160 197 157 174 159 166 C122 200 100 241 94 284 C80 375 144 462 248 478 C353 494 418 413 418 328 C418 274 400 220 365 184 C372 226 362 262 349 279 C344 249 327 190 275 110 C263 82 264 54 278 32Z M256 236 C270 289 294 322 348 342 C294 354 270 384 256 436 C242 384 218 354 164 342 C218 322 242 289 256 236Z"/></svg><div><h1>Burnlists</h1><p>Let it cook</p></div></div></header><div class="table-toolbar"><nav class="filters" aria-label="Burnlist lifecycle">${filters}</nav><nav class="burn-actions" aria-label="Burn actions"><a class="action-button" href="/ovens/new">New Oven</a><a class="action-button primary" href="/runs/new">Run Burn</a></nav></div><div class="table-wrap"><table><thead><tr><th>Burnlist</th><th>Lifecycle</th><th>Progress</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table>${pagination}</div></main>`;
}

function fallbackDetail(data, filter, page) {
  const goal = data.goal?.sections?.map((section) => `<section class="document-section"><h2>${escapeHtml(section.title)}</h2>${section.body ? `<pre>${escapeHtml(section.body)}</pre>` : ""}</section>`).join("") ?? "";
  const active = data.active?.map((item) => `<article class="completion"><h2>${escapeHtml(item.id)} ${escapeHtml(item.title)}</h2><pre>${escapeHtml(Object.entries(item.fields || {}).map(([key, value]) => `${key}: ${value}`).join("\n"))}</pre></article>`).join("") ?? "";
  const completed = data.completed?.map((item) => `<article class="completion"><h2>${escapeHtml(item.id)} ${escapeHtml(item.title)}</h2><p class="timestamp">${escapeHtml(fallbackTimestamp(item.completedAt))}</p>${item.detail ? `<pre>${escapeHtml(item.detail)}</pre>` : ""}</article>`).join("") ?? "";
  return `<main class="burnlist-fallback">${FALLBACK_STYLE}<a class="back" href="${fallbackListHref(filter, page)}">← All Burnlists</a><section class="card hero"><h1>${escapeHtml(data.title)}</h1><p>${escapeHtml(data.repo)}/${escapeHtml(data.planLabel)}</p><div class="bar"><span style="width:${data.percent}%"></span></div></section><div class="grid"><section class="card metric">Completed<strong>${data.done}/${data.total}</strong></section><section class="card metric">Remaining<strong>${data.remaining}</strong></section><section class="card metric">Progress<strong>${data.percent}%</strong></section><section class="card metric">Signals<strong>${data.warnings.length}</strong></section></div>${goal ? `<section class="card section"><h2>Goal and guardrails</h2>${goal}</section>` : ""}${active ? `<section class="card section"><h2>Active checklist</h2>${active}</section>` : ""}<section class="card section"><h2>Completed detail</h2>${completed || "<p>No completion records.</p>"}</section></main>`;
}

function fallbackNewOven() {
  return `<main class="burnlist-fallback oven-page">${FALLBACK_STYLE}${OVEN_STYLE}<a class="back" href="/">← Burnlists</a><header class="page-header"><h1>New Oven</h1><p>A declarative Burn recipe: Markdown instructions plus a non-executable detail skeleton.</p></header><form class="form-shell" id="oven-form"><div class="form-grid"><section class="form-card oven-definition-card"><div class="oven-fields-row"><label class="field"><span>Oven name</span><input id="oven-name" maxlength="80" placeholder="Release Readiness" required></label><label class="field"><span>Oven id</span><input id="oven-id" maxlength="48" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="release-readiness" required></label><label class="field"><span>Columns</span><input id="grid-columns" type="number" min="2" max="24" value="12"></label><label class="field"><span>Rows</span><input id="grid-rows" type="number" min="2" max="32" value="16"></label></div><label class="field"><span>Markdown instructions</span><textarea id="oven-definition" maxlength="65536" required>## Purpose&#10;&#10;Describe what this Oven measures or completes.&#10;&#10;## State Contract&#10;&#10;Describe the canonical Markdown or report state.&#10;&#10;## Run Inputs&#10;&#10;Describe the inputs a Burn needs.&#10;&#10;## Evidence&#10;&#10;Describe what proves the outcome.</textarea></label></section><section class="oven-builder"><div class="oven-grid" id="oven-grid" aria-label="Oven detail page skeleton"></div></section></div><div class="form-actions"><a class="action-button" href="/">Cancel</a><button class="action-button primary" id="save-oven" type="submit">Save Oven</button></div><output class="form-status" id="oven-status" aria-live="polite"></output></form><script src="/assets/fallback-burn-ovens.js" defer></script></main>`;
}

function fallbackRunBurn() {
  return `<main class="burnlist-fallback">${FALLBACK_STYLE}${OVEN_STYLE}<a class="back" href="/">← Burnlists</a><header class="page-header"><h1>Run Burn</h1><p>Choose an Oven and create an immutable local Run snapshot. The app never executes Oven instructions.</p></header><form class="form-shell form-card" id="run-form"><label class="field"><span>Oven</span><select id="run-oven" required></select></label><label class="field"><span>Repository</span><select id="run-repo" required></select></label><label class="field"><span>Run title</span><input id="run-title" maxlength="120" placeholder="Release readiness pass" required></label><label class="field"><span>Objective</span><textarea id="run-objective" maxlength="12000" placeholder="Describe the outcome and any Oven-required inputs. For Target, include the measurement source, target, active gate, and comparable procedure." required></textarea></label><p class="hint">The Run snapshots the selected Oven instructions and detail skeleton under ignored local state. It does not execute commands from the instructions.</p><div class="form-actions"><a class="action-button" href="/">Cancel</a><button class="action-button primary" id="create-run" type="submit">Run Burn</button></div><output class="form-status" id="run-status" aria-live="polite"></output></form><script src="/assets/fallback-burn-ovens.js" defer></script></main>`;
}

function dashboardFallback(url) {
  if (url.pathname === "/ovens/new") return fallbackNewOven();
  if (url.pathname === "/runs/new") return fallbackRunBurn();
  if (url.pathname === "/targets") return `<main class="burnlist-fallback">${FALLBACK_STYLE}<h1>Targets</h1><p>No Targets configured.</p></main>`;
  const selection = selectedBurnlist(url);
  if (selection.burnlist) {
    try {
      return fallbackDetail(payloadForPlan(selection.burnlist), url.searchParams.get("filter") || "all", fallbackPage(url.searchParams.get("page")));
    } catch (err) {
      return `<main class="burnlist-fallback">${FALLBACK_STYLE}<h1>Burnlist unavailable</h1><p>${escapeHtml(err.message)}</p></main>`;
    }
  }
  return fallbackIndex(url);
}

function serveDashboardShell(res, url) {
  html(res, 200, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Burnlists</title>
<style>html{background:#050507;color-scheme:dark}body{margin:0;background:#050507;color:#e5e7eb}</style>
</head>
<body>${dashboardFallback(url)}</body>
</html>`);
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Burnlists and Targets</title>
<style>
:root { color-scheme: dark; --bg:#101214; --panel:#171a1e; --line:#2a3036; --text:#e8edf2; --muted:#97a2ad; --accent:#6db6ff; --done:#67d391; --warn:#f2bf73; --bad:#ff8a8a; }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); }
[hidden] { display:none !important; }
.topbar { border-bottom:1px solid var(--line); background:#0d0f11; }
.topbar-inner { width:min(1180px, calc(100vw - 32px)); margin:0 auto; display:flex; gap:6px; align-items:center; padding:10px 0; }
.brand-mark { width:28px; height:28px; display:inline-grid; place-items:center; flex:0 0 auto; margin-right:6px; border:1px solid rgba(232,237,242,.18); border-radius:6px; background:#e8edf2; }
.brand-mark svg { width:20px; height:20px; display:block; }
.nav-link { color:var(--muted); padding:7px 10px; border:1px solid transparent; border-radius:6px; font-weight:650; }
.nav-link:hover { color:var(--text); }
.nav-link.selected { color:#fff; border-color:rgba(109,182,255,.55); background:#151a1f; }
.shell { width:min(1180px, calc(100vw - 32px)); margin:0 auto; padding:18px 0 28px; }
header { display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin-bottom:16px; }
h1 { margin:0; font-size:22px; font-weight:650; letter-spacing:0; }
a { color:var(--accent); text-decoration:none; }
button, select { color:var(--text); background:#20252b; border:1px solid var(--line); border-radius:6px; padding:7px 10px; font:inherit; }
button { cursor:pointer; }
button.selected { border-color:var(--accent); color:#fff; }
.toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.grid { display:grid; grid-template-columns: minmax(280px, 360px) 1fr; gap:14px; align-items:start; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; min-width:0; }
.list { display:grid; gap:8px; }
.row { display:grid; grid-template-columns:1fr auto; gap:8px; padding:10px; border:1px solid var(--line); border-radius:6px; background:#13161a; }
.row strong { display:block; font-weight:650; }
.meta { color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
.timestamp { font-size:13px; }
.pill { justify-self:end; color:var(--muted); font-size:12px; border:1px solid var(--line); border-radius:999px; padding:2px 8px; }
.pill.active { color:var(--accent); border-color:rgba(109,182,255,.55); }
.pill.complete { color:var(--done); border-color:rgba(103,211,145,.55); }
.stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:14px; }
.stat { padding:10px; border:1px solid var(--line); border-radius:6px; background:#13161a; }
.label { color:var(--muted); font-size:12px; }
.value { font-size:24px; font-weight:700; margin-top:2px; }
.bar { height:12px; overflow:hidden; border-radius:999px; background:#242a30; border:1px solid var(--line); margin-bottom:14px; }
.bar > div { height:100%; width:0%; background:linear-gradient(90deg,var(--accent),var(--done)); }
.columns { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.items { display:grid; gap:8px; }
.item { border:1px solid var(--line); border-radius:6px; padding:10px; background:#13161a; }
.item-title { font-weight:650; }
.item-body { margin-top:6px; color:var(--muted); white-space:pre-wrap; overflow-wrap:anywhere; }
.warning { color:var(--warn); }
.error { color:var(--bad); }
.empty { color:var(--muted); padding:12px; }
@media (max-width: 800px) { .grid, .columns, .stats { grid-template-columns:1fr; } header { display:block; } .toolbar { margin-top:12px; } }
</style>
</head>
<body>
<nav class="topbar" aria-label="Dashboard sections">
  <div class="topbar-inner">
    <span class="brand-mark">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="burnlist-logo-title burnlist-logo-desc">
        <title id="burnlist-logo-title">Burnlist</title>
        <desc id="burnlist-logo-desc">Star flame icon</desc>
        <path fill="#000000" fill-rule="evenodd" d="M278 32 C246 54 220 88 204 126 C188 166 196 219 184 238 C172 258 153 249 157 221 C160 197 157 174 159 166 C122 200 100 241 94 284 C80 375 144 462 248 478 C353 494 418 413 418 328 C418 274 400 220 365 184 C372 226 362 262 349 279 C344 249 327 190 275 110 C263 82 264 54 278 32Z M256 236 C270 289 294 322 348 342 C294 354 270 384 256 436 C242 384 218 354 164 342 C218 322 242 289 256 236Z"/>
      </svg>
    </span>
    <a class="nav-link" data-section="burnlists" href="/">Burnlists</a>
    <a class="nav-link" data-section="targets" href="/targets">Targets</a>
  </div>
</nav>
<div class="shell">
  <header>
    <div>
      <h1 id="title">Burnlists</h1>
      <div class="meta" id="subtitle">notes/burnlists</div>
    </div>
    <div class="toolbar" id="filters">
      <button data-filter="active">Active</button>
      <button data-filter="draft">Draft</button>
      <button data-filter="ready">Ready</button>
      <button data-filter="complete">Done</button>
      <button data-filter="all">All</button>
    </div>
  </header>
  <main class="grid" id="burnlists-view">
    <section class="panel">
      <div class="list" id="burnlists"></div>
    </section>
    <section class="panel" id="detail">
      <div class="empty">Select a Burnlist.</div>
    </section>
  </main>
  <main class="panel" id="targets-view" hidden>
    <div class="empty">No Targets configured.</div>
  </main>
</div>
<script>
let filter = new URLSearchParams(location.search).get("filter") || "active";
let burnlists = [];
function qs(value) { return encodeURIComponent(value); }
function setText(node, text) { if (node) node.textContent = text; }
function itemUrl(item) { return "/" + qs(item.repo) + "/" + qs(item.id); }
function currentSection() { return location.pathname === "/targets" ? "targets" : "burnlists"; }
function selectedKey() {
  if (currentSection() === "targets") return "";
  const parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 2) return parts.join("/");
  const params = new URLSearchParams(location.search);
  return params.get("repo") && params.get("id") ? params.get("repo") + "/" + params.get("id") : "";
}
function renderChrome() {
  const section = currentSection();
  document.querySelectorAll("[data-section]").forEach((link) => link.classList.toggle("selected", link.dataset.section === section));
  document.querySelector("#burnlists-view").hidden = section !== "burnlists";
  document.querySelector("#targets-view").hidden = section !== "targets";
  document.querySelector("#filters").hidden = section !== "burnlists";
  if (section === "targets") {
    setText(document.querySelector("#title"), "Targets");
    setText(document.querySelector("#subtitle"), "Target");
  } else if (!selectedKey()) {
    setText(document.querySelector("#title"), "Burnlists");
    setText(document.querySelector("#subtitle"), "notes/burnlists");
  }
}
function renderIndex() {
  document.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("selected", button.dataset.filter === filter));
  const selected = selectedKey();
  const rows = burnlists.filter((item) => filter === "all" || item.status === filter);
  const root = document.querySelector("#burnlists");
  root.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No Burnlists in this view.";
    root.append(empty);
    return;
  }
  for (const item of rows) {
    const row = document.createElement("a");
    row.className = "row";
    row.href = itemUrl(item);
    if (selected === item.repo + "/" + item.id) row.style.borderColor = "var(--accent)";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.repo + "/" + item.id;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = item.title + " - " + item.done + "/" + item.total + " done";
    text.append(title, meta);
    const pill = document.createElement("div");
    pill.className = "pill " + item.status;
    pill.textContent = item.statusLabel;
    row.append(text, pill);
    root.append(row);
  }
}
function renderDetail(data) {
  const detail = document.querySelector("#detail");
  setText(document.querySelector("#title"), data.title || "Burnlist Progress");
  setText(document.querySelector("#subtitle"), data.repo + "/" + data.planLabel);
  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("div");
  fill.style.width = data.percent + "%";
  bar.append(fill);
  const stats = document.createElement("div");
  stats.className = "stats";
  for (const [label, value] of [["Done", data.done + "/" + data.total], ["Remaining", data.remaining], ["Progress", data.percent + "%"], ["Warnings", data.warnings.length]]) {
    const stat = document.createElement("div");
    stat.className = "stat";
    const l = document.createElement("div");
    l.className = "label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "value";
    v.textContent = value;
    stat.append(l, v);
    stats.append(stat);
  }
  const warnings = document.createElement("div");
  warnings.className = "items";
  for (const issue of data.warnings || []) {
    const row = document.createElement("div");
    row.className = "item " + (issue.severity === "error" ? "error" : "warning");
    row.textContent = issue.severity.toUpperCase() + ": " + issue.message;
    warnings.append(row);
  }
  const columns = document.createElement("div");
  columns.className = "columns";
  columns.append(listSection("Active Checklist", data.active || [], true), listSection("Completed", data.completed || [], false));
  detail.replaceChildren(stats, bar, warnings, columns);
}
function listSection(titleText, rows, active) {
  const section = document.createElement("section");
  const title = document.createElement("h2");
  title.textContent = titleText;
  const list = document.createElement("div");
  list.className = "items";
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = active ? "No active items." : "No completed ledger entries.";
    list.append(empty);
  }
  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "item";
    const head = document.createElement("div");
    head.className = "item-title";
    head.textContent = row.id + " | " + row.title;
    item.append(head);
    if (active) {
      const body = document.createElement("div");
      body.className = "item-body timestamp";
      body.textContent = Object.entries(row.fields || {}).map(([key, value]) => key + ": " + value).join("\\n");
      item.append(body);
    } else {
      const body = document.createElement("div");
      body.className = "item-body";
      body.textContent = row.completedAt;
      item.append(body);
    }
    list.append(item);
  }
  section.append(title, list);
  return section;
}
async function refresh() {
  renderChrome();
  if (currentSection() === "targets") return;
  const indexRes = await fetch("/api/burnlists", { cache: "no-store" });
  const indexData = await indexRes.json();
  burnlists = indexData.burnlists || [];
  renderIndex();
  if (selectedKey()) {
    const parts = selectedKey().split("/");
    const res = await fetch("/api/progress?repo=" + qs(parts[0]) + "&id=" + qs(parts[1]), { cache: "no-store" });
    if (res.ok) renderDetail(await res.json());
  }
}
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    history.replaceState(null, "", "?filter=" + qs(filter));
    renderIndex();
  });
});
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}

if (!reportMode) mkdirSync(stateDir, { recursive: true });

function stopExistingIfRequested() {
  if (!args.has("stop") && !args.has("replace")) return;
  const runtime = existsSync(runtimePath) ? JSON.parse(readFileSync(runtimePath, "utf8")) : null;
  if (runtime?.pid && Number.isInteger(runtime.pid)) {
    try {
      process.kill(runtime.pid, "SIGTERM");
    } catch {}
  }
  rmSync(runtimePath, { force: true });
  if (args.has("stop")) {
    console.log("Stopped Burnlist index server.");
    process.exit(0);
  }
}

stopExistingIfRequested();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";
    if (["/assets/fallback-burn-ovens.js", "/assets/fallback-burn-types.js"].includes(url.pathname)) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      javascript(res, 200, readTextFileWithLimit(fallbackBurnOvensScriptPath, 262144, "Fallback Oven script"));
      return;
    }
    if (url.pathname === "/api/burnlists") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      json(res, 200, { generatedAt: new Date().toISOString(), burnlists: discoverBurnlists() });
      return;
    }
    if (url.pathname === "/api/progress") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const selected = selectedBurnlist(url);
      if (!selected.burnlist) {
        json(res, 409, { error: selected.error, burnlists: selected.burnlists });
        return;
      }
      try {
        json(res, 200, payloadForPlan(selected.burnlist));
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }
    if (url.pathname === "/api/ovens") {
      if (method === "GET") {
        json(res, 200, { ovens: discoverOvens().map(ovenSummary), writeToken });
        return;
      }
      if (method === "POST") {
        assertWriteRequest(req);
        const oven = createOven(await readJsonRequest(req));
        json(res, 201, { oven: { ...ovenSummary(oven), instructions: oven.instructions, detail: oven.detail, path: oven.path } });
        return;
      }
      return json(res, 405, { error: "method not allowed" });
    }
    const ovenRoute = url.pathname.match(/^\/api\/ovens\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u);
    if (ovenRoute) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const oven = discoverOvens().find((entry) => entry.id === ovenRoute[1]);
      if (!oven) return json(res, 404, { error: "oven not found" });
      json(res, 200, { oven });
      return;
    }
    // Legacy API aliases are read-compatible; the app itself only speaks Oven.
    if (url.pathname === "/api/types") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      json(res, 200, {
        types: discoverOvens().map((oven) => ({
          ...ovenSummary(oven),
          dashboard: { columns: oven.detail.columns, rows: oven.detail.rows, cells: oven.detail.cells.length },
        })),
        writeToken,
      });
      return;
    }
    const legacyTypeRoute = url.pathname.match(/^\/api\/types\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u);
    if (legacyTypeRoute) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const oven = discoverOvens().find((entry) => entry.id === legacyTypeRoute[1]);
      if (!oven) return json(res, 404, { error: "oven not found" });
      json(res, 200, { type: { ...oven, definition: oven.instructions, dashboard: oven.detail } });
      return;
    }
    if (url.pathname === "/api/repos") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      json(res, 200, { repos: discoveredRepos() });
      return;
    }
    if (url.pathname === "/api/runs") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      assertWriteRequest(req);
      const run = createBurnRun(await readJsonRequest(req));
      json(res, 201, { run });
      return;
    }
    const runRoute = url.pathname.match(/^\/api\/runs\/(\d{8}-\d{6}-[a-f0-9]{6})$/u);
    if (runRoute) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const run = readBurnRun(runRoute[1]);
      if (!run) return json(res, 404, { error: "burn run not found" });
      json(res, 200, { run });
      return;
    }
    if (legacyDetailOrigin && routeSelection(url)) {
      res.writeHead(302, { location: `${legacyDetailOrigin}${url.pathname}${url.search}` });
      res.end();
      return;
    }
    if (url.pathname === "/types/new") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      res.writeHead(308, { location: "/ovens/new" });
      res.end();
      return;
    }
    if (["/", "/index.html", "/targets", "/ovens/new", "/runs/new"].includes(url.pathname) || routeSelection(url)) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      serveDashboardShell(res, url);
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, Number.isInteger(error.status) ? error.status : 400, { error: error.message || "request failed" });
  }
});

function listen(port) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && autoPort && port < initialPort + 25) {
      listen(port + 1);
      return;
    }
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the existing service, choose another port, or pass --auto-port.`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    const url = `http://${host}:${actualPort}/`;
    writeFileSync(runtimePath, `${JSON.stringify({ pid: process.pid, url, host, port: actualPort, startedAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(url);
    console.error(`PID: ${process.pid}`);
    console.error(`Runtime: ${runtimePath}`);
  });
}

listen(initialPort);
