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

function latestEntryTime(entries) {
  return entries.reduce((latest, entry) => {
    const time = typeof entry.updatedAt === "string" ? Date.parse(entry.updatedAt) : Number.NaN;
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, Number.NEGATIVE_INFINITY);
}

function projectSort(left, right) {
  return Number(right.counts.active > 0) - Number(left.counts.active > 0)
    || right.latestUpdatedAt - left.latestUpdatedAt
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
  const addRoot = (root, registeredEntry = null) => {
    const { canonicalRoot, resolved } = resolvedRoot(root, realpath);
    const project = projectsByRoot.get(canonicalRoot) ?? {
      canonicalRoot,
      registered: false,
      storedRepoKey: null,
      resolved,
    };
    if (registeredEntry) {
      project.registered = true;
      project.storedRepoKey = registeredEntry.repoKey;
      project.resolved = project.resolved || resolved;
    }
    projectsByRoot.set(canonicalRoot, project);
  };

  for (const root of observerRoots) addRoot(root);
  for (const entry of registeredRoots) addRoot(entry.root, entry);

  const assignedRoots = new Set();
  const projects = [...projectsByRoot.values()].map((project) => {
    const projectEntries = entries.filter((entry) => entryRoot(entry, realpath) === project.canonicalRoot);
    for (const entry of projectEntries) assignedRoots.add(entry);
    const active = projectEntries.filter((entry) => entry.status === "active").length;
    const key = project.resolved ? repoKey(project.canonicalRoot) : project.storedRepoKey;
    return {
      repoKey: key ?? null,
      displayName: basename(project.canonicalRoot),
      canonicalRoot: project.canonicalRoot,
      registered: project.registered,
      health: health.get(project.canonicalRoot) ?? (project.registered ? "empty" : "healthy"),
      entries: projectEntries,
      counts: { total: projectEntries.length, active },
      ambiguousIds: duplicateEntryIds(projectEntries),
      latestUpdatedAt: latestEntryTime(projectEntries),
    };
  });

  const ungroupedEntries = entries.filter((entry) => !assignedRoots.has(entry));
  if (ungroupedEntries.length) {
    projects.push({
      repoKey: null,
      displayName: "Ungrouped",
      canonicalRoot: null,
      registered: false,
      health: "healthy",
      entries: ungroupedEntries,
      counts: {
        total: ungroupedEntries.length,
        active: ungroupedEntries.filter((entry) => entry.status === "active").length,
      },
      ambiguousIds: duplicateEntryIds(ungroupedEntries),
      latestUpdatedAt: latestEntryTime(ungroupedEntries),
    });
  }

  const regularProjects = projects.filter((project) => project.canonicalRoot !== null).sort(projectSort);
  const trailingProjects = projects.filter((project) => project.canonicalRoot === null);
  return {
    generatedAt: new Date().toISOString(),
    projects: [...regularProjects, ...trailingProjects].map(({ latestUpdatedAt, ...project }) => project),
  };
}
