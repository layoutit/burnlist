import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { registerOvenHandler } from "../../../src/ovens/oven-registry.mjs";
import { readTextFileWithLimit, safeStat } from "../../../src/server/fs-safe.mjs";
import { assertDifferentialTestingData } from "./differential-testing-data-contract.mjs";
import {
  DIFFERENTIAL_TESTING_PAGE_SCHEMA,
  isDifferentialTestingBundle,
  queryDifferentialTestingFieldPage,
  readDifferentialTestingBundleManifest,
  readDifferentialTestingBundleScenario,
} from "./differential-testing-transport.mjs";

function differentialTestingIndexCache(ctx, path) {
  const readPath = resolve(realpathSync(dirname(path)), basename(path));
  const cacheKey = `index:${readPath}`;
  const stat = safeStat(readPath);
  if (!stat?.isFile()) throw new Error("configured Differential Testing data is missing");
  const signature = `${readPath}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached?.signature === signature) return cached;
  const source = readTextFileWithLimit(readPath, ctx.maxOvenDataBytes, "Oven differential-testing data");
  const document = JSON.parse(source);
  let index;
  if (isDifferentialTestingBundle(document)) {
    const bundle = readDifferentialTestingBundleManifest(readPath, { maxDocumentBytes: ctx.maxOvenDataBytes });
    const emptyPayload = bundle.selectedScenarioId === null ? bundle.manifest.emptyData : null;
    const emptySource = emptyPayload ? JSON.stringify(emptyPayload) : "";
    index = {
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
  } else {
    assertDifferentialTestingData(document);
    index = {
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
  }
  ctx.cache.set(cacheKey, index);
  return index;
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

function differentialTestingBundleScenario(ctx, index, scenarioId) {
  const cached = index.scenarioDocuments.get(scenarioId);
  if (cached) return cached;
  const scenario = readDifferentialTestingBundleScenario(index.bundle, scenarioId, { maxDocumentBytes: ctx.maxOvenDataBytes });
  scenario.source = JSON.stringify(scenario.data);
  scenario.sourceBytes = Buffer.byteLength(scenario.source);
  index.scenarioDocuments.set(scenarioId, scenario);
  return scenario;
}

function differentialTestingBundleResponse(ctx, index, scenarioId, searchParams) {
  const search = differentialTestingQueryValue(searchParams, "search") ?? "";
  const filter = differentialTestingQueryValue(searchParams, "filter") ?? "all";
  const scenario = differentialTestingBundleScenario(ctx, index, scenarioId);
  const sort = differentialTestingQueryValue(searchParams, "sort")
    ?? (scenario.data.telemetry?.status === "comparable" ? "changed" : "default");
  const page = differentialTestingIntegerQuery(searchParams, "page", 0);
  const pageSize = differentialTestingIntegerQuery(searchParams, "pageSize", 25);
  const fieldPage = queryDifferentialTestingFieldPage(scenario, { search, filter, sort, page, pageSize });
  const queryKey = new URLSearchParams({ search: fieldPage.search, filter: fieldPage.filter, sort: fieldPage.sort, page: String(fieldPage.page), pageSize: String(fieldPage.pageSize) }).toString();
  const etagDigest = createHash("sha256").update(index.bundle.sha256).update("\0").update(scenario.scenarioSha256).update("\0").update(queryKey).digest("hex");
  return {
    signature: `${index.signature}\0${scenario.scenarioSha256}\0${queryKey}`,
    readPath: index.readPath,
    source: scenario.source,
    sourceBytes: scenario.sourceBytes,
    etag: `W/\"dtb-${etagDigest}\"`,
    selectedScenarioId: scenarioId,
    responseExtras: {
      transport: { schema: DIFFERENTIAL_TESTING_PAGE_SCHEMA, bundleSha256: index.bundle.sha256, scenarioSha256: scenario.scenarioSha256 },
      fieldPage,
      frameDeltaMetrics: scenario.frameDeltaMetrics,
    },
  };
}

