import { burnlistHref as buildBurnlistHref, parseRoute } from "./route-model.mjs";
import type { Burnlist, Filter, SelectedBurnlist } from "./types";

function route() {
  return parseRoute({ pathname: window.location.pathname, search: window.location.search });
}

export function currentSection() {
  return route().section;
}

export function customOvenSelection(): { id: string; repoKey: string | null; burnlistId: string | null } | null {
  const current = route();
  return current.section === "custom-oven" ? { id: current.ovenId, repoKey: current.repoKey, burnlistId: current.burnlistId ?? null } : null;
}

export function ovenExplainerSelection(): { ovenId: string; repoKey: string | null } | null {
  const current = route();
  return current.section === "oven-explainer"
    ? { ovenId: current.ovenId, repoKey: new URLSearchParams(window.location.search).get("repoKey") }
    : null;
}

export function burnlistLensContext(): { repoKey: string; burnlistId: string; activeOvenId: string } | null {
  const current = route();
  if (!current.repoKey || !current.burnlistId) return null;
  if (current.section === "burnlist") return { repoKey: current.repoKey, burnlistId: current.burnlistId, activeOvenId: current.ovenId ?? "checklist" };
  return current.ovenId ? { repoKey: current.repoKey, burnlistId: current.burnlistId, activeOvenId: current.ovenId } : null;
}

export function ovenRepoKey() {
  const current = route();
  return ["differential-testing", "model-lab", "performance-tracing", "streaming-diff", "visual-parity", "custom-oven"].includes(current.section)
    ? current.repoKey
    : null;
}

export function streamingDiffSelection() {
  const current = route();
  return current.section === "streaming-diff" && current.repoKey && current.worktreeKey && current.session
    ? { repoKey: current.repoKey, worktreeKey: current.worktreeKey, session: current.session }
    : null;
}

export function selectedBurnlist(): SelectedBurnlist | null {
  const current = route();
  if (current.plan) return { plan: current.plan };
  if (current.repoKey && current.burnlistId) return { repoKey: current.repoKey, id: current.burnlistId };
  return current.repo && current.burnlistId ? { repo: current.repo, id: current.burnlistId } : null;
}

export function filterFromUrl(filters: Array<{ value: Filter }>): Filter {
  const value = new URLSearchParams(window.location.search).get("filter") as Filter | null;
  return filters.some((filter) => filter.value === value) ? value! : "active";
}

export function listHref(filter: Filter) {
  return filter === "all" ? "/" : `/?filter=${encodeURIComponent(filter)}`;
}

export function burnlistHref(entry: Burnlist, filter: Filter, ambiguous = false) {
  if (ambiguous) return `/?plan=${encodeURIComponent(entry.planPath ?? "")}&filter=${encodeURIComponent(filter)}`;
  return entry.repoKey
    ? buildBurnlistHref({ repoKey: entry.repoKey, burnlistId: entry.id, query: { filter } })
    : `/${encodeURIComponent(entry.repo)}/${encodeURIComponent(entry.id)}?filter=${encodeURIComponent(filter)}`;
}
