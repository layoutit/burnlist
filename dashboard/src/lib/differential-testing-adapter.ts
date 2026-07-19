export type DifferentialTestingData = {
  scenarioCatalog: { selectedScenarioId: string | null; scenarios: unknown[] };
  progress: unknown[];
  log: unknown[];
  summary: { fields: unknown; frames: unknown; [key: string]: unknown };
  fields: unknown[];
  telemetry?: unknown;
  refresh: unknown;
  [key: string]: unknown;
};

export type DifferentialTestingOvenPayload = DifferentialTestingData & {
  pageMode: "empty" | "detail";
};

export function adaptDifferentialTesting(data: DifferentialTestingData): DifferentialTestingOvenPayload {
  const empty = data.scenarioCatalog.selectedScenarioId === null;
  return { ...data, pageMode: empty ? "empty" : "detail" };
}
