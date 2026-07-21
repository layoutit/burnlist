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
  planPath: string | null;
  title: string;
  planLabel: string | null;
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
  /** Server-validated Oven identifier. */
  ovenId: string;
  ovenName: string;
  href: string;
  progressLabel: string;
  blockers?: string;
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

export type OvenSummary = {
  id: string;
  contract: string;
  name: string;
  description: string;
  builtIn: boolean;
  repoKey: string | null;
};

export type RepoSummary = { name: string; root: string; repoKey: string };

export type StreamingDiffIdentity = { logicalRepoKey: string; worktreeKey: string; session: string };
export type StreamingDiffFileKind = "modified" | "added" | "deleted" | "binary" | "denied" | "redacted" | "truncated" | "unavailable";
export type StreamingDiffFile = { path: string; kind: StreamingDiffFileKind; diff?: string; meta?: { bytes?: number; reason?: string; redacted?: true } };
export type StreamingDiffCard = { revId: string; toolUseId: string; ts: string; status: "captured" | "partial"; partialReason?: string; files: StreamingDiffFile[] };
export type StreamingDiffFeed = { identity: StreamingDiffIdentity; updatedAt: string | null; href: string; repoLabel?: string };

export type SelectedBurnlist = { repo?: string; repoKey?: string; id?: string; plan?: string };
export type ProgressData = ChecklistProgressData;
