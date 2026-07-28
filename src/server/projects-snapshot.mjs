import { buildProjectsSnapshot } from "./projects.mjs";
import { classifyRoots, readRegistry } from "./registry.mjs";

export function observedProjectsSnapshot({
  home,
  scanRootOverride,
  observerRoots,
  entries,
  burnlistPathsFor,
  repoKey,
  realpath,
}) {
  let registeredRoots = [];
  if (!scanRootOverride) {
    try {
      registeredRoots = readRegistry({ home }).roots;
    } catch {
      // A manually corrupted registry must not hide readable observer roots.
    }
  }
  const health = new Map();
  for (const root of observerRoots) {
    let canonicalRoot = root;
    try {
      canonicalRoot = realpath(root);
    } catch {
      // Preserve the observed root if it changes during discovery.
    }
    try {
      health.set(canonicalRoot, burnlistPathsFor([canonicalRoot]).length ? "healthy" : "empty");
    } catch {
      health.set(canonicalRoot, "unreadable");
    }
  }
  if (!scanRootOverride) {
    try {
      for (const entry of classifyRoots({ home })) {
        let canonicalRoot = entry.root;
        try {
          canonicalRoot = realpath(entry.root);
        } catch {
          // Missing registered roots retain their recorded identity.
        }
        health.set(canonicalRoot, entry.status);
      }
    } catch {
      // Corrupt registries were already downgraded to no registered roots.
    }
  }
  return buildProjectsSnapshot({
    observerRoots,
    registeredRoots,
    health,
    entries,
    repoKey,
    realpath,
  });
}
