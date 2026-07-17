import type { Burnlist, Filter, SelectedBurnlist } from "./types";

export function currentSection() {
  if (window.location.pathname === "/ovens/new") return "new-oven";
  if (window.location.pathname === "/ovens/differential-testing/view") return "differential-testing";
  if (window.location.pathname === "/ovens/performance-tracing/view") return "performance-tracing";
  if (window.location.pathname === "/ovens/streaming-diff/view") return "streaming-diff";
  if (window.location.pathname === "/ovens/visual-parity/view") return "visual-parity";
  if (window.location.pathname === "/runs/new") return "run-burn";
  return "burnlists";
}

export function ovenRepoKey() {
  return ["differential-testing", "performance-tracing", "streaming-diff", "visual-parity"].includes(currentSection())
    ? new URLSearchParams(window.location.search).get("repoKey")
    : null;
}

export function streamingDiffSelection() {
  if (currentSection() !== "streaming-diff") return null;
  const params = new URLSearchParams(window.location.search);
  const repoKey = params.get("repoKey");
  const worktreeKey = params.get("worktreeKey");
  const session = params.get("session");
  return repoKey && worktreeKey && session ? { repoKey, worktreeKey, session } : null;
}

export function selectedBurnlist(): SelectedBurnlist | null {
  if (currentSection() !== "burnlists") return null;
  const plan = new URLSearchParams(window.location.search).get("plan");
  if (plan) return { plan };
  const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 3 && parts[0] === "r") return { repoKey: parts[1], id: parts[2] };
  return parts.length === 2 ? { repo: parts[0], id: parts[1] } : null;
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
  const path = entry.repoKey
    ? `/r/${encodeURIComponent(entry.repoKey)}/${encodeURIComponent(entry.id)}`
    : `/${encodeURIComponent(entry.repo)}/${encodeURIComponent(entry.id)}`;
  return `${path}?filter=${encodeURIComponent(filter)}`;
}
