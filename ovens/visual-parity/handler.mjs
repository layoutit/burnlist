import { createHash } from "node:crypto";
import { basename } from "node:path";
import { OVEN_DATA_INPUT, registerOvenHandler } from "../../src/ovens/oven-registry.mjs";
import { readTextFileWithLimit, safeStat } from "../../src/server/fs-safe.mjs";
import { assertVisualParityData } from "./contract.mjs";

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

function visualParityDataCache(ctx, bindingPath) {
  const stat = safeStat(bindingPath);
  if (!stat?.isFile()) throw new Error("configured Visual Parity data is missing");
  const signature = [bindingPath, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join("\0");
  const cacheKey = `data:${bindingPath}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached?.signature === signature) return cached;
  const source = readTextFileWithLimit(bindingPath, ctx.maxOvenDataBytes, "Visual Parity Oven data");
  const payload = JSON.parse(source);
  validateVisualParityRuntimeData(payload);
  const result = {
    signature,
    source,
    sourceBytes: Buffer.byteLength(source),
    etag: `W/"vp-${createHash("sha256").update(signature).digest("hex")}"`,
    readPath: bindingPath,
    summary: visualParitySummary(payload, stat),
  };
  ctx.cache.set(cacheKey, result);
  return result;
}

function sendVisualParityData(req, res, cached) {
  if (req.headers["if-none-match"] === cached.etag) {
    res.writeHead(304, { etag: cached.etag, "cache-control": "no-store" });
    res.end();
    return;
  }
  const prefix = `${JSON.stringify({ ovenId: "visual-parity", path: cached.readPath }).slice(0, -1)},"payload":`;
  const suffix = ",\"validated\":true}";
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

export const visualParityHandler = Object.freeze({
  id: "visual-parity",
  dataInput: OVEN_DATA_INPUT.jsonPayload,
  validateData: validateVisualParityRuntimeData,

  serveData(ctx) {
    sendVisualParityData(ctx.req, ctx.res, visualParityDataCache(ctx, ctx.bindingPath));
  },

  dashboardEntries(ctx) {
    return (ctx.ovenDataBindings.get("visual-parity") ?? []).map((binding) => {
      try {
        const { summary } = visualParityDataCache(ctx, binding.path);
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
