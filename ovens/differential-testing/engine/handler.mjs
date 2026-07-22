import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { OVEN_DATA_INPUT, registerOvenHandler } from "../../../src/ovens/oven-registry.mjs";
import {
  createOvenJsonResponse,
  readOvenJsonSnapshot,
  reconcileOvenJsonBindings,
  serializeOvenJsonProjection,
  serveOvenJsonResponse,
} from "../../../src/server/oven-json-handler.mjs";
import { assertDifferentialTestingData } from "./data-contract.mjs";
import { createDifferentialQueryProjectionCache } from "./query-projection-cache.mjs";
import {
  DIFFERENTIAL_TESTING_PAGE_SCHEMA,
  differentialTestingRecordsSignature,
  isDifferentialTestingBundle,
  queryDifferentialTestingFieldPage,
  readDifferentialTestingBundleManifest,
  readDifferentialTestingBundleScenario,
} from "./transport.mjs";

export const validateDifferentialTestingRuntimeData = assertDifferentialTestingData;

const SCENARIO_SCOPE = "differential-testing:scenario";
const QUERY_CACHE_KEY = Symbol("differential-testing-query-projections");

function projectionCache(ctx) {
  let cache = ctx.cache.get(QUERY_CACHE_KEY);
  if (!cache) {
    cache = createDifferentialQueryProjectionCache();
    ctx.cache.set(QUERY_CACHE_KEY, cache);
  }
  return cache;
}

function differentialTestingIndexSnapshot(ctx, path) {
  let projection;
  const snapshot = readOvenJsonSnapshot(ctx, {
    ovenId: "differential-testing",
    path,
    label: "configured Differential Testing data",
    validate(document, metadata) {
      if (isDifferentialTestingBundle(document)) {
        const bundle = readDifferentialTestingBundleManifest(metadata.path, {
          maxDocumentBytes: ctx.maxOvenDataBytes,
          readSource: () => metadata.source,
        });
        projection = {
          kind: "bundle",
          readPath: bundle.readPath,
          selectedScenarioId: bundle.selectedScenarioId,
          scenarios: bundle.scenarios,
          bundle,
        };
        return;
      }
      validateDifferentialTestingRuntimeData(document);
      projection = {
        kind: "legacy",
        readPath: realpathSync(metadata.path),
        selectedScenarioId: document.scenarioCatalog.selectedScenarioId,
        scenarios: document.scenarioCatalog.scenarios,
      };
    },
    project() { return projection; },
  });
  const index = snapshot.projection;
  const etag = index.kind === "bundle"
    ? `W/"dtb-${index.bundle.sha256}"`
    : `W/"dt-${snapshot.stat.ino}-${snapshot.stat.size}-${Math.trunc(snapshot.stat.mtimeMs)}"`;
  return { ...index, snapshot, etag };
}

function differentialTestingQueryValue(searchParams, name) {
  const values = searchParams.getAll(name);
  if (values.length > 1) throw Object.assign(new Error(`${name} must be supplied at most once`), { status: 400 });
  return values[0] ?? null;
}

function differentialTestingIntegerQuery(searchParams, name, fallback) {
  const value = differentialTestingQueryValue(searchParams, name);
  if (value === null) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw Object.assign(new Error(`${name} must be a non-negative integer`), { status: 400 });
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw Object.assign(new Error(`${name} must be a safe integer`), { status: 400 });
  return number;
}

function bundleScenarioSnapshot(ctx, index, scenarioId) {
  const binding = index.bundle.scenarioBindings.get(scenarioId);
  if (!binding) throw Object.assign(new Error(`scenario ${scenarioId} is not in the published bundle`), { status: 404 });
  const path = resolve(index.bundle.root, binding.path);
  let projection;
  const snapshot = readOvenJsonSnapshot(ctx, {
    ovenId: SCENARIO_SCOPE,
    path,
    label: `Differential Testing scenario ${scenarioId}`,
    freshnessKey: index.snapshot.sourceDigest,
    validate(_document, metadata) {
      projection = readDifferentialTestingBundleScenario(index.bundle, scenarioId, {
        maxDocumentBytes: ctx.maxOvenDataBytes,
        readSource: () => metadata.source,
      });
    },
    project() { return projection; },
  });
  return { snapshot, scenario: snapshot.projection };
}

function legacyScenarioPath(index, scenarioId) {
  const configuredRoot = resolve(dirname(index.readPath), "scenarios");
  let root;
  try { root = realpathSync(configuredRoot); }
  catch (error) {
    if (error?.code === "ENOENT") throw Object.assign(new Error(`published data for scenario ${scenarioId} is missing`), { status: 404 });
    throw error;
  }
  const path = resolve(root, `${scenarioId}.json`);
  const local = relative(root, path);
  if (!local || local.startsWith("..") || resolve(root, local) !== path) {
    throw Object.assign(new Error("scenario path escapes the published bundle"), { status: 400 });
  }
  return path;
}

