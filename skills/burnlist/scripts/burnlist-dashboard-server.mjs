#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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
import { assertDifferentialTestingData } from "./differential-testing-data-contract.mjs";
import { buildRepoMapAsync } from "./repo-map.mjs";

const args = new Map();
const allowedArgs = new Set([
  "allow-non-loopback",
  "auto-port",
  "check",
  "close-completed",
  "digest",
  "host",
  "max-history-entries",
  "max-oven-data-bytes",
  "max-plan-bytes",
  "oven-data",
  "ovens-dir",
  "plan",
  "port",
  "replace",
  "runs-dir",
  "scan-root",
  "stamp",
  "state-dir",
  "stop",
]);
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) {
    console.error(`Unexpected argument: ${arg}`);
    process.exit(2);
  }
  const key = arg.slice(2);
  if (!allowedArgs.has(key)) {
    console.error(`Unknown option: --${key}`);
    process.exit(2);
  }
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
const maxOvenDataBytes = positiveInteger(args.get("max-oven-data-bytes") ?? "67108864", "max-oven-data-bytes");
const stateDir = resolve(launchCwd, args.get("state-dir") ?? ".local/burnlist/checklist-progress");
const runtimePath = resolve(stateDir, "index.server.json");
const historyPath = resolve(stateDir, "index.history.jsonl");
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardDistDir = resolve(skillDir, "dashboard", "dist");
const dashboardIndexPath = resolve(dashboardDistDir, "index.html");
const builtInOvensDir = resolve(skillDir, "ovens");
const customOvensDir = resolve(launchCwd, args.get("ovens-dir") ?? ".local/burnlist/ovens");
const runsDir = resolve(launchCwd, args.get("runs-dir") ?? ".local/burnlist/runs");
const ovenDataBindings = parseOvenDataBindings(args.get("oven-data") ?? "");
const writeToken = randomBytes(24).toString("hex");
const repoMapCache = new Map();
let differentialTestingDataCache = null;
const REPO_MAP_CACHE_MS = 2_000;

function cachedRepoMap(repo) {
  const key = repo.root;
  const now = Date.now();
  const cached = repoMapCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = buildRepoMapAsync({ repoRoot: repo.root, repoName: repo.name })
    .catch((error) => {
      if (repoMapCache.get(key)?.promise === promise) repoMapCache.delete(key);
      throw error;
    });
  repoMapCache.set(key, { expiresAt: now + REPO_MAP_CACHE_MS, promise });
  return promise;
}

function differentialTestingIndexCache(path) {
  const readPath = resolve(realpathSync(dirname(path)), basename(path));
  const stat = safeStat(readPath);
  if (!stat?.isFile()) throw new Error("configured Differential Testing data is missing");
  const signature = `${readPath}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`;
  if (differentialTestingDataCache?.signature === signature) return differentialTestingDataCache;
  const source = readTextFileWithLimit(readPath, maxOvenDataBytes, "Oven differential-testing data");
  const payload = JSON.parse(source);
  assertDifferentialTestingData(payload);
  differentialTestingDataCache = {
    signature,
    readPath,
    source,
    sourceBytes: stat.size,
    etag: `W/\"dt-${stat.ino}-${stat.size}-${Math.trunc(stat.mtimeMs)}\"`,
    selectedScenarioId: payload.scenarioCatalog.selectedScenarioId,
    scenarios: structuredClone(payload.scenarioCatalog.scenarios),
    scenarioResponses: new Map(),
  };
  return differentialTestingDataCache;
}

