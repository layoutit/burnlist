import { join } from "node:path";
import { LIFECYCLES } from "./plan-model.mjs";
import { createFileIndexSnapshot } from "./file-index-snapshot.mjs";
import { repoStateDir } from "./repo-state.mjs";
import { vendoredOvensDir } from "./oven-vendor.mjs";

export function createLandingSnapshot({
  repos,
  burnlistPathsFor,
  customOvensDirFor,
  resolveBindings,
  dashboardEntries,
  projectsSnapshot,
  discoverOvens,
  ovenSummary,
  writeToken,
  warn = console.warn,
}) {
  const index = createFileIndexSnapshot({
    scope: repos,
    paths: (scope) => [
      ...scope.flatMap((repo) => [
        join(repoStateDir(repo.root), "bindings.json"),
        customOvensDirFor(repo.root),
        vendoredOvensDir(repo.root),
        ...LIFECYCLES.map((lifecycle) => join(repo.root, "notes", "burnlists", lifecycle.folder)),
      ]),
      ...burnlistPathsFor(scope.map((repo) => repo.root)),
    ],
    build: (scope) => {
      const bindings = resolveBindings(scope);
      const burnlists = dashboardEntries(bindings, scope);
      const { generatedAt, projects } = projectsSnapshot(
        bindings,
        burnlists,
        scope.map((repo) => repo.root),
      );
      return {
        generatedAt,
        projects,
        burnlists,
        ovens: discoverOvens(scope).map(ovenSummary),
        writeToken,
      };
    },
  });
  const snapshot = () => index.snapshot();
  snapshot.prime = () => {
    try {
      snapshot();
    } catch (error) {
      warn(`Could not prime the dashboard index: ${error.message}`);
    }
  };
  return Object.freeze(snapshot);
}
