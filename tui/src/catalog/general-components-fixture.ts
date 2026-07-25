const checkpoints = ["overview", "forms", "feedback", "interacted"] as const;
const actionLabels = {
  runBurn: "Run burn",
  openOven: "Open Oven",
  unavailable: "Unavailable",
  copy: "Copy",
  canonicalState: "Canonical state",
} as const;
const lifecycle = { active: "active", complete: "complete" } as const;

export type GeneralComponentsCheckpoint = typeof checkpoints[number];

export const generalComponentsFixture = {
  id: "general-components",
  title: "General console components",
  detail: "shared display, form, feedback, and interaction analogues",
  checkpoints,
  palette: ["foreground", "muted", "blue", "green", "amber", "red"],
  badges: ["active", "ready", "blocked"],
  actionLabels,
  buttons: [actionLabels.runBurn, actionLabels.openOven, actionLabels.unavailable],
  progress: [0, 24, 68, 100],
  table: [
    ["dashboard", "Observer layout", "Active", "27 / 31"],
    ["adapter-kit", "Contract acceptance", "Ready", "8 / 8"],
    ["render-lab", "Release readiness", "Draft", "3 / 9"],
  ],
  tabs: ["Active", "Complete", "Blocked"],
  toggles: ["Exact", "Visual", "Performance"],
  labels: {
    overview: {
      cardTitle: "Differential Testing",
      cardDescription: "Exact-first comparison against the bound native source.",
      tableCaption: "Local Burnlists discovered across configured repositories.",
      tableHeaders: ["Project", "Burnlist", "Status", "Progress"],
    },
    forms: {
      includeCompleted: "Include completed Burnlists",
      ovenName: "Oven name",
      ovenNameDescription: "A short label shown in the dashboard.",
      lifecycle: "Lifecycle",
      objective: "Objective",
      repositoryPath: "Repository path",
      repositoryPathError: "Use an absolute repository path.",
      filters: "lifecycle",
    },
    feedback: {
      verificationPassed: "Verification passed",
      evidenceAvailable: "All required evidence is available.",
      evidenceStale: "Evidence is stale",
      refreshArtifacts: "Refresh retained artifacts.",
      dashboardError: "Could not read local state.",
      emptyTitle: "No Burnlists found",
      emptyDetail: "Register a repository or adjust lifecycle filters.",
      loadingSummary: "Loading summary",
      copyInstructions: "Copy instructions",
      copyValue: "burnlist oven use checklist",
      canonicalState: actionLabels.canonicalState,
      canonicalStateDetail: "Source used to derive this view.",
    },
  },
  values: {
    ovenName: "Release readiness",
    repositoryPath: "relative/path",
    objectivePlaceholder: "Describe the measurable outcome.",
    lifecycle,
    tabs: {
      active: "Three Burnlists are cooking.",
      complete: "Completed work is retained.",
    },
    viewModes: ["List", "Table", "Chart"],
  },
  states: {
    overview: {
      visible: "overview",
      actions: ["runBurn", "openOven"],
      expectedOutcome: "Shows display primitives and the local Burnlist table.",
    },
    forms: {
      visible: "forms",
      includeCompleted: false,
      lifecycle: lifecycle.active,
      selectedTab: lifecycle.active,
      selectedView: "table",
      actions: ["tab:active", "view:table", "toggle:exact"],
      expectedOutcome: "Shows the default editable form controls.",
    },
    feedback: {
      visible: "feedback",
      actions: ["copy", "canonicalState"],
      expectedOutcome: "Shows success, warning, empty, loading, and error feedback.",
    },
    interacted: {
      visible: "forms",
      includeCompleted: true,
      lifecycle: lifecycle.complete,
      selectedTab: lifecycle.complete,
      selectedView: "chart",
      actions: ["tab:complete", "view:chart", "toggle:visual"],
      expectedOutcome: "Shows the form after its completion and chart selections change.",
    },
  },
} as const;
