import type { ChecklistProgressData } from "@/checklist-dashboard";

export type Filter = "active" | "draft" | "ready" | "complete" | "all";

export type Burnlist = {
  id: string;
  repo: string;
  repoKey: string | null;
  repoRoot: string | null;
  title: string;
  planLabel: string;
  status: Exclude<Filter, "all">;
  statusLabel: string;
  total: number;
  done: number | null;
  remaining: number | null;
  percent: number | null;
  errors: number;
  warnings: number;
  updatedAt: string | null;
  ovenId: "checklist" | "differential-testing";
  ovenName: string;
  href: string;
  progressLabel: string;
};

export type Project = {
  repoKey: string | null;
  displayName: string;
  canonicalRoot: string | null;
  registered: boolean;
  health: string;
  entries: Burnlist[];
  counts: { total: number; active: number };
  ambiguousIds: string[];
};

export type SelectedBurnlist = { repo?: string; repoKey?: string; id: string };
export type ProgressData = ChecklistProgressData;
