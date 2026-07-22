import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { basename } from "node:path";
import { OVEN_DATA_INPUT, registerOvenHandler } from "../../src/ovens/oven-registry.mjs";
import { readTextFileWithIdentity } from "../../src/server/fs-safe.mjs";
import { assertVisualParityData } from "./contract.mjs";

export const VISUAL_PARITY_CACHE_MAX_ENTRIES = 8;
export const VISUAL_PARITY_CACHE_MAX_BYTES = 128 * 1024 * 1024;
export const VISUAL_PARITY_RESPONSE_CHUNK_BYTES = 64 * 1024;

const DATA_CACHE_KEY = "validated-response-data";
const DATA_READ_ATTEMPTS = 3;
const RESPONSE_SUFFIX = Buffer.from(",\"validated\":true}");

export const validateVisualParityRuntimeData = assertVisualParityData;
function targetProgress(payload) {
  const targetIds = new Set(payload.domains
    .filter((domain) => domain.qualification === "target")
    .map((domain) => domain.id));
  const qualified = payload.comparisons.filter((comparison) => [...targetIds]
    .every((id) => comparison.domains[id].status === "pass")).length;
  return { qualified, total: payload.comparisons.length };
}

function visualParitySummary(payload, stat) {
  const scenarioId = payload.differentialTesting.scenarioCatalog.selectedScenarioId;
  const scenario = payload.differentialTesting.scenarioCatalog.scenarios
    .find((entry) => entry.id === scenarioId);
  const progress = targetProgress(payload);
  return {
    scenarioId,
    scenarioLabel: scenario.label,
    progress,
    complete: progress.qualified === progress.total,
    percent: progress.total ? Math.round((progress.qualified / progress.total) * 100) : 0,
    warnings: payload.domains.filter((domain) => domain.qualification === "context"
      && payload.comparisons.some((comparison) => comparison.domains[domain.id].status === "fail")).length,
    publishedAt: payload.differentialTesting.publishedAt,
    updatedAt: payload.differentialTesting.publishedAt ?? stat.mtime.toISOString(),
  };
}

