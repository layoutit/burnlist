export const checklistFixture = {
  generatedAt: "2026-07-15T12:00:00Z", repoKey: "fixture", repo: "fixture", planLabel: "active.md", title: "Fixture Burnlist",
  total: 2, done: 2, remaining: 0, percent: 100, warnings: [], active: [],
  completed: [
    { id: "B1", title: "First event", completedAt: "2026-07-15T11:40:00Z", detail: "First proof." },
    { id: "B2", title: "Second event", completedAt: "2026-07-15T11:50:00Z", detail: "Completed: 2026-07-15T11:50:00Z\nChanged:\n- src/second.mjs\nProof:\n- node --test second.test.mjs\nOutcome:\n- Second proof.\nFollow-up:\n- None." },
  ],
  history: [
    { time: "2026-07-15T11:40:00Z", done: 1, remaining: 1, total: 2, percent: 50 },
    { time: "2026-07-15T11:50:00Z", done: 2, remaining: 0, total: 2, percent: 100 },
  ],
};
