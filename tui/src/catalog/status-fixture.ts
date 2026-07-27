export const statusRationale = "Shared representative fixture; status space stays reserved.";
export const statusFixtureStates = {
  normal: {
    empty: false,
    payload: { count: 12, refresh: { status: "complete" }, note: {}, isTarget: true, rationale: statusRationale },
    console: { count: 12, clientStatus: undefined, error: "", isTarget: true, rationale: statusRationale },
  },
  loading: {
    empty: false,
    payload: { count: 12, refresh: { status: "loading" }, note: {}, isTarget: true, rationale: statusRationale },
    console: { count: 12, clientStatus: "loading", error: "", isTarget: true, rationale: statusRationale },
  },
  error: {
    empty: false,
    payload: { count: 12, refresh: { status: "failed", error: "Request failed" }, note: {}, isTarget: true, rationale: statusRationale },
    console: { count: 12, clientStatus: "failed", error: "Request failed", isTarget: true, rationale: statusRationale },
  },
  empty: {
    empty: true,
    payload: {},
    console: { count: 0, clientStatus: undefined, error: "", isTarget: false, rationale: "" },
  },
} as const;

export type StatusFixtureCheckpoint = keyof typeof statusFixtureStates;
export const statusFixtureCheckpoints = Object.freeze(Object.keys(statusFixtureStates) as StatusFixtureCheckpoint[]);
