import type { BurnlistSummary, LandingSnapshot } from "./types";

export const LANDING_FILTERS = ["active", "ready", "draft", "done", "all"] as const;
export type LandingFilter = typeof LANDING_FILTERS[number];

export function filterBurnlists(entries: readonly BurnlistSummary[], filter: LandingFilter): BurnlistSummary[] {
  if (filter === "all") return [...entries];
  const status = filter === "done" ? "complete" : filter;
  return entries.filter((entry) => entry.status === status);
}

export function filteredLanding(landing: LandingSnapshot, filter: LandingFilter): LandingSnapshot {
  return { ...landing, burnlists: filterBurnlists(landing.burnlists, filter) };
}

export function cycleLandingFilter(filter: LandingFilter, direction: -1 | 1): LandingFilter {
  const index = LANDING_FILTERS.indexOf(filter);
  return LANDING_FILTERS[(index + direction + LANDING_FILTERS.length) % LANDING_FILTERS.length]!;
}
