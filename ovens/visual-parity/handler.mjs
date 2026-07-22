import { basename } from "node:path";
import { OVEN_DATA_INPUT, registerOvenHandler } from "../../src/ovens/oven-registry.mjs";
import {
  readOvenJsonSnapshot,
  reconcileOvenJsonBindings,
  serveOvenJsonSnapshot,
} from "../../src/server/oven-json-handler.mjs";
import { assertVisualParityData } from "./contract.mjs";

export const validateVisualParityRuntimeData = assertVisualParityData;

function validateVisualParitySnapshot(payload) {
  validateVisualParityRuntimeData(payload);
}

function targetProgress(payload) {
  const targetIds = new Set(payload.domains
    .filter((domain) => domain.qualification === "target")
    .map((domain) => domain.id));
  const qualified = payload.comparisons.filter((comparison) => [...targetIds]
    .every((id) => comparison.domains[id].status === "pass")).length;
  return { qualified, total: payload.comparisons.length };
}

function visualParitySummary(payload, { stat }) {
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

function readVisualParitySnapshot(ctx, path = ctx.bindingPath) {
  return readOvenJsonSnapshot(ctx, {
    ovenId: "visual-parity",
    path,
    label: "configured Visual Parity data",
    validate: validateVisualParitySnapshot,
    project: visualParitySummary,
  });
}

function blockedEntry(binding, error) {
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

export const visualParityHandler = Object.freeze({
  id: "visual-parity",
  inputContract: "burnlist-visual-parity-data@1",
  dataInput: OVEN_DATA_INPUT.jsonPayload,
  validateData: validateVisualParityRuntimeData,

  reconcileDataBindings(ctx) {
    reconcileOvenJsonBindings(ctx, "visual-parity");
  },

  serveData(ctx) {
    reconcileOvenJsonBindings(ctx, "visual-parity");
    const snapshot = readVisualParitySnapshot(ctx);
    serveOvenJsonSnapshot(ctx, snapshot, {
      ovenId: "visual-parity", path: ctx.bindingPath, validated: true,
    });
  },

  dashboardEntries(ctx) {
    reconcileOvenJsonBindings(ctx, "visual-parity");
    return (ctx.ovenDataBindings.get("visual-parity") ?? []).map((binding) => {
      try {
        const summary = readVisualParitySnapshot(ctx, binding.path).projection;
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
        return blockedEntry(binding, error);
      }
    });
  },
});

registerOvenHandler("visual-parity", visualParityHandler);
