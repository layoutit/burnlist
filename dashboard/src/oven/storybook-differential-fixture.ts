import type { DifferentialPayload } from "./DifferentialKpiStrip/DifferentialKpiStrip";
import type { DifferentialLogEntry } from "./DifferentialLogTable/DifferentialLogTable";
import type { HybridFieldData } from "./HybridField/HybridField";

export const DIFFERENTIAL_STORY_NOW = Date.parse("2026-01-01T12:30:00.000Z");

export const DIFFERENTIAL_POSITION_FIELD: HybridFieldData = {
  id: "position",
  label: "Position",
  sourceOwner: "engine/state",
  semantics: { meaning: "One-dimensional position after the update" },
  trustStatus: "pass",
  driftReason: "One or more values exceed tolerance.",
  failedSampleCount: 1,
  missingSampleCount: 0,
  maxDelta: 0.10000000000000009,
  samples: [
    [0, 0, 0, 0],
    [1, 1, 1.005, 0],
    [2, 2, 2.1, 1],
  ],
};

export const DIFFERENTIAL_ACTIVE_FIELD: HybridFieldData = {
  id: "active",
  label: "Active",
  sourceOwner: "engine/state",
  semantics: { meaning: "Whether the object is active after the update" },
  trustStatus: "pass",
  driftReason: "All aligned values match.",
  failedSampleCount: 0,
  missingSampleCount: 0,
  maxDelta: 0,
  samples: [
    [0, false, false, 0],
    [1, true, true, 0],
    [2, true, true, 0],
  ],
};

export const DIFFERENTIAL_STORY_FIELDS: HybridFieldData[] = [
  DIFFERENTIAL_POSITION_FIELD,
  DIFFERENTIAL_ACTIVE_FIELD,
];

export const DIFFERENTIAL_STORY_LOG: Array<DifferentialLogEntry & { result: string }> = [
  {
    timestamp: "2026-01-01T12:00:00.000Z",
    result: "unchanged",
    frame: 2,
    frames: 3,
    frameDelta: 0,
  },
];

export const DIFFERENTIAL_STORY_PAYLOAD: DifferentialPayload & Record<string, unknown> = {
  scenarioCatalog: {
    selectedScenarioId: "135b757802521cd1",
    scenarios: [{ id: "135b757802521cd1" }],
  },
  progress: [{ frame: 2, frames: 3 }],
  log: DIFFERENTIAL_STORY_LOG,
  summary: {
    fields: { total: 2, failed: 1, blocked: 0 },
    frames: { total: 6, failed: 1, blocked: 0 },
  },
  subtitle: "reference-fixture / candidate-fixture",
  publishedAt: "2026-01-01T12:00:00.000Z",
  trust: { status: "pass", blockers: [] },
  primaryChartTitle: "Exact delta",
  historyTitle: "Run log",
};