function legacyScenarioSnapshot(ctx, index, scenarioId) {
  const path = legacyScenarioPath(index, scenarioId);
  let projection;
  const snapshot = readOvenJsonSnapshot(ctx, {
    ovenId: SCENARIO_SCOPE,
    path,
    label: `Differential Testing scenario ${scenarioId}`,
    freshnessKey: index.snapshot.sourceDigest,
    validate(sourcePayload) {
      validateDifferentialTestingRuntimeData(sourcePayload);
      if (sourcePayload.scenarioCatalog.selectedScenarioId !== scenarioId) {
        throw Object.assign(new Error(`scenario file ${scenarioId} selects ${sourcePayload.scenarioCatalog.selectedScenarioId}`), { status: 422 });
      }
      const indexScenario = index.scenarios.find((scenario) => scenario.id === scenarioId);
      const payloadScenario = sourcePayload.scenarioCatalog.scenarios.find((scenario) => scenario.id === scenarioId);
      if (JSON.stringify(payloadScenario) !== JSON.stringify(indexScenario)) {
        throw Object.assign(new Error(`scenario file ${scenarioId} does not match its published catalog entry`), { status: 422 });
      }
      projection = { ...sourcePayload, scenarioCatalog: { selectedScenarioId: scenarioId, scenarios: index.scenarios } };
      validateDifferentialTestingRuntimeData(projection);
    },
    project() { return projection; },
  });
  return { snapshot, payload: snapshot.projection, path };
}

function bundleQuery(searchParams, scenario) {
  const search = differentialTestingQueryValue(searchParams, "search") ?? "";
  const filter = differentialTestingQueryValue(searchParams, "filter") ?? "all";
  const sort = differentialTestingQueryValue(searchParams, "sort")
    ?? (scenario.data.telemetry?.status === "comparable" ? "changed" : "default");
  const page = differentialTestingIntegerQuery(searchParams, "page", 0);
  const pageSize = differentialTestingIntegerQuery(searchParams, "pageSize", 25);
  return { search, filter, sort, page, pageSize };
}

function queryKey(query) {
  return new URLSearchParams({
    search: query.search,
    filter: query.filter,
    sort: query.sort,
    page: String(query.page),
    pageSize: String(query.pageSize),
  }).toString();
}

function bundleResponse(ctx, index, scenarioId) {
  const { snapshot, scenario } = bundleScenarioSnapshot(ctx, index, scenarioId);
  const query = bundleQuery(ctx.url.searchParams, scenario);
  const rawKey = `bundle\0${index.snapshot.sourceDigest}\0${snapshot.sourceDigest}\0${queryKey(query)}`;
  const cache = projectionCache(ctx);
  if (differentialTestingRecordsSignature(scenario.recordsPath) !== scenario.recordsSignature) {
    cache.clear();
    throw Object.assign(new Error(`scenario ${scenario.scenarioId} records changed after validation`), { status: 422 });
  }
  const cached = cache.get(rawKey);
  if (cached) return cached;
  const fieldPage = queryDifferentialTestingFieldPage(scenario, query);
  const normalizedQueryKey = queryKey(fieldPage);
  const etagDigest = createHash("sha256")
    .update(index.bundle.sha256).update("\0").update(scenario.scenarioSha256)
    .update("\0").update(normalizedQueryKey).digest("hex");
  const payload = serializeOvenJsonProjection(ctx, snapshot, scenario.data);
  const response = createOvenJsonResponse(ctx, payload, {
    ovenId: "differential-testing",
    path: index.readPath,
    scenarioId,
    transport: {
      schema: DIFFERENTIAL_TESTING_PAGE_SCHEMA,
      bundleSha256: index.bundle.sha256,
      scenarioSha256: scenario.scenarioSha256,
    },
    fieldPage,
    frameDeltaMetrics: scenario.frameDeltaMetrics,
  }, { etag: `W/"dtb-${etagDigest}"` });
  return cache.set(rawKey, response);
}

function emptyBundleResponse(ctx, index) {
  const key = `empty\0${index.snapshot.sourceDigest}`;
  const cache = projectionCache(ctx);
  const cached = cache.get(key);
  if (cached) return cached;
  const payload = serializeOvenJsonProjection(ctx, index.snapshot, index.bundle.manifest.emptyData);
  return cache.set(key, createOvenJsonResponse(ctx, payload, {
    ovenId: "differential-testing",
    path: index.readPath,
    scenarioId: null,
    transport: {
      schema: DIFFERENTIAL_TESTING_PAGE_SCHEMA,
      bundleSha256: index.bundle.sha256,
      scenarioSha256: null,
    },
    fieldPage: null,
    frameDeltaMetrics: null,
  }, { etag: index.etag }));
}

