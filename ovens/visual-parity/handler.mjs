import { basename } from "node:path";
import { registerOvenHandler } from "../../src/ovens/oven-registry.mjs";
import { readTextFileWithLimit, safeStat } from "../../src/server/fs-safe.mjs";
import { assertVisualParityData } from "./contract.mjs";

function readVisualParityData(bindingPath, maxOvenDataBytes) {
  const stat = safeStat(bindingPath);
  if (!stat?.isFile()) throw new Error("configured Visual Parity data is missing");
  const payload = JSON.parse(readTextFileWithLimit(bindingPath, maxOvenDataBytes, "Visual Parity Oven data"));
  assertVisualParityData(payload);
  return { payload, stat };
}

function targetProgress(payload) {
  const targetIds = new Set(payload.domains
    .filter((domain) => domain.qualification === "target")
    .map((domain) => domain.id));
  const qualified = payload.comparisons.filter((comparison) => [...targetIds]
    .every((id) => comparison.domains[id].status === "pass")).length;
  return { qualified, total: payload.comparisons.length };
}

export const visualParityHandler = Object.freeze({
  id: "visual-parity",

  serveData({ bindingPath, maxOvenDataBytes }) {
    const { payload } = readVisualParityData(bindingPath, maxOvenDataBytes);
    return { ovenId: "visual-parity", path: bindingPath, payload, validated: true };
  },

  dashboardEntries(ctx) {
    return (ctx.ovenDataBindings.get("visual-parity") ?? []).map((binding) => {
      try {
        const { payload, stat } = readVisualParityData(binding.path, ctx.maxOvenDataBytes);
        const scenarioId = payload.differentialTesting.scenarioCatalog.selectedScenarioId;
        const scenario = payload.differentialTesting.scenarioCatalog.scenarios
          .find((entry) => entry.id === scenarioId);
        const progress = targetProgress(payload);
        const complete = progress.qualified === progress.total;
        const repo = binding.repoKey === null ? "visual-parity"
          : ctx.discoveredRepos().find((entry) => entry.repoKey === binding.repoKey)?.name
            ?? basename(binding.repoRoot);
        return {
          id: scenarioId, repo, repoKey: binding.repoKey, repoRoot: binding.repoRoot,
          title: scenario.label, planPath: null, planLabel: null,
          status: complete ? "complete" : "active", statusLabel: complete ? "Qualified" : "Open",
          total: progress.total, done: progress.qualified, remaining: progress.total - progress.qualified,
          percent: progress.total ? (progress.qualified / progress.total) * 100 : 0,
          errors: 0, warnings: payload.domains.filter((domain) => domain.qualification === "context"
            && payload.comparisons.some((comparison) => comparison.domains[domain.id].status === "fail")).length,
          lastCompletedAt: complete ? payload.differentialTesting.publishedAt : null,
          updatedAt: payload.differentialTesting.publishedAt ?? stat.mtime.toISOString(),
          ovenId: "visual-parity", ovenName: "Visual Parity",
          href: binding.repoKey === null ? "/ovens/visual-parity" : `/r/${encodeURIComponent(binding.repoKey)}/o/visual-parity`,
          progressLabel: `${progress.qualified}/${progress.total} target frames`,
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
