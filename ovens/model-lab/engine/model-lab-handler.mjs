import { basename } from "node:path";
import { OVEN_DATA_INPUT, registerOvenHandler } from "../../../src/ovens/oven-registry.mjs";
import {
  readOvenJsonSnapshot,
  reconcileOvenJsonBindings,
  serveOvenJsonSnapshot,
} from "../../../src/server/oven-json-handler.mjs";
import { assertModelLabData } from "./model-lab-contract.mjs";

export const validateModelLabRuntimeData = assertModelLabData;

function modelLabSummary(payload, { stat }) {
  return {
    id: payload.model.id,
    projectLabel: payload.project.label,
    title: payload.surface.title,
    leafCount: payload.model.leafCount,
    dropped: payload.model.droppedSourcePolygonCount,
    updatedAt: payload.generatedAt ?? stat.mtime.toISOString(),
  };
}

function readModelLabSnapshot(ctx, path = ctx.bindingPath) {
  return readOvenJsonSnapshot(ctx, {
    ovenId: "model-lab",
    path,
    label: "configured Model Lab data",
    validate: validateModelLabRuntimeData,
    project: modelLabSummary,
  });
}

export const modelLabHandler = Object.freeze({
  id: "model-lab",
  inputContract: "burnlist-model-lab-data@1",
  dataInput: OVEN_DATA_INPUT.jsonPayload,
  validateData: validateModelLabRuntimeData,

  reconcileDataBindings(ctx) {
    reconcileOvenJsonBindings(ctx, "model-lab");
  },

  serveData(ctx) {
    reconcileOvenJsonBindings(ctx, "model-lab");
    const snapshot = readModelLabSnapshot(ctx);
    serveOvenJsonSnapshot(ctx, snapshot, {
      ovenId: "model-lab", path: ctx.bindingPath, validated: true,
    });
  },

  dashboardEntries(ctx) {
    reconcileOvenJsonBindings(ctx, "model-lab");
    return (ctx.ovenDataBindings.get("model-lab") ?? []).map((binding) => {
      try {
        const summary = readModelLabSnapshot(ctx, binding.path).projection;
        const repo = binding.repoKey === null
          ? summary.projectLabel
          : ctx.discoveredRepos().find((entry) => entry.repoKey === binding.repoKey)?.name
            ?? basename(binding.repoRoot);
        const dropped = summary.dropped;
        return {
          id: summary.id,
          repo,
          repoKey: binding.repoKey,
          repoRoot: binding.repoRoot,
          title: summary.title,
          planPath: null,
          planLabel: "Prepared model surface",
          status: "active",
          statusLabel: dropped ? "Inspect" : "Ready",
          total: summary.leafCount,
          done: summary.leafCount - dropped,
          remaining: dropped,
          percent: Math.max(0, ((summary.leafCount - dropped) / summary.leafCount) * 100),
          errors: 0,
          warnings: dropped ? 1 : 0,
          lastCompletedAt: null,
          updatedAt: summary.updatedAt,
          ovenId: "model-lab",
          ovenName: "Model Lab",
          href: binding.repoKey === null ? "/ovens/model-lab" : `/r/${encodeURIComponent(binding.repoKey)}/o/model-lab`,
          progressLabel: `${summary.leafCount} <s> leaves · no LOD`,
        };
      } catch (error) {
        return {
          id: `blocked-${binding.repoKey ?? "global"}`,
          repo: binding.repoKey === null ? "model-lab" : basename(binding.repoRoot),
          repoKey: binding.repoKey,
          repoRoot: binding.repoRoot,
          title: "Model Lab",
          planPath: null,
          planLabel: "Oven data binding",
          status: "active",
          statusLabel: "Blocked",
          total: 0,
          done: null,
          remaining: null,
          percent: null,
          errors: 1,
          warnings: 0,
          lastCompletedAt: null,
          updatedAt: null,
          ovenId: "model-lab",
          ovenName: "Model Lab",
          href: "/ovens/model-lab",
          progressLabel: "Blocked",
          blockers: String(error?.message ?? error ?? "Data binding is unavailable.").slice(0, 200),
        };
      }
    });
  },
});

registerOvenHandler("model-lab", modelLabHandler);
