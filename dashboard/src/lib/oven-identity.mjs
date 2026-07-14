export function ovenCatalogKey({ id, repoKey }) {
  return `${repoKey ?? "built-in"}:${id}`;
}

export function ovenActionUrl({ id, repoKey }) {
  const path = `/api/ovens/${encodeURIComponent(id)}`;
  return repoKey === null ? path : `${path}?repoKey=${encodeURIComponent(repoKey)}`;
}

export function ovenTargetRepoRoot(oven, repos, fallback) {
  if (oven.builtIn) return fallback;
  return repos.find((repo) => repo.repoKey === oven.repoKey)?.root ?? fallback;
}
