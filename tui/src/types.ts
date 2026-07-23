export interface ProjectSummary {
  repoKey: string | null;
  displayName: string;
  canonicalRoot: string | null;
  health: string;
  counts: { total: number; active: number };
}

export interface BurnlistSummary {
  id: string;
  repo: string;
  repoKey: string | null;
  repoRoot: string | null;
  title: string;
  planPath: string | null;
  planLabel: string | null;
  status: string;
  statusLabel: string;
  total: number;
  done: number | null;
  remaining: number | null;
  percent: number | null;
  errors: number;
  warnings: number;
  updatedAt: string | null;
  lastCompletedAt: string | null;
  ovenId: string;
  ovenName: string;
  href: string;
  progressLabel: string;
  blockers?: string;
}

export interface OvenSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  contract: string;
  builtIn: boolean;
  repoKey: string | null;
  dataInput: "json-payload" | "producer-managed";
}

export interface OvenPackageDetail extends OvenSummary {
  instructions: string;
  oven: string;
  ovenRevision: string;
  ir: {
    schema: "burnlist-oven-ir@1";
    id: string;
    version: string;
    contract: string;
    theme: string;
    root: Array<{ kind: string; children?: Array<{ kind: string }> }>;
    requirements?: { components?: string[] };
  };
}

export interface ProgressSnapshot {
  generatedAt: string;
  repoKey: string | null;
  title: string;
  repo: string;
  planPath?: string;
  planLabel: string;
  total: number;
  done: number;
  remaining: number;
  percent: number;
  warnings: Array<{ severity: "error" | "warning"; message: string }>;
  goal?: {
    available: boolean;
    label: string;
    path: string;
    sections: Array<{ title: string; body: string }>;
    error?: string;
  };
  active: Array<{ id: string; title: string; fields?: Record<string, string> }>;
  completed: Array<{ id: string; title: string; completedAt: string; detail?: string }>;
  history?: Array<{ time: string; done: number; remaining: number; total: number; percent: number }>;
}

export interface VisualParityPayload {
  schema: "burnlist-visual-parity-data@1";
  differentialTesting: {
    publishedAt?: string | null;
    scenarioCatalog: {
      selectedScenarioId: string;
      scenarios: Array<{ id: string; label: string; frameCount: number }>;
    };
  };
  domains: Array<{
    id: string;
    label: string;
    isolation: "render-pass";
    qualification: "target" | "context";
    tolerance?: { rationale?: string; channelDelta?: number; meanAbsoluteDelta?: number; changedPixelRatio?: number };
  }>;
  comparisons: Array<{
    id: string;
    label: string;
    frame: number;
    status: "pass" | "fail";
    domains: Record<string, {
      label: string;
      status: "pass" | "fail";
      reference: VisualParityImage;
      candidate: VisualParityImage;
      diff: VisualParityImage;
      difference: {
        changedPixels: number;
        totalPixels: number;
        ratio: number;
        meanAbsoluteDelta: number;
        maximumAbsoluteDelta: number;
      };
    }>;
  }>;
}

export interface VisualParityImage {
  label: string;
  src: string | null;
  width: number;
  height: number;
}

export interface DetailItem {
  key: string;
  kind: "active" | "completed" | "visual-frame";
  id: string;
  title: string;
  status: string;
  latest: boolean;
  fields?: Record<string, string>;
  detail?: string;
  completedAt?: string;
  comparisonIndex?: number;
}

export interface OvenDataSnapshot {
  ovenId: string;
  payload: unknown;
  validated?: boolean;
  path?: string;
}

export interface LandingSnapshot {
  projects: ProjectSummary[];
  burnlists: BurnlistSummary[];
  ovens: OvenSummary[];
  generatedAt: string;
}
