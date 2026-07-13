#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { mutatorRepoRoots, observerRepoRoots } from "./discovery.mjs";
import { classifyRoots, readRegistry, repoKey } from "./registry.mjs";
import { buildProjectsSnapshot } from "./projects.mjs";
import { containedJoin, repoStateDir, withRepoStateLock } from "./repo-state.mjs";
import {
  assertKnownKeys,
  boundedText,
  normalizeOvenDetail,
  normalizeOvenPackage,
  ovenId,
} from "../ovens/oven-contract.mjs";
import { assertDifferentialTestingData } from "../../ovens/differential-testing/engine/differential-testing-data-contract.mjs";
import {
  DIFFERENTIAL_TESTING_PAGE_SCHEMA,
  isDifferentialTestingBundle,
  queryDifferentialTestingFieldPage,
  readDifferentialTestingBundleManifest,
  readDifferentialTestingBundleScenario,
} from "../../ovens/differential-testing/engine/differential-testing-transport.mjs";
import { buildRepoMapAsync } from "./repo-map.mjs";
import { readTextFileWithLimit, safeStat } from "./fs-safe.mjs";
import {
  LIFECYCLES,
  burnlistIdForPlan,
  completedDetailMap,
  completionDigestMarkdown,
  documentPayloadForPlan,
  lifecycleForPlan,
  localIsoTimestamp,
  parsePlan,
  summaryForPlan,
  twoDigit,
  validatePlan,
} from "./plan-model.mjs";