function legacyResponse(ctx, index, scenarioId) {
  if (!scenarioId || scenarioId === index.selectedScenarioId) {
    return createOvenJsonResponse(ctx, index.snapshot, {
      ovenId: "differential-testing", path: index.readPath, scenarioId: index.selectedScenarioId,
    }, { etag: index.etag });
  }
  const selected = legacyScenarioSnapshot(ctx, index, scenarioId);
  const key = `legacy\0${index.snapshot.sourceDigest}\0${selected.snapshot.sourceDigest}`;
  const cache = projectionCache(ctx);
  const cached = cache.get(key);
  if (cached) return cached;
  const payload = serializeOvenJsonProjection(ctx, selected.snapshot, selected.payload);
  const etag = `W/"dt-${selected.snapshot.stat.ino}-${selected.snapshot.stat.size}-${Math.trunc(selected.snapshot.stat.mtimeMs)}-${index.etag.slice(3, -1)}"`;
  return cache.set(key, createOvenJsonResponse(ctx, payload, {
    ovenId: "differential-testing", path: selected.path, scenarioId,
  }, { etag }));
}

export const differentialTestingHandler = Object.freeze({
  id: "differential-testing",
  dataInput: OVEN_DATA_INPUT.jsonPayload,
  validateData: validateDifferentialTestingRuntimeData,

  reconcileDataBindings(ctx) {
    reconcileOvenJsonBindings(ctx, "differential-testing");
    if (!(ctx.ovenDataBindings.get("differential-testing") ?? []).length) ctx.cache.clear();
  },

  dashboardEntries(ctx) {
    reconcileOvenJsonBindings(ctx, "differential-testing");
    const bindings = ctx.ovenDataBindings.get("differential-testing") ?? [];
    return bindings.flatMap((binding) => {
      try {
        const index = differentialTestingIndexSnapshot(ctx, binding.path);
        const repo = binding.repoKey === null
          ? "differential-testing"
          : ctx.discoveredRepos().find((entry) => entry.repoKey === binding.repoKey)?.name ?? basename(binding.repoRoot);
        return index.scenarios.map((scenario) => ({
          id: scenario.id, repo, repoKey: binding.repoKey, repoRoot: binding.repoRoot, title: scenario.label,
          planPath: null, planLabel: null,
          status: "active", statusLabel: "Active", total: scenario.frameCount, done: null, remaining: null,
          percent: null, errors: 0, warnings: 0, lastCompletedAt: null, updatedAt: scenario.updatedAt,
          ovenId: "differential-testing", ovenName: "Differential Testing",
          href: binding.repoKey === null
            ? "/ovens/differential-testing"
            : `/r/${encodeURIComponent(binding.repoKey)}/o/differential-testing?${new URLSearchParams({ scenario: scenario.id })}`,
          progressLabel: `${scenario.frameCount} frames`,
        }));
      } catch (error) {
        const repo = binding.repoKey === null ? "differential-testing" : basename(binding.repoRoot);
        return [{
          id: `blocked-${binding.repoKey ?? "global"}`, repo, repoKey: binding.repoKey, repoRoot: binding.repoRoot,
          title: "Differential Testing", planPath: null, planLabel: "Oven data binding",
          status: "active", statusLabel: "Blocked", total: 0, done: null, remaining: null, percent: null,
          errors: 1, warnings: 0, lastCompletedAt: null, updatedAt: null,
          ovenId: "differential-testing", ovenName: "Differential Testing", href: "/ovens/differential-testing",
          progressLabel: "Blocked", blockers: String(error?.message ?? error ?? "Data binding is unavailable.").slice(0, 200),
        }];
      }
    });
  },

  serveData(ctx) {
    reconcileOvenJsonBindings(ctx, "differential-testing");
    const index = differentialTestingIndexSnapshot(ctx, ctx.bindingPath);
    const requestedScenarioIds = ctx.url.searchParams.getAll("scenario");
    if (requestedScenarioIds.length > 1) throw Object.assign(new Error("scenario must be supplied at most once"), { status: 400 });
    const requestedScenarioId = requestedScenarioIds[0] ?? "";
    if (requestedScenarioId && !/^[a-f0-9]{16}$/u.test(requestedScenarioId)) {
      throw Object.assign(new Error("scenario must be a lowercase 16-character hexadecimal id"), { status: 400 });
    }
    if (requestedScenarioId && !index.scenarios.some((scenario) => scenario.id === requestedScenarioId)) {
      throw Object.assign(new Error(`scenario ${requestedScenarioId} is not in the published catalog`), { status: 404 });
    }
    const scenarioId = requestedScenarioId || index.selectedScenarioId;
    const response = index.kind === "bundle"
      ? scenarioId ? bundleResponse(ctx, index, scenarioId) : emptyBundleResponse(ctx, index)
      : legacyResponse(ctx, index, scenarioId);
    serveOvenJsonResponse(ctx, response);
  },
});

registerOvenHandler("differential-testing", differentialTestingHandler);
