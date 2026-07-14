import { readdirSync } from "node:fs";
import { join } from "node:path";
import { safeStat } from "./fs-safe.mjs";
import { LIFECYCLES, summaryForPlan } from "./plan-model.mjs";

// Discovery is deliberately best-effort: a broken lifecycle directory or plan
// must not make every other repository disappear from the observer dashboard.
export function discoverBurnlistSummaries({ repoRoots, maxPlanBytes, lifecycles = LIFECYCLES } = {}) {
  const entries = [];
  for (const repoRoot of repoRoots ?? []) {
    for (const lifecycle of lifecycles) {
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
        if (!safeStat(planPath)?.isFile()) continue;
        try {
          entries.push(summaryForPlan(planPath, maxPlanBytes));
        } catch {
          // summaryForPlan normally turns malformed plans into blocked rows. This
          // final guard also keeps an unexpected per-plan filesystem failure local.
        }
      }
    }
  }
  return entries.sort((left, right) => left.planPath.localeCompare(right.planPath));
}