const args = new Map();
const allowedArgs = new Set([
  "allow-non-loopback",
  "auto-port",
  "check",
  "close-completed",
  "digest",
  "host",
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
const maxOvenDataBytes = positiveInteger(args.get("max-oven-data-bytes") ?? "67108864", "max-oven-data-bytes");
const stateDir = resolve(launchCwd, args.get("state-dir") ?? ".local/burnlist/checklist-progress");
const runtimePath = resolve(stateDir, "index.server.json");
const globalRuntimePath = join(os.homedir(), ".burnlist", "server.json");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboardDistDir = resolve(packageRoot, "dashboard", "dist");
const dashboardIndexPath = resolve(dashboardDistDir, "index.html");
const builtInOvensDir = resolve(packageRoot, "ovens");
const customOvensDir = resolve(launchCwd, args.get("ovens-dir") ?? ".local/burnlist/ovens");
const legacyRunsDir = args.has("runs-dir") ? resolve(launchCwd, args.get("runs-dir")) : null;
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
  const document = JSON.parse(source);
  if (isDifferentialTestingBundle(document)) {
    const bundle = readDifferentialTestingBundleManifest(readPath, { maxDocumentBytes: maxOvenDataBytes });
    const emptyPayload = bundle.selectedScenarioId === null ? bundle.manifest.emptyData : null;
    const emptySource = emptyPayload ? JSON.stringify(emptyPayload) : "";
    differentialTestingDataCache = {
      kind: "bundle",
      signature,
      readPath: bundle.readPath,
      source: emptySource,
      sourceBytes: Buffer.byteLength(emptySource),
      etag: `W/\"dtb-${bundle.sha256}\"`,
      selectedScenarioId: bundle.selectedScenarioId,
      scenarios: structuredClone(bundle.scenarios),
      bundle,
      scenarioDocuments: new Map(),
      scenarioResponses: new Map(),
      responseExtras: emptyPayload ? {
        transport: {
          schema: DIFFERENTIAL_TESTING_PAGE_SCHEMA,
          bundleSha256: bundle.sha256,
          scenarioSha256: null,
        },
        fieldPage: null,
        frameDeltaMetrics: null,
      } : null,
    };
    return differentialTestingDataCache;
  }
  assertDifferentialTestingData(document);
  differentialTestingDataCache = {
    kind: "legacy",
    signature,
    readPath,
    source,
    sourceBytes: stat.size,
    etag: `W/\"dt-${stat.ino}-${stat.size}-${Math.trunc(stat.mtimeMs)}\"`,
    selectedScenarioId: document.scenarioCatalog.selectedScenarioId,
    scenarios: structuredClone(document.scenarioCatalog.scenarios),
    scenarioResponses: new Map(),
  };
  return differentialTestingDataCache;
}

function differentialTestingQueryValue(searchParams, name) {
  const values = searchParams.getAll(name);
  if (values.length > 1) throw Object.assign(new Error(`${name} must be supplied at most once`), { status: 400 });
  return values[0] ?? null;
}

function differentialTestingIntegerQuery(searchParams, name, fallback) {
  const value = differentialTestingQueryValue(searchParams, name);
  if (value === null) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw Object.assign(new Error(`${name} must be a non-negative integer`), { status: 400 });
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw Object.assign(new Error(`${name} must be a safe integer`), { status: 400 });
  return number;
}

function differentialTestingBundleScenario(index, scenarioId) {
  const cached = index.scenarioDocuments.get(scenarioId);
  if (cached) return cached;
  const scenario = readDifferentialTestingBundleScenario(index.bundle, scenarioId, {
    maxDocumentBytes: maxOvenDataBytes,
  });
  scenario.source = JSON.stringify(scenario.data);
  scenario.sourceBytes = Buffer.byteLength(scenario.source);
  index.scenarioDocuments.set(scenarioId, scenario);
  return scenario;
}

function differentialTestingBundleResponse(index, scenarioId, searchParams) {
  const search = differentialTestingQueryValue(searchParams, "search") ?? "";
  const filter = differentialTestingQueryValue(searchParams, "filter") ?? "all";
  const scenario = differentialTestingBundleScenario(index, scenarioId);
  const sort = differentialTestingQueryValue(searchParams, "sort")
    ?? (scenario.data.telemetry?.status === "comparable" ? "changed" : "default");
  const page = differentialTestingIntegerQuery(searchParams, "page", 0);
  const pageSize = differentialTestingIntegerQuery(searchParams, "pageSize", 25);
  const fieldPage = queryDifferentialTestingFieldPage(scenario, { search, filter, sort, page, pageSize });
  const queryKey = new URLSearchParams({
    search: fieldPage.search,
    filter: fieldPage.filter,
    sort: fieldPage.sort,
    page: String(fieldPage.page),
    pageSize: String(fieldPage.pageSize),
  }).toString();
  const etagDigest = createHash("sha256")
    .update(index.bundle.sha256)
    .update("\0")
    .update(scenario.scenarioSha256)
    .update("\0")
    .update(queryKey)
    .digest("hex");
  const result = {
    signature: `${index.signature}\0${scenario.scenarioSha256}\0${queryKey}`,
    readPath: index.readPath,
    source: scenario.source,
    sourceBytes: scenario.sourceBytes,
    etag: `W/\"dtb-${etagDigest}\"`,
    selectedScenarioId: scenarioId,
    responseExtras: {
      transport: {
        schema: DIFFERENTIAL_TESTING_PAGE_SCHEMA,
        bundleSha256: index.bundle.sha256,
        scenarioSha256: scenario.scenarioSha256,
      },
      fieldPage,
      frameDeltaMetrics: scenario.frameDeltaMetrics,
    },
  };
  return result;
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
    ...(cached.responseExtras || {}),
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

function runCheck() {
  try {
    const plan = parsePlan(resolve(launchCwd, args.get("plan")), maxPlanBytes);
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

function runDigest() {
  try {
    const plan = parsePlan(resolve(launchCwd, args.get("plan")), maxPlanBytes);
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

function candidateRepoRoots() {
  return observerRepoRoots({ cwd: launchCwd, home: os.homedir(), scanRoot: args.get("scan-root") });
}

function burnlistPathsFor(repoRoots) {
  const paths = [];
  for (const repoRoot of repoRoots) {
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

function burnlistPaths() {
  return burnlistPathsFor(candidateRepoRoots());
}

function discoverBurnlists() {
  return burnlistPaths().map((path) => summaryForPlan(path, maxPlanBytes));
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
  const matchedRepo = discoveredRepos()
    .filter((entry) => index.readPath === entry.root || index.readPath.startsWith(`${entry.root}/`))
    .sort((left, right) => right.root.length - left.root.length)[0] ?? null;
  const repo = matchedRepo?.name ?? "differential-testing";
  return index.scenarios.map((scenario) => ({
    id: scenario.id,
    repo,
    repoRoot: matchedRepo?.root ?? null,
    title: scenario.label,
    status: "active",
    statusLabel: "Active",
    total: scenario.frameCount,
    done: null,
    remaining: null,
    percent: null,
    errors: 0,
    warnings: 0,
    lastCompletedAt: null,
    updatedAt: scenario.updatedAt,
    ovenId: "differential-testing",
    ovenName: "Differential Testing",
    href: `/ovens/differential-testing/view?scenario=${encodeURIComponent(scenario.id)}`,
    progressLabel: `${scenario.frameCount} frames`,
  }));
}

function dashboardEntries() {
  return [...checklistDashboardEntries(), ...differentialTestingDashboardEntries()]
    .map((entry) => {
      let key = null;
      try {
        key = entry.repoRoot ? repoKey(realpathSync(entry.repoRoot)) : null;
      } catch {
        // Entries for unavailable roots remain visible without a route key.
      }
      return { ...entry, repoKey: key };
    })
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

function projectsSnapshot() {
  const home = os.homedir();
  const hasScanRootOverride = Boolean(args.get("scan-root"));
  let registeredRoots = [];
  if (!hasScanRootOverride) {
    try {
      registeredRoots = readRegistry({ home }).roots;
    } catch {
      // The dashboard remains useful when a manually edited registry is corrupt.
    }
  }
  const observerRoots = candidateRepoRoots();
  const health = new Map();
  for (const root of observerRoots) {
    let canonicalRoot = root;
    try {
      canonicalRoot = realpathSync(root);
    } catch {
      // Discovery only returns readable roots, but preserve a useful status if it changes.
    }
    try {
      health.set(canonicalRoot, burnlistPathsFor([canonicalRoot]).length ? "healthy" : "empty");
    } catch {
      health.set(canonicalRoot, "unreadable");
    }
  }
  if (!hasScanRootOverride) {
    try {
      for (const entry of classifyRoots({ home })) {
        let canonicalRoot = entry.root;
        try {
          canonicalRoot = realpathSync(entry.root);
        } catch {
          // Missing registered roots are keyed by their recorded root.
        }
        health.set(canonicalRoot, entry.status);
      }
    } catch {
      // A corrupt registry has already been downgraded to no registered roots.
    }
  }
  return buildProjectsSnapshot({
    observerRoots,
    registeredRoots,
    health,
    entries: dashboardEntries(),
    repoKey,
    realpath: realpathSync,
  });
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
  return candidateRepoRoots().map((root) => ({ name: basename(root), root, repoKey: repoKey(realpathSync(root)) }));
}

function repoMapSelection(url) {
  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.some((key) => key !== "repo" && key !== "repoKey")) {
    return { status: 400, error: "repo or repoKey is the only supported repo-map query parameter." };
  }
  const requestedRepos = url.searchParams.getAll("repo");
  const requestedRepoKeys = url.searchParams.getAll("repoKey");
  if (requestedRepos.length + requestedRepoKeys.length !== 1) {
    return { status: 400, error: "repo or repoKey must be supplied exactly once." };
  }
  const requestedRepo = requestedRepos[0] ?? "";
  const requestedRepoKey = requestedRepoKeys[0] ?? "";
  if (!requestedRepo && !requestedRepoKey) return { status: 400, error: "repo or repoKey must not be empty." };
  const matches = discoveredRepos().filter((repo) => requestedRepoKey ? repo.repoKey === requestedRepoKey : repo.name === requestedRepo);
  const requested = requestedRepoKey || requestedRepo;
  if (matches.length === 0) return { status: 404, error: `Unknown repository: ${requested}` };
  if (matches.length > 1) return { status: 409, error: `Ambiguous repository: ${requested}` };
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
  const files = {
    "run.json": `${JSON.stringify(record, null, 2)}\n`,
    "instructions.md": `${oven.instructions.trim()}\n`,
    "detail.json": `${JSON.stringify(oven.detail, null, 2)}\n`,
  };
  const path = withRepoStateLock(repo.root, () => {
    if (legacyRunsDir) return atomicDirectory(legacyRunsDir, id, files);
    const target = containedJoin(repo.root, "runs", id);
    return atomicDirectory(dirname(target), basename(target), files);
  });
  return { ...record, ovenName: oven.name, path };
}

function readBurnRun(id) {
  const safeId = boundedText(id, "Run id", 48);
  if (!/^\d{8}-\d{6}-[a-f0-9]{6}$/u.test(safeId)) throw new Error("Invalid run id.");
  const roots = legacyRunsDir ? [legacyRunsDir] : candidateRepoRoots().map((root) => join(repoStateDir(root), "runs"));
  for (const root of roots) {
    const path = join(root, safeId, "run.json");
    if (!safeStat(path)?.isFile()) continue;
    // Run ids are unique, so the first existing run.json is authoritative: a corrupt record
    // surfaces as an error (not a 404).
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
  return null;
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
  if (parts.length === 3 && parts[0] === "r") return { repoKey: parts[1], id: parts[2] };
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
    // Discovered plan paths are canonical (roots are realpath'd); match a raw request path
    // against both its literal and canonical forms.
    const planCandidates = new Set([requestedPlan]);
    try {
      planCandidates.add(realpathSync(requestedPlan));
    } catch {
      // A plan path that cannot be realpath'd is matched verbatim.
    }
    const match = burnlists.find((entry) => planCandidates.has(entry.planPath));
    return match ? { burnlist: match, burnlists } : { error: `No Burnlist found for ${requestedPlan}`, burnlists };
  }
  const route = routeSelection(url);
  const requestedRepoKey = url.searchParams.get("repoKey") || route?.repoKey || "";
  const repo = url.searchParams.get("repo") || route?.repo || "";
  const id = url.searchParams.get("id") || route?.id || "";
  if (requestedRepoKey && id) {
    const matches = burnlists.filter((entry) => {
      try {
        return repoKey(realpathSync(entry.repoRoot)) === requestedRepoKey && entry.id === id;
      } catch {
        return false;
      }
    });
    if (matches.length === 1) return { burnlist: matches[0], burnlists };
    if (matches.length > 1) return { error: `Burnlist ${requestedRepoKey}/${id} is ambiguous; select by plan path.`, burnlists };
    return { error: `No Burnlist found for ${requestedRepoKey}/${id}`, burnlists };
  }
  if (repo && id) {
    const matches = burnlists.filter((entry) => entry.repo === repo && entry.id === id);
    if (matches.length === 1) return { burnlist: matches[0], burnlists };
    if (matches.length > 1) return { error: `Burnlist ${repo}/${id} is ambiguous; select by plan path.`, burnlists };
    return { error: `No Burnlist found for ${repo}/${id}`, burnlists };
  }
  const active = burnlists.filter((entry) => entry.status === "active" && !entry.errors);
  return { error: active.length ? "Select a Burnlist." : "No active Burnlist found.", burnlists };
}

function payloadForPlan(selection) {
  const plan = parsePlan(selection.planPath, maxPlanBytes);
  const goal = documentPayloadForPlan(selection.planPath, "goal.md", "Goal", maxPlanBytes);
  const completedLog = documentPayloadForPlan(selection.planPath, "completed.md", "Completed log", maxPlanBytes);
  const completedDetails = completedDetailMap(completedLog.sections);
  const issues = validatePlan(plan);
  const total = plan.items.length + plan.completed.length;
  const done = plan.completed.length;
  const remaining = plan.items.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const generatedAt = new Date().toISOString();
  const current = { time: generatedAt, planPath: selection.planPath, done, remaining, total, percent };
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
    repoKey: (() => {
      try {
        return repoKey(realpathSync(selection.repoRoot));
      } catch {
        return null;
      }
    })(),
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
  atomicWrite(plan.planPath, `${plan.markdown.replace(/\s*$/u, "")}\n\n${digest}\n`);
  return true;
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

function runCloseCompleted() {
  const moved = [];
  const skipped = [];
  const errors = [];
  for (const path of burnlistPathsFor(mutatorRepoRoots({ cwd: launchCwd, scanRoot: args.get("scan-root") }))) {
    const lifecycle = lifecycleForPlan(path);
    if (lifecycle.status !== "active") continue;
    try {
      const plan = parsePlan(path, maxPlanBytes);
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
    const error = new Error(`Dashboard build file is missing: ${relative(packageRoot, path)}`);
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
  const validPid = (pid) => Number.isInteger(pid) && pid > 0;
  const readRuntime = (path) => {
    try {
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    } catch {
      return null;
    }
  };
  const pidIsDead = (pid) => {
    if (!validPid(pid)) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  };
  const runtime = readRuntime(runtimePath);
  try {
    if (validPid(runtime?.pid)) process.kill(runtime.pid, "SIGTERM");
  } catch {}
  rmSync(runtimePath, { force: true });
  if (args.has("stop")) {
    const globalRuntime = readRuntime(globalRuntimePath);
    const sameRuntime = validPid(runtime?.pid)
      && runtime.pid === globalRuntime?.pid
      && typeof runtime.startedAt === "string"
      && runtime.startedAt.length > 0
      && runtime.startedAt === globalRuntime.startedAt;
    if (sameRuntime || pidIsDead(globalRuntime?.pid)) rmSync(globalRuntimePath, { force: true });
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
    if (url.pathname === "/api/projects") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      json(res, 200, projectsSnapshot());
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
            const selected = index.kind === "bundle" && index.selectedScenarioId
              ? differentialTestingBundleResponse(index, index.selectedScenarioId, url.searchParams)
              : index;
            sendDifferentialTestingData(req, res, selected);
            return;
          }
          if (!/^[a-f0-9]{16}$/u.test(requestedScenarioId)) return json(res, 400, { error: "scenario must be a lowercase 16-character hexadecimal id" });
          if (!index.scenarios.some((scenario) => scenario.id === requestedScenarioId)) return json(res, 404, { error: `scenario ${requestedScenarioId} is not in the published catalog` });
          const selected = index.kind === "bundle"
            ? differentialTestingBundleResponse(index, requestedScenarioId, url.searchParams)
            : differentialTestingScenarioCache(index, requestedScenarioId);
          sendDifferentialTestingData(req, res, selected);
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
    const startedAt = new Date().toISOString();
    writeFileSync(runtimePath, `${JSON.stringify({ pid: process.pid, url, host, port: actualPort, startedAt }, null, 2)}\n`);
    mkdirSync(dirname(globalRuntimePath), { recursive: true });
    atomicWrite(globalRuntimePath, `${JSON.stringify({ pid: process.pid, url, host, port: actualPort, startedAt }, null, 2)}\n`);
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
