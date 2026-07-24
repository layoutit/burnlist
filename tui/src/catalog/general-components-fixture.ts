export const generalComponentsFixture = {
  id: "general-components",
  title: "General console components",
  detail: "shared display, form, feedback, and interaction analogues",
  checkpoints: ["overview", "forms", "feedback", "interacted"] as const,
  palette: ["foreground", "muted", "blue", "green", "amber", "red"],
  badges: ["active", "ready", "blocked"],
  buttons: ["Run burn", "Open Oven", "Unavailable"],
  progress: [0, 24, 68, 100],
  table: [
    ["dashboard", "Observer layout", "Active", "27 / 31"],
    ["adapter-kit", "Contract acceptance", "Ready", "8 / 8"],
    ["render-lab", "Release readiness", "Draft", "3 / 9"],
  ],
  tabs: ["Active", "Complete", "Blocked"],
  toggles: ["Exact", "Visual", "Performance"],
} as const;

export type GeneralComponentsCheckpoint = typeof generalComponentsFixture.checkpoints[number];

