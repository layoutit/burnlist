export const componentPairIds = [
  "alert",
  "badge",
  "button",
  "card",
  "checkbox",
  "field",
  "input",
  "progress",
  "select",
  "separator",
  "skeleton",
  "spinner",
  "table",
  "tabs",
  "textarea",
  "toggle-group",
  "tooltip",
  "copy-button",
  "dashboard-error",
  "empty-state",
  "filters",
  "field-list-cards",
  "top-card",
] as const;

export type ComponentPairId = typeof componentPairIds[number];

export const componentPairFixture = {
  alert: {
    title: "Verification passed",
    detail: "All required evidence is available for review.",
    tone: "success",
  },
  badge: { label: "active", tone: "accent" },
  button: { label: "Run burn", disabledLabel: "Unavailable" },
  card: {
    title: "Differential Testing",
    detail: "Exact-first comparison against the bound native source.",
    meta: "12 scenarios retained",
  },
  checkbox: { label: "Include completed Burnlists", checked: true },
  field: {
    label: "Repository path",
    value: "relative/path",
    detail: "The repository containing the Burnlist.",
    error: "Use an absolute repository path.",
  },
  input: { label: "Search Burnlists", value: "observer" },
  progress: { label: "Burnlist completion", value: 68 },
  select: {
    label: "Lifecycle",
    value: "active",
    options: ["draft", "active", "complete"],
  },
  separator: { before: "Current run", after: "Retained history" },
  skeleton: { label: "Loading Burnlist summary", rows: [18, 30, 22] },
  spinner: { label: "Loading result", frame: "✦" },
  table: {
    caption: "Local Burnlists",
    headers: ["Project", "Burnlist", "Status", "Progress"],
    rows: [
      ["dashboard", "Observer layout", "Active", "27 / 31"],
      ["adapter-kit", "Contract acceptance", "Ready", "8 / 8"],
    ],
  },
  tabs: {
    label: "Burnlist lifecycle",
    tabs: ["Active", "Complete", "Blocked"],
    selected: "Active",
    panel: "Three Burnlists are cooking.",
  },
  textarea: {
    label: "Objective",
    value: "Describe the measurable outcome and required evidence.",
  },
  toggleGroup: {
    label: "Dashboard view",
    options: ["List", "Table", "Chart"],
    selected: "Table",
  },
  tooltip: {
    label: "Canonical state",
    detail: "The source used to derive this dashboard view.",
  },
  copyButton: { label: "Copy", value: "npm run verify" },
  dashboardError: { message: "The local Burnlist registry could not be read." },
  emptyState: {
    title: "No active Burnlists",
    detail: "Draft a Burnlist or change the lifecycle filter.",
  },
  filters: {
    label: "Burnlist lifecycle",
    options: ["Active", "Ready", "Draft", "Done", "All"],
    selected: "Active",
  },
  fieldListCards: {
    fields: [
      { id: "position", label: "Position", status: "failed", failures: 1, delta: 0.1 },
      { id: "active", label: "Active", status: "pass", failures: 0, delta: 0 },
    ],
  },
  topCard: {
    title: "Exact delta",
    publishedAt: "2026-01-01T12:00:00.000Z",
    tasks: "2/3",
    elapsed: "30m",
    pace: "10m",
    done: "67%",
    log: "Frame 2 unchanged",
  },
} as const;
