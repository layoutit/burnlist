import type { BurnlistSummary, LandingSnapshot } from "./types";

export interface BurnlistProjectGroup {
  key: string;
  label: string;
  entries: BurnlistSummary[];
}

function projectKey(entry: BurnlistSummary): string {
  return entry.repoKey ?? entry.repo;
}

export function groupBurnlists(landing: LandingSnapshot): BurnlistProjectGroup[] {
  const labels = new Map(landing.projects.map((project) => [
    project.repoKey ?? project.displayName,
    project.displayName,
  ]));
  const groups = new Map<string, BurnlistProjectGroup>();
  for (const project of landing.projects) {
    const key = project.repoKey ?? project.displayName;
    groups.set(key, { key, label: project.displayName, entries: [] });
  }
  for (const entry of landing.burnlists) {
    const key = projectKey(entry);
    const group = groups.get(key) ?? { key, label: labels.get(key) ?? entry.repo, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.entries.length);
}

export function orderedBurnlists(landing: LandingSnapshot): BurnlistSummary[] {
  return groupBurnlists(landing).flatMap((group) => group.entries);
}