function differentialTestingScenarioCache(index, scenarioId) {
  const cached = index.scenarioResponses.get(scenarioId);
  const scenariosDir = resolve(dirname(index.readPath), "scenarios");
  const scenarioPath = resolve(scenariosDir, `${scenarioId}.json`);
  const scenarioRelativePath = relative(scenariosDir, scenarioPath);
  if (!scenarioRelativePath || scenarioRelativePath.startsWith("..") || resolve(scenariosDir, scenarioRelativePath) !== scenarioPath) {
    throw Object.assign(new Error("scenario path escapes the published bundle"), { status: 400 });
  }
  const stat = safeStat(scenarioPath);
  if (!stat?.isFile()) throw Object.assign(new Error(`published data for scenario ${scenarioId} is missing`), { status: 404 });
  const signature = `${index.signature}\0${scenarioPath}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`;
  if (cached?.signature === signature) return cached;
  const sourcePayload = JSON.parse(readTextFileWithLimit(
    scenarioPath,
    maxOvenDataBytes,
    `Differential Testing scenario ${scenarioId}`,
  ));
  assertDifferentialTestingData(sourcePayload);
  if (sourcePayload.scenarioCatalog.selectedScenarioId !== scenarioId) {
    throw Object.assign(new Error(`scenario file ${scenarioId} selects ${sourcePayload.scenarioCatalog.selectedScenarioId}`), { status: 422 });
  }
  const indexScenario = index.scenarios.find((scenario) => scenario.id === scenarioId);
  const payloadScenario = sourcePayload.scenarioCatalog.scenarios.find((scenario) => scenario.id === scenarioId);
  if (JSON.stringify(payloadScenario) !== JSON.stringify(indexScenario)) {
    throw Object.assign(new Error(`scenario file ${scenarioId} does not match its published catalog entry`), { status: 422 });
  }
  const payload = {
    ...sourcePayload,
    scenarioCatalog: { selectedScenarioId: scenarioId, scenarios: index.scenarios },
  };
  assertDifferentialTestingData(payload);
  const source = JSON.stringify(payload);
  const result = {
    signature,
    readPath: scenarioPath,
    source,
    sourceBytes: Buffer.byteLength(source),
    etag: `W/\"dt-${stat.ino}-${stat.size}-${Math.trunc(stat.mtimeMs)}-${index.etag.slice(3, -1)}\"`,
    selectedScenarioId: scenarioId,
  };
  index.scenarioResponses.set(scenarioId, result);
  return result;
}

function sendDifferentialTestingData(req, res, cached) {
  if (req.headers["if-none-match"] === cached.etag) {
    res.writeHead(304, { etag: cached.etag, "cache-control": "no-store" });
    res.end();
    return;
  }
  const prefix = `${JSON.stringify({
    ovenId: "differential-testing",
    path: cached.readPath,
    scenarioId: cached.selectedScenarioId,
  }).slice(0, -1)},\"payload\":`;
  const suffix = "}";
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    etag: cached.etag,
    "content-length": Buffer.byteLength(prefix) + cached.sourceBytes + Buffer.byteLength(suffix),
  });
  res.write(prefix);
  res.write(cached.source);
  res.end(suffix);
}

function warmDifferentialTestingData() {
  const path = ovenDataBindings.get("differential-testing");
  if (!path) return;
  try {
    differentialTestingIndexCache(path);
  } catch {
    // The request path reports validation errors; background warming remains silent.
  }
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`Invalid --${name}: ${value}`);
    process.exit(2);
  }
  return parsed;
}

