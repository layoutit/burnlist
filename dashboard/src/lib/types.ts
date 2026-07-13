export type Filter = "active" | "draft" | "ready" | "complete" | "all";

export type ChecklistItem = { id: string; title: string; fields: Record<string, string> };
export type CompletedItem = { id: string; title: string; completedAt: string; detail: string };
export type Warning = { severity: "error" | "warning"; message: string };
export type HistoryPoint = { time: string; done: number; remaining: number; total: number; percent: number };

export type ChecklistProgressData = {
  generatedAt: string;
  repoKey: string | null;
  title: string;
  repo: string;
  planLabel: string;
  total: number;
  done: number;
  remaining: number;
  percent: number;
  warnings: Warning[];
  active: ChecklistItem[];
  completed: CompletedItem[];
  history: HistoryPoint[];
};

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
  lastCompletedAt: string | null;
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
  sources: Array<"registered" | "observed">;
  health: string;
  errors: string[];
  entries: Burnlist[];
  counts: { total: number; active: number };
  ambiguousIds: string[];
};

export type SelectedBurnlist = { repo?: string; repoKey?: string; id: string };
export type ProgressData = ChecklistProgressData;
