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
import { effectiveBindings } from "./oven-bindings.mjs";
import { classifyRoots, readRegistry, repoKey } from "./registry.mjs";
import { buildProjectsSnapshot } from "./projects.mjs";
import { containedJoin, repoStateDir, withRepoStateLock } from "./repo-state.mjs";
import { resolveUmbrella } from "../cli/umbrella.mjs";
import { assertGitIgnored } from "../cli/git-ignore.mjs";
import {
  assertKnownKeys,
  boundedText,
  legacyOvenRevision,
  normalizeOvenDetail,
  normalizeOvenForkedFrom,
  normalizeOvenPackage,
  ovenId,
  ovenRevision,
} from "../ovens/oven-contract.mjs";
import { compileOven } from "../ovens/dsl/oven-compile.mjs";
import { starterOvenSource } from "../ovens/oven-starter.mjs";
import "../ovens/built-in-handlers.mjs";
import { getOvenHandler, listOvenHandlers } from "../ovens/oven-registry.mjs";
import { genericJsonHandler } from "../ovens/handlers/generic-json-handler.mjs";
import { presentGraph, readLatestRunForItem } from "../loops/run/read-projection.mjs";
import { assignmentStore } from "../loops/assignment/store.mjs";
import { buildRepoMapAsync } from "./repo-map.mjs";
import { createOvenJsonSnapshotStore, OVEN_JSON_CACHE_MAX_BYTES } from "./oven-json-snapshot.mjs";
import { discoverBurnlistSummaries } from "./burnlist-discovery.mjs";
import { serveOvenEventFeed } from "../events/oven-event-feed.mjs";
import { createOvenEventObserver } from "../events/oven-event-observer.mjs";
import { isolatedDashboardEntries } from "./dashboard-entry-isolation.mjs";
import { atomicDirectory, atomicOvenPackage, readTextFileWithLimit, resolveOvenPackageDir, safeStat, withOvenPackageLock } from "./fs-safe.mjs";
import {
  assertCustomOvensDir,
  assertCustomOvenPath,
  OVEN_INSTRUCTIONS_MAX_BYTES,
  OVEN_LINEAGE_MAX_BYTES,
  OVEN_SOURCE_MAX_BYTES,
  resolveCustomOvensDir,
  serializeOvenPackage,
} from "./oven-storage.mjs";
import { createOvenProjectionCoordinator } from "./oven-projection-coordinator.mjs";
import { createOfficialOvenDiscovery } from "./official-oven-discovery.mjs";
import { readVendoredOven, vendoredOvenPath, vendoredOvensDir } from "./oven-vendor.mjs";
import {
  LIFECYCLES,
  burnlistIdForPlan,
  completedDetailMap,
  completionDigestMarkdown,
  documentPayloadForPlan,
  lifecycleForPlan,
  localIsoTimestamp,
  loopAssignmentForItem,
  parsePlan,
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
  "unsafe-ovens-dir",
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
const ovenJsonBudget = Math.min(OVEN_JSON_CACHE_MAX_BYTES, maxOvenDataBytes * 2);
const ovenJsonSnapshots = createOvenJsonSnapshotStore({
  maxCacheBytes: ovenJsonBudget,
  maxActiveBytes: ovenJsonBudget,
});
const stateDir = resolve(launchCwd, args.get("state-dir") ?? ".local/burnlist/checklist-progress");
const runtimePath = resolve(stateDir, "index.server.json");
const globalRuntimePath = join(os.homedir(), ".burnlist", "server.json");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboardDistDir = resolve(packageRoot, "dashboard", "dist");
const dashboardIndexPath = resolve(dashboardDistDir, "index.html");
const builtInOvensDir = resolve(packageRoot, "ovens");
const umbrellaRoot = resolveUmbrella(launchCwd);
if (args.get("ovens-dir") === "true") {
  console.error("--ovens-dir requires a path.");
  process.exit(2);
}
const unsafeOvensDir = args.has("unsafe-ovens-dir");
// --ovens-dir overrides custom Oven storage for the launch umbrella only.
// Other observed repositories always use their own .local/burnlist/ovens.
const launchCustomOvensDir = resolveCustomOvensDir(
  umbrellaRoot,
  args.has("ovens-dir") ? args.get("ovens-dir") : undefined,
  { unsafe: unsafeOvensDir },
);
const launchRepoRoot = realpathSync(umbrellaRoot);
const legacyRunsDir = args.has("runs-dir") ? resolve(launchCwd, args.get("runs-dir")) : null;
const ovenDataOverrides = parseOvenDataBindings(args.get("oven-data") ?? "");
const writeToken = randomBytes(24).toString("hex");
const repoMapCache = new Map();
const ovenHandlerCaches = new Map();
const REPO_MAP_CACHE_MS = 2_000;
const RUN_SNAPSHOT_INSTRUCTIONS_MAX_BYTES = 262144;
const RUN_SNAPSHOT_SOURCE_MAX_BYTES = 393216;
const RUN_SNAPSHOT_DETAIL_MAX_BYTES = RUN_SNAPSHOT_SOURCE_MAX_BYTES;

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

function resolvedOvenDataBindings() {
  return effectiveBindings({ repoRoots: ovenScopeRepos().map((repo) => repo.root), override: ovenDataOverrides });
}

function selectedOvenDataBinding(ovenDataBindings, id, url) {
  const bindings = ovenDataBindings.get(id) ?? [];
  const repoKeys = url.searchParams.getAll("repoKey");
  if (repoKeys.length > 1) throw Object.assign(new Error("repoKey must be supplied at most once"), { status: 400 });
  if (repoKeys.length === 1) {
    return bindings.find((binding) => binding.repoKey === repoKeys[0])
      ?? bindings.find((binding) => binding.repoKey === null)
      ?? null;
  }
  return bindings.find((binding) => binding.repoKey === null) ?? null;
}

function burnlistPathsFor(repoRoots) {
  const paths = [];
  for (const repoRoot of repoRoots) {
    for (const lifecycle of LIFECYCLES) {
      const lifecycleRoot = join(repoRoot, "notes", "burnlists", lifecycle.folder);
      if (!safeStat(lifecycleRoot)?.isDirectory()) continue;
      let ids;
      try {
        ids = readdirSync(lifecycleRoot);
      } catch {
        continue;
      }
      for (const id of ids) {
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
  return discoverBurnlistSummaries({ repoRoots: candidateRepoRoots(), maxPlanBytes });
}

function dashboardEntries(ovenDataBindings) {
  return isolatedDashboardEntries({
    handlers: [...listOvenHandlers(), { id: "custom-oven", dashboardEntries: customOvenDashboardEntries }],
    contextForHandler: (handler) => ovenHandlerContext({ id: handler.id, oven: { id: handler.id }, ovenDataBindings }),
    repoKeyForRoot: (root) => repoKey(realpathSync(root)),
    blockedEntry: blockedDashboardEntry,
  });
}

function customOvenDashboardEntries(ctx) {
  const repos = ovenScopeRepos();
  const entries = [];
  for (const oven of discoverOvens().filter((candidate) => !candidate.builtIn)) {
    try {
      const bindings = ctx.ovenDataBindings.get(oven.id) ?? [];
      const binding = bindings.find((candidate) => candidate.repoKey === oven.repoKey)
        ?? bindings.find((candidate) => candidate.repoKey === null);
      if (!binding) continue;
      const repo = repos.find((candidate) => candidate.repoKey === oven.repoKey);
      entries.push({
        id: oven.id,
        repo: repo?.name ?? oven.id,
        repoKey: oven.repoKey,
        repoRoot: oven.repoRoot,
        planPath: null,
        planLabel: null,
        title: oven.name,
        status: "active",
        statusLabel: "Oven",
        total: 0,
        done: null,
        remaining: null,
        percent: null,
        errors: 0,
        warnings: 0,
        lastCompletedAt: null,
        updatedAt: null,
        ovenId: oven.id,
        ovenName: oven.name,
        href: `/r/${encodeURIComponent(oven.repoKey)}/o/${encodeURIComponent(oven.id)}`,
        progressLabel: "Custom Oven",
      });
    } catch {
      // A malformed custom Oven must not hide the rest of the dashboard index.
    }
  }
  return entries;
}

function blockedDashboardEntry(handler, error) {
  const blockers = String(error?.message ?? error ?? "Oven dashboard data is unavailable.").slice(0, 200);
  return {
    id: `blocked-${handler.id}`, repo: "Oven", repoKey: null, repoRoot: null, planPath: null,
    title: handler.id, planLabel: "Oven dashboard", status: "active", statusLabel: "Blocked",
    total: 0, done: null, remaining: null, percent: null, errors: 1, warnings: 0,
    lastCompletedAt: null, updatedAt: null, ovenId: handler.id, ovenName: handler.id,
    href: "/", progressLabel: "Blocked", blockers,
  };
}

function ovenHandlerContext({ id, oven, req, res, url, binding, bindingPath, ovenDataBindings = resolvedOvenDataBindings() } = {}) {
  const cacheId = id ?? oven?.id;
  if (cacheId && !ovenHandlerCaches.has(cacheId)) ovenHandlerCaches.set(cacheId, new Map());
  return {
    id: cacheId,
    oven,
    req,
    res,
    url,
    binding,
    bindingPath: bindingPath ?? binding?.path,
    cache: cacheId ? ovenHandlerCaches.get(cacheId) : new Map(),
    ovenJsonSnapshots,
    ovenDataBindings,
    maxOvenDataBytes,
    discoverBurnlists,
    discoveredRepos,
  };
}

function projectsSnapshot(ovenDataBindings) {
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
    entries: dashboardEntries(ovenDataBindings),
    repoKey,
    realpath: realpathSync,
  });
}

function instructionsName(instructions, defaultName) {
  const heading = instructions.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line.trim()));
  return heading ? heading.trim().replace(/^#\s+/u, "").trim() : defaultName;
}

function instructionsDescription(instructions) {
  const description = [];
  for (const line of instructions.split(/\r?\n/u).map((value) => value.trim())) {
    if (!description.length && (!line || line.startsWith("#"))) continue;
    if (!line || line.startsWith("#")) break;
    description.push(line);
  }
  return description.join(" ");
}

function readOven(root, id, builtIn, customRepoRoot = umbrellaRoot) {
  const safeId = ovenId(id);
  let ovenRoot;
  try {
    const path = builtIn ? join(root, safeId) : assertCustomOvenPath(customRepoRoot, root, safeId, { unsafe: unsafeOvensDir });
    ovenRoot = resolveOvenPackageDir(realpathSync(path));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const instructionsPath = join(ovenRoot, "instructions.md");
    const ovenPath = join(ovenRoot, `${safeId}.oven`);
    if (!safeStat(instructionsPath)?.isFile() || !safeStat(ovenPath)?.isFile()) return null;
    const ovenPackage = normalizeOvenPackage({
      id: safeId,
      instructions: readTextFileWithLimit(instructionsPath, OVEN_INSTRUCTIONS_MAX_BYTES, "Oven instructions"),
      oven: readTextFileWithLimit(ovenPath, OVEN_SOURCE_MAX_BYTES, "Oven source"),
    });
    const lineagePath = join(ovenRoot, "oven.json");
    let forkedFrom;
    if (safeStat(lineagePath)?.isFile()) {
      try {
        forkedFrom = normalizeOvenForkedFrom(
          JSON.parse(readTextFileWithLimit(lineagePath, OVEN_LINEAGE_MAX_BYTES, "Oven lineage sidecar")),
        ).forkedFrom;
      } catch (error) {
        throw new Error(`Oven ${safeId} lineage sidecar is invalid: ${error.message}`);
      }
    }
    return {
      id: ovenPackage.id,
      name: instructionsName(ovenPackage.instructions, safeId),
      description: instructionsDescription(ovenPackage.instructions),
      builtIn,
      origin: builtIn ? "official" : "custom",
      catalogRevision: null,
      catalogEntry: null,
      instructions: ovenPackage.instructions,
      oven: ovenPackage.oven,
      ir: compileOven(ovenPackage.oven).ir,
      ovenRevision: ovenRevision(ovenPackage),
      ...(forkedFrom ? { forkedFrom } : {}),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const officialOvenDiscovery = createOfficialOvenDiscovery({
  ovensDir: builtInOvensDir,
  handlers: listOvenHandlers(),
  readOven,
});

function readVendoredOvenForRepo(repoRoot, id) {
  const path = vendoredOvenPath(repoRoot, id);
  if (!safeStat(path)?.isDirectory()) return null;
  const ovenPackage = readVendoredOven(repoRoot, id);
  if (!ovenPackage) return null;
  return {
    id: ovenPackage.id,
    name: instructionsName(ovenPackage.instructions, ovenPackage.id),
    description: instructionsDescription(ovenPackage.instructions),
    builtIn: true,
    origin: "vendored",
    catalogRevision: null,
    catalogEntry: null,
    instructions: ovenPackage.instructions,
    oven: ovenPackage.oven,
    ir: compileOven(ovenPackage.oven).ir,
    ovenRevision: ovenPackage.revision,
    runtimeCompatibility: ovenPackage.pin.runtimeCompatibility,
  };
}

function vendoredOvensIn(repoRoot) {
  let entries;
  try {
    entries = readdirSync(vendoredOvensDir(repoRoot), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .map((entry) => entry.name)
    .filter((id) => !id.startsWith(".") && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))
    .map((id) => {
      try {
        return readVendoredOvenForRepo(repoRoot, id);
      } catch (error) {
        console.warn(`Ignoring malformed vendored Oven ${id}: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function customOvensIn(root, customRepoRoot = umbrellaRoot) {
  assertCustomOvensDir(customRepoRoot, root, { unsafe: unsafeOvensDir });
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .map((entry) => entry.name)
    .filter((id) => !id.startsWith(".") && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))
    .map((id) => {
      try {
        return readOven(root, id, false, customRepoRoot);
      } catch (error) {
        console.warn(`Ignoring malformed Oven ${id}: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function discoverOvens() {
  const ovens = officialOvenDiscovery.discover();
  for (const repo of ovenScopeRepos()) {
    for (const oven of vendoredOvensIn(repo.root)) {
      ovens.push({ ...oven, repoKey: repo.repoKey, repoRoot: repo.root });
    }
    const customOvensDir = customOvensDirFor(repo.root);
    for (const oven of customOvensIn(customOvensDir, repo.root)) {
      ovens.push({ ...oven, repoKey: repo.repoKey, repoRoot: repo.root });
    }
  }
  const originRank = { official: 0, vendored: 1, custom: 2 };
  return ovens.sort((left, right) => originRank[left.origin] - originRank[right.origin]
    || left.name.localeCompare(right.name) || String(left.repoKey).localeCompare(String(right.repoKey)));
}

function customOvensDirFor(repoRoot) {
  return resolve(repoRoot) === launchRepoRoot ? launchCustomOvensDir : containedJoin(repoRoot, "ovens");
}

function selectedRepoKey(url) {
  const repoKeys = url.searchParams.getAll("repoKey");
  if (repoKeys.length > 1) throw Object.assign(new Error("repoKey must be supplied at most once"), { status: 400 });
  return repoKeys[0] ?? null;
}

function findOven(id, selectedKey = null) {
  const safeId = ovenId(id);
  if (selectedKey !== null) {
    const repo = ovenScopeRepos().find((entry) => entry.repoKey === selectedKey);
    const vendored = repo ? readVendoredOvenForRepo(repo.root, safeId) : null;
    if (vendored) return { ...vendored, repoKey: repo.repoKey, repoRoot: repo.root };
  }
  // Built-ins are global: resolve them by id regardless of repoKey when no repo has a pin.
  // Custom ovens are identified by (repoKey, id).
  const builtin = officialOvenDiscovery.find(safeId);
  if (builtin) return { ...builtin, repoKey: null, repoRoot: null };
  if (selectedKey === null) return null;
  const repo = ovenScopeRepos().find((entry) => entry.repoKey === selectedKey);
  const oven = repo ? readOven(customOvensDirFor(repo.root), safeId, false, repo.root) : null;
  return oven ? { ...oven, repoKey: repo.repoKey, repoRoot: repo.root } : null;
}

function ovenSummary(oven) {
  const registeredHandler = getOvenHandler(oven.id);
  const handler = registeredHandler ?? genericJsonHandler;
  const inputContract = registeredHandler?.inputContract ?? oven.ir.contract;
  const renderContract = oven.ir.contract;
  return {
    id: oven.id,
    contract: renderContract,
    inputContract,
    renderContract,
    version: oven.ir.version,
    name: oven.name,
    description: oven.description,
    builtIn: oven.builtIn,
    origin: oven.origin,
    repoKey: oven.repoKey,
    dataInput: handler.dataInput,
    runtimeCompatibility: oven.catalogEntry?.runtimeCompatibility ?? oven.runtimeCompatibility ?? null,
    ovenRevision: oven.ovenRevision,
    catalogRevision: oven.catalogRevision,
    ...(oven.forkedFrom ? { forkedFrom: oven.forkedFrom } : {}),
  };
}

function officialCatalogSnapshot() {
  const { schema, catalogVersion, catalogRevision } = officialOvenDiscovery.catalog;
  return {
    schema,
    catalogVersion,
    catalogRevision,
    entries: officialOvenDiscovery.discover().map((oven) => ({
      ...oven.catalogEntry,
      name: oven.name,
      description: oven.description,
      ovenRevision: oven.ovenRevision,
    })),
  };
}

function assertOvenInput(value) {
  assertKnownKeys(value, new Set(["id", "name", "instructions"]), "Oven");
}

function createOven(value) {
  const { repoKey: targetRepoKey, repoRoot: targetRepoRoot, ...ovenValue } = value;
  assertOvenInput(ovenValue);
  const hasRepoKey = targetRepoKey !== undefined;
  const hasRepoRoot = targetRepoRoot !== undefined;
  if (hasRepoKey && hasRepoRoot) throw new Error("Specify repoKey or repoRoot, not both.");
  const repo = hasRepoKey
    ? ovenScopeRepos().find((entry) => entry.repoKey === boundedText(targetRepoKey, "Repository key", 64))
    : hasRepoRoot
      ? ovenScopeRepos().find((entry) => entry.root === resolve(boundedText(targetRepoRoot, "Repository", 4096)))
      : { root: launchRepoRoot, repoKey: repoKey(launchRepoRoot) };
  if (!repo) throw new Error("Repository must be one of the dashboard scan roots.");
  const customOvensDir = customOvensDirFor(repo.root);
  const id = ovenId(ovenValue.id);
  if (officialOvenDiscovery.find(id) || readOven(customOvensDir, id, false, repo.root)) {
    throw new Error(`Oven ${id} already exists.`);
  }
  const name = boundedText(ovenValue.name, "Oven name", 80);
  let instructions = boundedText(ovenValue.instructions, "Markdown instructions", 65536);
  const instructionLines = instructions.split(/\r?\n/u);
  const titleLine = instructionLines.findIndex((line) => /^#\s+\S/u.test(line.trim()));
  if (titleLine === -1) instructionLines.unshift(`# ${name}`, "");
  else instructionLines[titleLine] = `# ${name}`;
  instructions = instructionLines.join("\n");
  const oven = starterOvenSource(id, name);
  const ovenPackage = normalizeOvenPackage({ id, instructions, oven });
  const files = serializeOvenPackage(ovenPackage);
  assertCustomOvenPath(repo.root, customOvensDir, id, { unsafe: unsafeOvensDir });
  assertGitIgnored(repo.root, customOvensDir);
  const path = withOvenPackageLock(customOvensDir, id, () => atomicOvenPackage(customOvensDir, id, files, {
    assertPath: () => {
      assertCustomOvenPath(repo.root, customOvensDir, id, { unsafe: unsafeOvensDir });
      assertGitIgnored(repo.root, customOvensDir);
    },
  }));
  return { ...readOven(customOvensDir, id, false, repo.root), repoKey: repo.repoKey, repoRoot: repo.root, path };
}

function discoveredRepos() {
  return candidateRepoRoots().map((root) => ({ name: basename(root), root, repoKey: repoKey(realpathSync(root)) }));
}

function ovenScopeRepos() {
  const repos = new Map(discoveredRepos().map((repo) => [repo.repoKey, repo]));
  const launchRepo = { name: basename(launchRepoRoot), root: launchRepoRoot, repoKey: repoKey(launchRepoRoot) };
  if (!repos.has(launchRepo.repoKey)) repos.set(launchRepo.repoKey, launchRepo);
  return [...repos.values()];
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

function assertSnapshotSize(contents, maxBytes, label) {
  const bytes = Buffer.byteLength(contents);
  if (bytes > maxBytes) throw new Error(`${label} snapshot exceeds ${maxBytes} bytes.`);
}

function createBurnRun(value) {
  assertKnownKeys(value, new Set(["ovenId", "repoRoot", "title", "objective"]), "Burn run");
  const selectedOvenId = ovenId(value.ovenId);
  const requestedRoot = resolve(boundedText(value.repoRoot, "Repository", 4096));
  const repo = ovenScopeRepos().find((entry) => entry.root === requestedRoot);
  if (!repo) throw new Error("Repository must be one of the dashboard scan roots.");
  const oven = findOven(selectedOvenId, repo.repoKey);
  if (!oven) throw new Error(`Unknown oven ${selectedOvenId}.`);
  const title = boundedText(value.title, "Run title", 120);
  const objective = boundedText(value.objective, "Run objective", 12000);
  const id = runId();
  const createdAt = new Date().toISOString();
  const record = {
    schemaVersion: 5,
    id,
    ovenId: selectedOvenId,
    ovenRepoKey: oven.repoKey,
    ovenRevision: oven.ovenRevision,
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
  const instructionsSnapshot = `${oven.instructions.trim()}\n`;
  const sourceSnapshot = oven.oven;
  assertSnapshotSize(instructionsSnapshot, RUN_SNAPSHOT_INSTRUCTIONS_MAX_BYTES, "Run Oven instructions");
  assertSnapshotSize(sourceSnapshot, RUN_SNAPSHOT_SOURCE_MAX_BYTES, "Run Oven source");
  const files = {
    "run.json": `${JSON.stringify(record, null, 2)}\n`,
    "instructions.md": instructionsSnapshot,
    [`${oven.id}.oven`]: sourceSnapshot,
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
      "ovenRepoKey",
      "ovenRevision",
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
    if (![3, 4, 5].includes(record.schemaVersion)) {
      throw new Error("Burn run schemaVersion must be 3, 4, or 5.");
    }
    const runRoot = dirname(path);
    const instructions = readTextFileWithLimit(
      join(runRoot, "instructions.md"),
      RUN_SNAPSHOT_INSTRUCTIONS_MAX_BYTES,
      "Run Oven instructions",
    );
    if (record.schemaVersion >= 4) {
      if (Object.hasOwn(record, "ovenRepoKey") && record.ovenRepoKey !== null && typeof record.ovenRepoKey !== "string") {
        throw new Error("Burn run ovenRepoKey must be null or a repository key.");
      }
    }
    if (record.schemaVersion === 5) {
      const ovenPackage = normalizeOvenPackage({
        id: record.ovenId,
        instructions,
        oven: readTextFileWithLimit(
          join(runRoot, `${record.ovenId}.oven`),
          RUN_SNAPSHOT_SOURCE_MAX_BYTES,
          "Run Oven source",
        ),
      });
      const snapshotRevision = ovenRevision(ovenPackage);
      const ovenRevisionValue = boundedText(record.ovenRevision, "Burn run ovenRevision", 74);
      if (!/^o1-sha256:[a-f0-9]{64}$/u.test(ovenRevisionValue)) {
        throw new Error("Burn run ovenRevision must be an o1-sha256 digest.");
      }
      if (ovenRevisionValue !== snapshotRevision) {
        throw new Error(`Burn run ${safeId} revision does not match its snapshot.`);
      }
      return record;
    }
    const detail = normalizeOvenDetail(JSON.parse(readTextFileWithLimit(
      join(runRoot, "detail.json"),
      RUN_SNAPSHOT_DETAIL_MAX_BYTES,
      "Run Oven detail template",
    )));
    const snapshotRevision = legacyOvenRevision({ instructions, detail });
    if (record.schemaVersion === 4) {
      const ovenRevisionValue = boundedText(record.ovenRevision, "Burn run ovenRevision", 74);
      if (!/^o1-sha256:[a-f0-9]{64}$/u.test(ovenRevisionValue)) {
        throw new Error("Burn run ovenRevision must be an o1-sha256 digest.");
      }
      if (ovenRevisionValue !== snapshotRevision) {
        throw new Error(`Burn run ${safeId} revision does not match its snapshot.`);
      }
      return record;
    }
    return { ...record, ovenRevision: snapshotRevision };
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

function payloadForPlan(selection, selectedItemId = null) {
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
  const burnlistId = burnlistIdForPlan(selection.planPath);
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
    burnlistId,
    repo: plan.repo,
    repoRoot: plan.repoRoot,
    title: plan.title,
    planPath: selection.planPath,
    planLabel: plan.planLabel,
    selectedItemId: plan.items.some((item) => item.id === selectedItemId) ? selectedItemId : plan.items[0]?.id ?? null,
    total,
    done,
    remaining,
    percent,
    warnings: issues,
    goal,
    active: plan.items.map((item) => {
      let assignment = null;
      try { assignment = loopAssignmentForItem(plan.markdown, item.id); } catch {}
      let graph = null;
      if (assignment) {
        try {
          const artifact = assignmentStore(selection.repoRoot).load(assignment["Assignment-Id"]);
          if (artifact.itemRef === `item:${burnlistId}#${item.id}`
            && artifact.executionRevision === assignment["Execution-Revision"]
            && artifact.packageRevision === assignment["Package-Revision"]) graph = presentGraph(artifact.frozen.ir);
        } catch {}
      }
      return {
        ...item,
        loop: assignment ? {
          selector: assignment.Selector,
          assignmentId: assignment["Assignment-Id"],
          executionRevision: assignment["Execution-Revision"],
          packageRevision: assignment["Package-Revision"],
          graph,
        } : null,
      };
    }),
    completed: plan.completed.map((entry) => ({
      ...entry,
      detail: completedDetails.get(entry.id)?.detail ?? "",
    })),
    history,
    // The Run journal is deliberately not read here.  Progress must remain
    // useful when an independent Loop projection is corrupt or unavailable.
    loopRun: null,
  };
}

function loopProjectionForPlan(selection, requestedItemId = null) {
  const plan = parsePlan(selection.planPath, maxPlanBytes);
  const currentItem = requestedItemId
    ? plan.items.find((item) => item.id === requestedItemId)
    : plan.items.find((item) => loopAssignmentForItem(plan.markdown, item.id));
  if (requestedItemId && !currentItem) throw Object.assign(new Error("Loop item is not active in the selected Burnlist"), { code: "EITEM" });
  const assignment = currentItem ? loopAssignmentForItem(plan.markdown, currentItem.id) : null;
  if (!currentItem || !assignment) return null;
  return readLatestRunForItem({
    repoRoot: selection.repoRoot,
    itemRef: `item:${burnlistIdForPlan(selection.planPath)}#${currentItem.id}`,
    markdown: plan.markdown,
    itemId: currentItem.id,
    assignmentId: assignment["Assignment-Id"],
  });
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

function serveLoopProjection(req, res, loopRun) {
  const body = { loopRun };
  const serialized = JSON.stringify(body);
  const etag = `W/\"loop-${createHash("sha256").update(serialized).digest("hex")}\"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { etag, "cache-control": "no-store" });
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", etag, "content-length": Buffer.byteLength(serialized) });
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
const ovenEventObserver = createOvenEventObserver({
  resolveRepos: ovenScopeRepos,
});

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

const ovenProjectionCoordinator = reportMode ? null : createOvenProjectionCoordinator({
  observer: ovenEventObserver,
  snapshotStore: ovenJsonSnapshots,
  handlers: listOvenHandlers(),
  resolveBindings: resolvedOvenDataBindings,
  createContext: (handler, ovenDataBindings) => ovenHandlerContext({
    id: handler.id,
    oven: { id: handler.id },
    ovenDataBindings,
  }),
});

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
      json(res, 200, projectsSnapshot(resolvedOvenDataBindings()));
      return;
    }
    if (url.pathname === "/api/burnlists") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      json(res, 200, { generatedAt: new Date().toISOString(), burnlists: dashboardEntries(resolvedOvenDataBindings()) });
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
        json(res, 200, payloadForPlan(selected.burnlist, url.searchParams.get("item")));
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }
    if (url.pathname === "/api/loop-projection") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const selected = selectedBurnlist(url);
      if (!selected.burnlist) return json(res, 409, { error: selected.error });
      try {
        // This representation is deliberately only the sanitized canonical projection.
        serveLoopProjection(req, res, loopProjectionForPlan(selected.burnlist, url.searchParams.get("item")));
      } catch (error) {
        const status = error?.code === "EITEM" ? 404 : error?.code === "EAMBIGUOUS" || error?.code === "ECORRUPT" || error?.code === "ERUN_PROJECTION" || error?.code === "EAUTHORITY" ? 409 : 500;
        json(res, status, { error: status === 404 ? error.message : status === 409 ? "Loop projection is unavailable; retaining the last verified projection." : "Loop projection is unavailable." });
      }
      return;
    }
    if (url.pathname === "/api/events") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      serveOvenEventFeed({ req, res, url, repos: ovenScopeRepos(), json, observer: ovenEventObserver });
      return;
    }
    if (url.pathname === "/api/oven-catalog") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      json(res, 200, officialCatalogSnapshot());
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
        json(res, 201, { oven: { ...ovenSummary(oven), instructions: oven.instructions, oven: oven.oven, path: oven.path } });
        return;
      }
      return json(res, 405, { error: "method not allowed" });
    }
    const ovenRoute = url.pathname.match(/^\/api\/ovens\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u);
    if (ovenRoute) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const oven = findOven(ovenRoute[1], selectedRepoKey(url));
      if (!oven) return json(res, 404, { error: "oven not found" });
      json(res, 200, { oven });
      return;
    }
    const ovenDataRoute = url.pathname.match(/^\/api\/oven-data\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u);
    if (ovenDataRoute) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const id = ovenDataRoute[1];
      const requestedRepoKey = selectedRepoKey(url);
      const oven = findOven(id, requestedRepoKey);
      const handler = oven?.builtIn || !oven ? getOvenHandler(id) : null;
      const ovenDataBindings = resolvedOvenDataBindings();
      if (id === "streaming-diff") {
        const repoKeys = url.searchParams.getAll("repoKey");
        if (repoKeys.length > 1 || (url.searchParams.has("list") && repoKeys.length !== 1)
          || repoKeys.some((repoKey) => !/^[a-f0-9]{12}$/u.test(repoKey))) {
          return json(res, 400, { error: url.searchParams.has("list")
            ? "Streaming Diff list requires one lowercase 12-character hexadecimal repoKey"
            : "repoKey must be a lowercase 12-character hexadecimal key" });
        }
      }
      const binding = selectedOvenDataBinding(ovenDataBindings, id, url);
      if (!handler && !oven) return json(res, 404, { validated: false, error: `Oven ${id} is not available` });
      try {
        if (!binding) {
          handler?.reconcileDataBindings?.(ovenHandlerContext({ id, oven, req, res, url, ovenDataBindings }));
          return json(res, 404, { error: `no data binding configured for Oven ${id}` });
        }
        const active = handler ?? genericJsonHandler;
        const response = active.serveData?.(ovenHandlerContext({ id, oven, req, res, url, binding, ovenDataBindings }));
        if (response !== undefined) json(res, 200, response);
      } catch (error) {
        if (!res.headersSent) {
          json(res, Number.isInteger(error.status) ? error.status : 422, {
            error: error instanceof SyntaxError ? `Oven ${id} data is not valid JSON: ${error.message}` : error.message,
            issues: Array.isArray(error.issues) ? error.issues : undefined,
          });
        } else {
          res.end();
        }
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
      json(res, 200, { repos: ovenScopeRepos() });
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
    const ovenIdPattern = "[a-z0-9]+(?:-[a-z0-9]+)*";
    const ovenCatalogRoute = new RegExp(`^/ovens/${ovenIdPattern}$`, "u").test(url.pathname);
    const repoOvenRoute = new RegExp(`^/r/[a-f0-9]{12}/o/${ovenIdPattern}$`, "u").test(url.pathname);
    const burnlistOvenRoute = new RegExp(`^/r/[a-f0-9]{12}/${ovenIdPattern}/o/${ovenIdPattern}$`, "u").test(url.pathname);
    if (["/", "/index.html", "/ovens", "/ovens/new", "/runs/new"].includes(url.pathname) || ovenCatalogRoute || repoOvenRoute || burnlistOvenRoute || routeSelection(url)) {
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
server.once("close", () => {
  ovenProjectionCoordinator?.stop();
  ovenEventObserver.close();
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

listen(initialPort);