function parseOvenDataBindings(value) {
  const bindings = new Map();
  for (const rawBinding of String(value).split(",").map((entry) => entry.trim()).filter(Boolean)) {
    const separator = rawBinding.indexOf("=");
    if (separator <= 0 || separator === rawBinding.length - 1) {
      console.error(`Invalid --oven-data binding: ${rawBinding}. Expected <oven-id>=<json-path>.`);
      process.exit(2);
    }
    const id = ovenId(rawBinding.slice(0, separator));
    const path = resolve(launchCwd, rawBinding.slice(separator + 1));
    if (bindings.has(id)) {
      console.error(`Duplicate --oven-data binding for ${id}.`);
      process.exit(2);
    }
    bindings.set(id, path);
  }
  return bindings;
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

function checklistDashboardEntries() {
  return discoverBurnlists().map((entry) => ({
    ...entry,
    ovenId: "checklist",
    ovenName: "Checklist",
    href: `/${encodeURIComponent(entry.repo)}/${encodeURIComponent(entry.id)}`,
    progressLabel: `${entry.done}/${entry.total} done`,
  }));
}

function differentialTestingDashboardEntries() {
  const path = ovenDataBindings.get("differential-testing");
  if (!path) return [];
  const index = differentialTestingIndexCache(path);
  const repo = discoveredRepos()
    .filter((entry) => index.readPath === entry.root || index.readPath.startsWith(`${entry.root}/`))
    .sort((left, right) => right.root.length - left.root.length)[0]?.name ?? "differential-testing";
  return index.scenarios.map((scenario) => ({
    id: scenario.id,
    repo,
    title: scenario.label,
    status: "active",
    statusLabel: "Active",
    total: scenario.frameCount,
    done: null,
    remaining: null,
    percent: null,
    errors: 0,
    warnings: 0,
    updatedAt: scenario.updatedAt,
    ovenId: "differential-testing",
    ovenName: "Differential Testing",
    href: `/ovens/differential-testing/view?scenario=${encodeURIComponent(scenario.id)}`,
    progressLabel: `${scenario.frameCount} frames`,
  }));
}

function dashboardEntries() {
  return [...checklistDashboardEntries(), ...differentialTestingDashboardEntries()]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

function instructionsName(instructions, defaultName) {
  const heading = instructions.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line.trim()));
  return heading ? heading.trim().replace(/^#\s+/u, "").trim() : defaultName;
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
  const instructionsPath = join(ovenRoot, "instructions.md");
  const detailPath = join(ovenRoot, "detail.json");
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
  assertKnownKeys(value, new Set(["id", "name", "instructions", "detail"]), "Oven");
  const id = ovenId(value.id);
  if (discoverOvens().some((oven) => oven.id === id)) throw new Error(`Oven ${id} already exists.`);
  const name = boundedText(value.name, "Oven name", 80);
  let instructions = boundedText(value.instructions, "Markdown instructions", 65536);
  const instructionLines = instructions.split(/\r?\n/u);
  const titleLine = instructionLines.findIndex((line) => /^#\s+\S/u.test(line.trim()));
  if (titleLine === -1) instructionLines.unshift(`# ${name}`, "");
  else instructionLines[titleLine] = `# ${name}`;
  instructions = instructionLines.join("\n");
  const detail = normalizeOvenDetail(value.detail);
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

function repoMapSelection(url) {
  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.some((key) => key !== "repo")) {
    return { status: 400, error: "repo is the only supported repo-map query parameter." };
  }
  const requestedRepos = url.searchParams.getAll("repo");
  if (requestedRepos.length !== 1 || requestedRepos[0].trim() === "") {
    return { status: 400, error: "repo must be supplied exactly once." };
  }
  const requestedRepo = requestedRepos[0];
  const matches = discoveredRepos().filter((repo) => repo.name === requestedRepo);
  if (matches.length === 0) return { status: 404, error: `Unknown repository: ${requestedRepo}` };
  if (matches.length > 1) return { status: 409, error: `Ambiguous repository: ${requestedRepo}` };
  return { status: 200, repo: matches[0] };
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
  assertKnownKeys(value, new Set(["ovenId", "repoRoot", "title", "objective"]), "Burn run");
  const selectedOvenId = ovenId(value.ovenId);
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
  assertKnownKeys(record, new Set([
    "schemaVersion",
    "id",
    "ovenId",
    "repoRoot",
    "repo",
    "title",
    "status",
    "createdAt",
    "updatedAt",
    "inputs",
    "summary",
    "sections",
  ]), "Burn run");
  ovenId(record.ovenId);
  return record;
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
  if (
    parts.length === 2
    && !["api", "ovens", "runs"].includes(parts[0])
    && discoveredRepos().some((repo) => repo.name === parts[0])
  ) return { repo: parts[0], id: parts[1] };
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
  const serialized = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(serialized),
  });
  res.end(serialized);
}

