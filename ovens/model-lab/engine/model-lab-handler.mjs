import { basename } from "node:path";
import { registerOvenHandler } from "../../../src/ovens/oven-registry.mjs";
import { readTextFileWithLimit, safeStat } from "../../../src/server/fs-safe.mjs";
import { assertModelLabData } from "./model-lab-contract.mjs";

function readModelLabData(bindingPath, maxOvenDataBytes) {
  const stat = safeStat(bindingPath);
  if (!stat?.isFile()) throw Object.assign(new Error("configured Model Lab data is missing"), { status: 404 });
  const payload = JSON.parse(readTextFileWithLimit(bindingPath, maxOvenDataBytes, "Model Lab Oven data"));
  assertModelLabData(payload);
  return { payload, stat };
}

export const modelLabHandler = Object.freeze({
  id: "model-lab",

  serveData({ bindingPath, maxOvenDataBytes }) {
    const { payload } = readModelLabData(bindingPath, maxOvenDataBytes);
    return { ovenId: "model-lab", path: bindingPath, payload, validated: true };
  },

  dashboardEntries(ctx) {
    return (ctx.ovenDataBindings.get("model-lab") ?? []).map((binding) => {
      try {
        const { payload, stat } = readModelLabData(binding.path, ctx.maxOvenDataBytes);
        const repo = binding.repoKey === null
          ? payload.project.label
          : ctx.discoveredRepos().find((entry) => entry.repoKey === binding.repoKey)?.name
            ?? basename(binding.repoRoot);
        const dropped = payload.model.droppedSourcePolygonCount;
        return {
          id: payload.model.id,
          repo,
          repoKey: binding.repoKey,
          repoRoot: binding.repoRoot,
          title: payload.surface.title,
          planPath: null,
          planLabel: "Prepared model surface",
          status: "active",
          statusLabel: dropped ? "Inspect" : "Ready",
          total: payload.model.leafCount,
          done: payload.model.leafCount - dropped,
          remaining: dropped,
          percent: Math.max(0, ((payload.model.leafCount - dropped) / payload.model.leafCount) * 100),
          errors: 0,
          warnings: dropped ? 1 : 0,
          lastCompletedAt: null,
          updatedAt: payload.generatedAt ?? stat.mtime.toISOString(),
          ovenId: "model-lab",
          ovenName: "Model Lab",
          href: binding.repoKey === null ? "/ovens/model-lab" : `/r/${encodeURIComponent(binding.repoKey)}/o/model-lab`,
          progressLabel: `${payload.model.leafCount} <s> leaves · no LOD`,
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
