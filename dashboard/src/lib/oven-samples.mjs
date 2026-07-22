import { adaptChecklist } from "./checklist-adapter";

const checklistSample = {
  generatedAt: "2026-07-21T10:00:00Z",
  repoKey: null,
  repo: "sample-repository",
  planLabel: "burnlist.md",
  title: "Sample Burnlist",
  total: 3,
  done: 2,
  remaining: 1,
  percent: 67,
  warnings: [],
  active: [{ id: "B6", title: "Explain the Oven", fields: {} }],
  completed: [
    { id: "B4", title: "Add the catalog route", completedAt: "2026-07-21T09:20:00Z", detail: "Outcome: Catalog route is available." },
    { id: "B5", title: "Prepare Oven definitions", completedAt: "2026-07-21T09:40:00Z", detail: "Outcome: Definitions are ready to inspect." },
  ],
  history: [
    { time: "2026-07-21T09:20:00Z", done: 1, remaining: 2, total: 3, percent: 33 },
    { time: "2026-07-21T09:40:00Z", done: 2, remaining: 1, total: 3, percent: 67 },
    { time: "2026-07-21T10:00:00Z", done: 2, remaining: 1, total: 3, percent: 67 },
  ],
};

/** Returns static demo data only when an Oven can render without live data. */
export function ovenSamplePayload(ovenId) {
  return ovenId === "checklist" ? adaptChecklist(checklistSample) : null;
}