function safeLstat(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function versionSignature(bindingPath, identity) {
  return [bindingPath, identity.dev, identity.ino, identity.size, identity.mtimeMs, identity.ctimeMs].join("\0");
}

function fileSnapshot(bindingPath, statPath = safeLstat) {
  const stat = statPath(bindingPath);
  if (!stat?.isFile() || stat.isSymbolicLink?.()) return null;
  return {
    stat,
    signature: versionSignature(bindingPath, stat),
  };
}

export function readStableVisualParitySource(bindingPath, maxBytes, {
  readSource = readTextFileWithIdentity,
  statPath = safeLstat,
} = {}) {
  for (let attempt = 0; attempt < DATA_READ_ATTEMPTS; attempt += 1) {
    const before = fileSnapshot(bindingPath, statPath);
    if (!before) throw new Error("configured Visual Parity data is missing");
    try {
      const { text: source, identity } = readSource(bindingPath, maxBytes, "Visual Parity Oven data");
      const after = fileSnapshot(bindingPath, statPath);
      if (after?.signature === versionSignature(bindingPath, identity)) return { source, ...after };
    } catch (error) {
      const after = fileSnapshot(bindingPath, statPath);
      if (error?.code !== "ESTALE" && after?.signature === before.signature) throw error;
    }
  }
  throw Object.assign(new Error("configured Visual Parity data changed while it was read"), { code: "ESTALE" });
}

function responseCache(ctx) {
  let state = ctx.cache.get(DATA_CACHE_KEY);
  if (!state || !(state.responses instanceof Map) || !(state.summaries instanceof Map)
    || !Number.isSafeInteger(state.responseBytes)) {
    state = { responses: new Map(), summaries: new Map(), responseBytes: 0 };
    ctx.cache.set(DATA_CACHE_KEY, state);
  }
  return state;
}

function removeCachedResponse(state, path) {
  const cached = state.responses.get(path);
  if (!cached) return;
  state.responses.delete(path);
  state.responseBytes -= cached.sourceBytes;
}

function cacheByteLimit(ctx) {
  if (!Number.isSafeInteger(ctx.maxOvenDataBytes) || ctx.maxOvenDataBytes < 0) {
    return VISUAL_PARITY_CACHE_MAX_BYTES;
  }
  return Math.min(VISUAL_PARITY_CACHE_MAX_BYTES, ctx.maxOvenDataBytes * 2);
}

function enforceCacheLimits(state, maxBytes) {
  while (state.responses.size > VISUAL_PARITY_CACHE_MAX_ENTRIES || state.responseBytes > maxBytes) {
    removeCachedResponse(state, state.responses.keys().next().value);
  }
}

function prepareResponseCache(ctx) {
  const state = responseCache(ctx);
  const bindings = ctx.ovenDataBindings?.get?.("visual-parity");
  if (Array.isArray(bindings)) {
    const activePaths = new Set(bindings.map((binding) => binding.path));
    for (const path of state.responses.keys()) {
      if (!activePaths.has(path)) removeCachedResponse(state, path);
    }
    for (const path of state.summaries.keys()) {
      if (!activePaths.has(path)) state.summaries.delete(path);
    }
  }
  enforceCacheLimits(state, cacheByteLimit(ctx));
  return state;
}

function responsePrefix(bindingPath) {
  return Buffer.from(`${JSON.stringify({ ovenId: "visual-parity", path: bindingPath }).slice(0, -1)},"payload":`);
}

function readValidatedVisualParityData(ctx, bindingPath) {
  const { source, stat, signature } = readStableVisualParitySource(bindingPath, ctx.maxOvenDataBytes);
  const payload = JSON.parse(source);
  validateVisualParityRuntimeData(payload);
  return { source, signature, summary: visualParitySummary(payload, stat) };
}

function cacheSummary(state, bindingPath, data) {
  const cached = { signature: data.signature, summary: data.summary };
  state.summaries.set(bindingPath, cached);
  return cached.summary;
}

function visualParitySummaryCache(ctx, bindingPath, state) {
  const observed = fileSnapshot(bindingPath);
  if (!observed) throw new Error("configured Visual Parity data is missing");
  const cached = state.summaries.get(bindingPath);
  if (cached?.signature === observed.signature) {
    return cached.summary;
  }
  state.summaries.delete(bindingPath);
  removeCachedResponse(state, bindingPath);
  return cacheSummary(state, bindingPath, readValidatedVisualParityData(ctx, bindingPath));
}

function visualParityDataCache(ctx, bindingPath, state) {
  const observed = fileSnapshot(bindingPath);
  if (!observed) throw new Error("configured Visual Parity data is missing");
  const cached = state.responses.get(bindingPath);
  if (cached?.signature === observed.signature) {
    state.responses.delete(bindingPath);
    state.responses.set(bindingPath, cached);
    return cached;
  }
  removeCachedResponse(state, bindingPath);
  const data = readValidatedVisualParityData(ctx, bindingPath);
  cacheSummary(state, bindingPath, data);
  const sourceBuffer = Buffer.from(data.source);
  const prefix = responsePrefix(bindingPath);
  const result = {
    signature: data.signature,
    prefix,
    source: sourceBuffer,
    suffix: RESPONSE_SUFFIX,
    sourceBytes: sourceBuffer.length,
    responseBytes: prefix.length + sourceBuffer.length + RESPONSE_SUFFIX.length,
    etag: `W/"vp-${createHash("sha256")
      .update(prefix).update(sourceBuffer).update(RESPONSE_SUFFIX).digest("hex")}"`,
  };
  const maxBytes = cacheByteLimit(ctx);
  if (result.sourceBytes <= maxBytes) {
    state.responses.set(bindingPath, result);
    state.responseBytes += result.sourceBytes;
    enforceCacheLimits(state, maxBytes);
  }
  return result;
}

export function ifNoneMatchMatches(value, currentEtag) {
  const header = Array.isArray(value) ? value.join(",") : String(value ?? "");
  if (header.trim() === "*") return true;
  const currentOpaque = currentEtag.replace(/^W\//u, "");
  let offset = 0;
  while (offset < header.length) {
    while (/[\t ,]/u.test(header[offset] ?? "")) offset += 1;
    if (header.startsWith("W/", offset)) offset += 2;
    if (header[offset] !== "\"") {
      while (offset < header.length && header[offset] !== ",") offset += 1;
      continue;
    }
    const start = offset;
    const end = header.indexOf("\"", start + 1);
    if (end === -1) return false;
    offset = end + 1;
    while (/[\t ]/u.test(header[offset] ?? "")) offset += 1;
    if ((offset === header.length || header[offset] === ",")
      && header.slice(start, end + 1) === currentOpaque) return true;
    while (offset < header.length && header[offset] !== ",") offset += 1;
  }
  return false;
}

function streamResponse(req, res, segments) {
  let segmentIndex = 0;
  let segmentOffset = 0;
  let closed = false;
  let waitingDrain = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    res.off?.("drain", onDrain);
    res.off?.("close", cleanup);
    res.off?.("error", cleanup);
    res.off?.("finish", cleanup);
    req.off?.("aborted", abort);
  }
  function abort() {
    cleanup();
    if (!res.destroyed) res.destroy?.();
  }
  function onDrain() {
    waitingDrain = false;
    pump();
  }
  function pump() {
    if (closed || waitingDrain) return;
    try {
      while (segmentIndex < segments.length) {
        const segment = segments[segmentIndex];
        while (segmentOffset < segment.length) {
          const end = Math.min(segmentOffset + VISUAL_PARITY_RESPONSE_CHUNK_BYTES, segment.length);
          const chunk = segment.subarray(segmentOffset, end);
          segmentOffset = end;
          if (!res.write(chunk)) {
            waitingDrain = true;
            res.once("drain", onDrain);
            return;
          }
        }
        segmentIndex += 1;
        segmentOffset = 0;
      }
      res.end();
      cleanup();
    } catch {
      abort();
    }
  }

  res.once("close", cleanup);
  res.once("error", cleanup);
  res.once("finish", cleanup);
  req.once?.("aborted", abort);
  pump();
}

function sendVisualParityData(req, res, cached) {
  if (ifNoneMatchMatches(req.headers["if-none-match"], cached.etag)) {
    res.writeHead(304, { etag: cached.etag, "cache-control": "no-store" });
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    etag: cached.etag,
    "content-length": cached.responseBytes,
  });
  streamResponse(req, res, [cached.prefix, cached.source, cached.suffix]);
}