function dashboardAssetPath(pathname) {
  if (pathname === "/favicon.svg") return resolve(dashboardDistDir, "favicon.svg");
  const match = pathname.match(/^\/assets\/([A-Za-z0-9._-]+)$/u);
  return match ? resolve(dashboardDistDir, "assets", match[1]) : null;
}

function dashboardContentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}

function serveDashboardFile(res, path, { cache = false, missingStatus = 500 } = {}) {
  const stat = safeStat(path);
  if (!stat?.isFile()) {
    const error = new Error(`Dashboard build file is missing: ${relative(skillDir, path)}`);
    error.status = missingStatus;
    throw error;
  }
  const body = readFileSync(path);
  res.writeHead(200, {
    "content-type": dashboardContentType(path),
    "cache-control": cache ? "public, max-age=31536000, immutable" : "no-store",
    "content-length": body.length,
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function serveDashboardShell(res) {
  serveDashboardFile(res, dashboardIndexPath);
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
    const dashboardAsset = dashboardAssetPath(url.pathname);
    if (dashboardAsset) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      serveDashboardFile(res, dashboardAsset, {
        cache: url.pathname.startsWith("/assets/"),
        missingStatus: 404,
      });
      return;
    }
    if (url.pathname === "/api/burnlists") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      json(res, 200, { generatedAt: new Date().toISOString(), burnlists: dashboardEntries() });
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
    const ovenDataRoute = url.pathname.match(/^\/api\/oven-data\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u);
    if (ovenDataRoute) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const id = ovenDataRoute[1];
      const path = ovenDataBindings.get(id);
      if (!path) return json(res, 404, { error: `no data binding configured for Oven ${id}` });
      try {
        if (id === "differential-testing") {
          const index = differentialTestingIndexCache(path);
          const requestedScenarioIds = url.searchParams.getAll("scenario");
          if (requestedScenarioIds.length > 1) return json(res, 400, { error: "scenario must be supplied at most once" });
          const requestedScenarioId = requestedScenarioIds[0] ?? "";
          if (!requestedScenarioId || requestedScenarioId === index.selectedScenarioId) {
            sendDifferentialTestingData(req, res, index);
            return;
          }
          if (!/^[a-f0-9]{16}$/u.test(requestedScenarioId)) return json(res, 400, { error: "scenario must be a lowercase 16-character hexadecimal id" });
          if (!index.scenarios.some((scenario) => scenario.id === requestedScenarioId)) return json(res, 404, { error: `scenario ${requestedScenarioId} is not in the published catalog` });
          sendDifferentialTestingData(req, res, differentialTestingScenarioCache(index, requestedScenarioId));
          return;
        }
        const readPath = path;
        if (!safeStat(readPath)?.isFile()) return json(res, 404, { error: `configured data for Oven ${id} is missing` });
        const indexPayload = JSON.parse(readTextFileWithLimit(readPath, maxOvenDataBytes, `Oven ${id} data`));
        json(res, 200, { ovenId: id, path: readPath, payload: indexPayload });
      } catch (error) {
        json(res, Number.isInteger(error.status) ? error.status : 422, {
          error: error instanceof SyntaxError ? `Oven ${id} data is not valid JSON: ${error.message}` : error.message,
          issues: Array.isArray(error.issues) ? error.issues : undefined,
        });
      }
      return;
    }
    if (url.pathname === "/api/repo-map") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const selection = repoMapSelection(url);
      if (!selection.repo) return json(res, selection.status, { error: selection.error });
      try {
        json(res, 200, await cachedRepoMap(selection.repo));
      } catch (error) {
        json(res, 422, { error: `Could not build repository map: ${error.message}` });
      }
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
    if (["/", "/index.html", "/ovens/new", "/ovens/differential-testing/view", "/runs/new"].includes(url.pathname) || routeSelection(url)) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      serveDashboardShell(res);
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
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

if (!reportMode && ovenDataBindings.has("differential-testing")) {
  warmDifferentialTestingData();
  const differentialTestingWarmTimer = setInterval(warmDifferentialTestingData, 1_000);
  differentialTestingWarmTimer.unref();
}

listen(initialPort);