function differentialTestingScenarioCache(ctx, index, scenarioId) {
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
  const sourcePayload = JSON.parse(readTextFileWithLimit(scenarioPath, ctx.maxOvenDataBytes, `Differential Testing scenario ${scenarioId}`));
  assertDifferentialTestingData(sourcePayload);
  if (sourcePayload.scenarioCatalog.selectedScenarioId !== scenarioId) {
    throw Object.assign(new Error(`scenario file ${scenarioId} selects ${sourcePayload.scenarioCatalog.selectedScenarioId}`), { status: 422 });
  }
  const indexScenario = index.scenarios.find((scenario) => scenario.id === scenarioId);
  const payloadScenario = sourcePayload.scenarioCatalog.scenarios.find((scenario) => scenario.id === scenarioId);
  if (JSON.stringify(payloadScenario) !== JSON.stringify(indexScenario)) {
    throw Object.assign(new Error(`scenario file ${scenarioId} does not match its published catalog entry`), { status: 422 });
  }
  const payload = { ...sourcePayload, scenarioCatalog: { selectedScenarioId: scenarioId, scenarios: index.scenarios } };
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
  const prefix = `${JSON.stringify({ ovenId: "differential-testing", path: cached.readPath, scenarioId: cached.selectedScenarioId, ...(cached.responseExtras || {}) }).slice(0, -1)},\"payload\":`;
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

export const differentialTestingHandler = Object.freeze({
  id: "differential-testing",
  warmIntervalMs: 1_000,

  dashboardEntries(ctx) {
    const bindings = ctx.ovenDataBindings.get("differential-testing") ?? [];
    return bindings.flatMap((binding) => {
      try {
        const index = differentialTestingIndexCache(ctx, binding.path);
        const repo = binding.repoKey === null
          ? "differential-testing"
          : ctx.discoveredRepos().find((entry) => entry.repoKey === binding.repoKey)?.name ?? basename(binding.repoRoot);
        return index.scenarios.map((scenario) => ({
          id: scenario.id, repo, repoKey: binding.repoKey, repoRoot: binding.repoRoot, title: scenario.label,
          status: "active", statusLabel: "Active", total: scenario.frameCount, done: null, remaining: null,
          percent: null, errors: 0, warnings: 0, lastCompletedAt: null, updatedAt: scenario.updatedAt,
          ovenId: "differential-testing", ovenName: "Differential Testing",
          href: `/ovens/differential-testing/view?scenario=${encodeURIComponent(scenario.id)}${binding.repoKey === null ? "" : `&repoKey=${encodeURIComponent(binding.repoKey)}`}`,
          progressLabel: `${scenario.frameCount} frames`,
        }));
      } catch (error) {
        const repo = binding.repoKey === null ? "differential-testing" : basename(binding.repoRoot);
        return [{
          id: `blocked-${binding.repoKey ?? "global"}`, repo, repoKey: binding.repoKey, repoRoot: binding.repoRoot,
          title: "Differential Testing", planPath: "", planLabel: "Oven data binding",
          status: "active", statusLabel: "Blocked", total: 0, done: null, remaining: null, percent: null,
          errors: 1, warnings: 0, lastCompletedAt: null, updatedAt: null,
          ovenId: "differential-testing", ovenName: "Differential Testing", href: "/ovens/differential-testing/view",
          progressLabel: "Blocked", blockers: String(error?.message ?? error ?? "Data binding is unavailable.").slice(0, 200),
        }];
      }
    });
  },

  serveData(ctx) {
    const index = differentialTestingIndexCache(ctx, ctx.bindingPath);
    const requestedScenarioIds = ctx.url.searchParams.getAll("scenario");
    if (requestedScenarioIds.length > 1) throw Object.assign(new Error("scenario must be supplied at most once"), { status: 400 });
    const requestedScenarioId = requestedScenarioIds[0] ?? "";
    if (!requestedScenarioId || requestedScenarioId === index.selectedScenarioId) {
      const selected = index.kind === "bundle" && index.selectedScenarioId
        ? differentialTestingBundleResponse(ctx, index, index.selectedScenarioId, ctx.url.searchParams)
        : index;
      sendDifferentialTestingData(ctx.req, ctx.res, selected);
      return;
    }
    if (!/^[a-f0-9]{16}$/u.test(requestedScenarioId)) throw Object.assign(new Error("scenario must be a lowercase 16-character hexadecimal id"), { status: 400 });
    if (!index.scenarios.some((scenario) => scenario.id === requestedScenarioId)) {
      throw Object.assign(new Error(`scenario ${requestedScenarioId} is not in the published catalog`), { status: 404 });
    }
    const selected = index.kind === "bundle"
      ? differentialTestingBundleResponse(ctx, index, requestedScenarioId, ctx.url.searchParams)
      : differentialTestingScenarioCache(ctx, index, requestedScenarioId);
    sendDifferentialTestingData(ctx.req, ctx.res, selected);
  },

  warm(ctx) {
    const paths = new Set((ctx.ovenDataBindings.get("differential-testing") ?? []).map((binding) => binding.path));
    for (const path of paths) {
      try {
        differentialTestingIndexCache(ctx, path);
      } catch {
        // The request path reports validation errors; background warming remains silent.
      }
    }
  },
});

registerOvenHandler("differential-testing", differentialTestingHandler);
