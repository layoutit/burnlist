export function ovenCatalogKey({ id, repoKey }) {
  return `${repoKey ?? "built-in"}:${id}`;
}

export function ovenActionUrl({ id, repoKey }) {
  const path = `/api/ovens/${encodeURIComponent(id)}`;
  return repoKey === null ? path : `${path}?repoKey=${encodeURIComponent(repoKey)}`;
}

export function ovenTargetRepoRoot(oven, repos) {
  if (oven.repoKey === null) return null;
  return repos.find((repo) => repo.repoKey === oven.repoKey)?.root ?? null;
}

export function effectiveOvensForRepo(ovens, repoKey) {
  if (!repoKey) return [];
  const ranks = { vendored: 0, official: 1, custom: 2 };
  const effective = new Map();
  for (const oven of ovens ?? []) {
    const origin = oven.origin ?? (oven.repoKey === null ? "official" : oven.builtIn ? "vendored" : "custom");
    if (origin !== "official" && oven.repoKey !== repoKey) continue;
    const candidate = { ...oven, origin };
    const current = effective.get(oven.id);
    if (!current || ranks[origin] < ranks[current.origin]) effective.set(oven.id, candidate);
  }
  return [...effective.values()].sort((left, right) => left.name.localeCompare(right.name));
}
