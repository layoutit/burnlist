export type Filter = "active" | "draft" | "ready" | "complete" | "all";

export type ChecklistItem = {
  id: string;
  title: string;
  fields: Record<string, string>;
  loop?: null | {
    selector: string;
    assignmentId: string;
    executionRevision: string;
    packageRevision: string;
    graph?: LoopRunProjection["graph"] | null;
  };
};
export type CompletedItem = { id: string; title: string; completedAt: string; detail: string };
export type Warning = { severity: "error" | "warning"; message: string };
export type HistoryPoint = { time: string; done: number; remaining: number; total: number; percent: number };
export type LoopRunProjection = {
  schema: "burnlist-loop-read-projection@1";
  runId: string;
  itemRef: string;
  loopId: string;
  loopRevision: string | null;
  createdAt: number;
  updatedAt: number;
  state: string;
  currentNode: string;
  attempt: number;
  cycle: number;
  revision: string;
  budget: {
    limits: { maxRounds: number; maxMinutes: number; maxAgentRuns: number; maxCheckRuns: number; maxTransitions: number; maxOutputBytes: number };
    counters: { rounds: number; agentRuns: number; checkRuns: number; transitions: number; outputBytes: number };
    elapsedMilliseconds: number;
    journal: { maximum: number; used: number; remaining: number };
  };
  latestResult: null | { kind: string; summary: string };
  latestMaker?: null | { summary: string; at: number; candidateId: string | null };
  latestCheck?: null | { summary: string; at: number; candidateId: string | null };
  latestReviewer?: null | { summary: string; at: number; candidateId: string | null };
  graph: {
    entry: string;
    nodes: Array<{
      id: string;
      kind: string;
      role?: string;
      authority?: "write" | "read";
      capability?: string;
      gateKind?: string;
      measure?: "test" | "metric" | "eval" | "boolean";
      target?: string;
      terminalState?: string;
      execution?: null | {
        profileId: string;
        model: string;
        effort: string;
        authority: "write" | "read";
      };
    }>;
    edges: Array<{ from: string; on: string; to: string }>;
  };
  transitions: Array<{ sequence: number; from: string; outcome: string; to: string }>;
  diagnostic?: "stale" | "corrupt";
};

export type ChecklistProgressData = {
  generatedAt: string;
  repoKey: string | null;
  title: string;
  repo: string;
  planLabel: string;
  selectedItemId?: string | null;
  total: number;
  done: number;
  remaining: number;
  percent: number;
  warnings: Warning[];
  active: ChecklistItem[];
  completed: CompletedItem[];
  history: HistoryPoint[];
  loopRun?: LoopRunProjection | null;
  loopProjectionDiagnostic?: "corrupt" | "stale";
  loopProjectionMessage?: string;
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
  inputContract: string;
  renderContract: string;
  version: string;
  name: string;
  description: string;
  builtIn: boolean;
  origin: "official" | "vendored" | "custom";
  repoKey: string | null;
  dataInput: "json-payload" | "producer-managed";
  runtimeCompatibility: string | null;
  ovenRevision: string;
  catalogRevision: string | null;
};

export type OfficialOvenCatalogEntry = {
  id: string;
  version: string;
  inputContract: string;
  renderContract: string;
  dataInput: "json-payload" | "producer-managed";
  producer: string;
  routeKind: "burnlist-lens" | "repo-oven";
  maturity: "shipped" | "experimental" | "deprecated";
  runtimeCompatibility: string;
  name: string;
  description: string;
  ovenRevision: string;
};

export type OfficialOvenCatalogResponse = {
  schema: "burnlist-official-oven-catalog@1";
  catalogVersion: string;
  catalogRevision: string;
  entries: OfficialOvenCatalogEntry[];
};

export type RepoSummary = { name: string; root: string; repoKey: string };

export type StreamingDiffIdentity = { logicalRepoKey: string; worktreeKey: string; session: string };
export type StreamingDiffFileKind = "modified" | "added" | "deleted" | "binary" | "denied" | "redacted" | "truncated" | "unavailable";
export type StreamingDiffFile = { path: string; kind: StreamingDiffFileKind; diff?: string; meta?: { bytes?: number; reason?: string; redacted?: true } };
export type StreamingDiffCard = { revId: string; toolUseId: string; ts: string; status: "captured" | "partial"; partialReason?: string; files: StreamingDiffFile[] };
export type StreamingDiffFeed = { identity: StreamingDiffIdentity; updatedAt: string | null; href: string; repoLabel?: string };

export type SelectedBurnlist = { repo?: string; repoKey?: string; id?: string; plan?: string; item?: string };
export type ProgressData = ChecklistProgressData;
