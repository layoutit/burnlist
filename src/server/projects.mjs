import { basename } from "node:path";

function resolvedRoot(root, realpath) {
  try {
    return { canonicalRoot: realpath(root), resolved: true };
  } catch {
    return { canonicalRoot: root, resolved: false };
  }
}

function entryRoot(entry, realpath) {
  if (typeof entry.repoRoot !== "string" || !entry.repoRoot) return null;
  return resolvedRoot(entry.repoRoot, realpath).canonicalRoot;
}

function duplicateEntryIds(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right));
}

function latestEntryTime(entries, field) {
  return entries.reduce((latest, entry) => {
    const time = typeof entry[field] === "string" ? Date.parse(entry[field]) : Number.NaN;
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, Number.NEGATIVE_INFINITY);
}

function projectSort(left, right) {
  return Number(right.counts.active > 0) - Number(left.counts.active > 0)
    || right.latestSortTime - left.latestSortTime
    || left.displayName.localeCompare(right.displayName)
    || left.canonicalRoot.localeCompare(right.canonicalRoot);
}

export function buildProjectsSnapshot({
  observerRoots,
  registeredRoots,
  health,
  entries,
  repoKey,
  realpath,
}) {
  const projectsByRoot = new Map();
  const addRoot = (root, source, registeredEntry = null) => {
    const { canonicalRoot, resolved } = resolvedRoot(root, realpath);
    const project = projectsByRoot.get(canonicalRoot) ?? {
      canonicalRoot,
      registered: false,
      storedRepoKey: null,
      resolved,
      sources: new Set(),
    };
    project.sources.add(source);
    if (registeredEntry) {
      project.registered = true;
      project.storedRepoKey = registeredEntry.repoKey;
      project.resolved = project.resolved || resolved;
    }
    projectsByRoot.set(canonicalRoot, project);
  };

  for (const root of observerRoots) addRoot(root, "observed");
  for (const entry of registeredRoots) addRoot(entry.root, "registered", entry);

  const assignedRoots = new Set();
  const projects = [...projectsByRoot.values()].map((project) => {
    const projectEntries = entries.filter((entry) => entryRoot(entry, realpath) === project.canonicalRoot);
    for (const entry of projectEntries) assignedRoots.add(entry);
    const active = projectEntries.filter((entry) => entry.status === "active").length;
    const key = project.resolved ? repoKey(project.canonicalRoot) : project.storedRepoKey;
    const projectHealth = health.get(project.canonicalRoot) ?? (project.registered ? "empty" : "healthy");
    const latestCompletedAt = latestEntryTime(projectEntries, "lastCompletedAt");
    const latestUpdatedAt = latestEntryTime(projectEntries, "updatedAt");
    return {
      repoKey: key ?? null,
      displayName: basename(project.canonicalRoot),
      canonicalRoot: project.canonicalRoot,
      registered: project.registered,
      sources: [...project.sources].sort(),
      health: projectHealth,
      errors: ["unreadable", "missing"].includes(projectHealth)
        ? [`${project.registered ? "registered root" : "root"} is ${projectHealth}`]
        : [],
      entries: projectEntries,
      counts: { total: projectEntries.length, active },
      ambiguousIds: duplicateEntryIds(projectEntries),
      latestSortTime: Number.isFinite(latestCompletedAt) ? latestCompletedAt : latestUpdatedAt,
    };
  });

  const ungroupedEntries = entries.filter((entry) => !assignedRoots.has(entry));
  if (ungroupedEntries.length) {
    projects.push({
      repoKey: null,
      displayName: "Ungrouped",
      canonicalRoot: null,
      registered: false,
      sources: [],
      health: "healthy",
      errors: [],
      entries: ungroupedEntries,
      counts: {
        total: ungroupedEntries.length,
        active: ungroupedEntries.filter((entry) => entry.status === "active").length,
      },
      ambiguousIds: duplicateEntryIds(ungroupedEntries),
      latestSortTime: (() => {
        const latestCompletedAt = latestEntryTime(ungroupedEntries, "lastCompletedAt");
        return Number.isFinite(latestCompletedAt) ? latestCompletedAt : latestEntryTime(ungroupedEntries, "updatedAt");
      })(),
    });
  }

  const regularProjects = projects.filter((project) => project.canonicalRoot !== null).sort(projectSort);
  const trailingProjects = projects.filter((project) => project.canonicalRoot === null);
  return {
    generatedAt: new Date().toISOString(),
    projects: [...regularProjects, ...trailingProjects].map(({ latestSortTime, ...project }) => project),
  };
}