export const visualParityHandler = Object.freeze({
  id: "visual-parity",
  dataInput: OVEN_DATA_INPUT.jsonPayload,
  validateData: validateVisualParityRuntimeData,

  serveData(ctx) {
    const state = prepareResponseCache(ctx);
    sendVisualParityData(ctx.req, ctx.res, visualParityDataCache(ctx, ctx.bindingPath, state));
  },

  dashboardEntries(ctx) {
    const state = prepareResponseCache(ctx);
    return (ctx.ovenDataBindings.get("visual-parity") ?? []).map((binding) => {
      try {
        const summary = visualParitySummaryCache(ctx, binding.path, state);
        const repo = binding.repoKey === null ? "visual-parity"
          : ctx.discoveredRepos().find((entry) => entry.repoKey === binding.repoKey)?.name
            ?? basename(binding.repoRoot);
        return {
          id: summary.scenarioId, repo, repoKey: binding.repoKey, repoRoot: binding.repoRoot,
          title: summary.scenarioLabel, planPath: null, planLabel: null,
          status: summary.complete ? "complete" : "active", statusLabel: summary.complete ? "Qualified" : "Open",
          total: summary.progress.total, done: summary.progress.qualified,
          remaining: summary.progress.total - summary.progress.qualified, percent: summary.percent,
          errors: 0, warnings: summary.warnings,
          lastCompletedAt: summary.complete ? summary.publishedAt : null,
          updatedAt: summary.updatedAt,
          ovenId: "visual-parity", ovenName: "Visual Parity",
          href: binding.repoKey === null ? "/ovens/visual-parity" : `/r/${encodeURIComponent(binding.repoKey)}/o/visual-parity`,
          progressLabel: `${summary.progress.qualified}/${summary.progress.total} target frames`,
        };
      } catch (error) {
        const repo = binding.repoKey === null ? "visual-parity" : basename(binding.repoRoot);
        return {
          id: `blocked-${binding.repoKey ?? "global"}`, repo, repoKey: binding.repoKey, repoRoot: binding.repoRoot,
          title: "Visual Parity", planPath: null, planLabel: "Oven data binding",
          status: "active", statusLabel: "Blocked", total: 0, done: null, remaining: null, percent: null,
          errors: 1, warnings: 0, lastCompletedAt: null, updatedAt: null,
          ovenId: "visual-parity", ovenName: "Visual Parity",
          href: binding.repoKey === null ? "/ovens/visual-parity" : `/r/${encodeURIComponent(binding.repoKey)}/o/visual-parity`,
          progressLabel: "Blocked", blockers: String(error?.message ?? error ?? "Data binding is unavailable.").slice(0, 200),
        };
      }
    });
  },
});

registerOvenHandler("visual-parity", visualParityHandler);
