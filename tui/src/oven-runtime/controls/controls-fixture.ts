export const controlsFixture = {
  id: "shared-controls",
  title: "Keyboard controls",
  detail: "tabs, search, filter, and paging",
  contract: "burnlist-differential-testing-data@1",
  tabs: [
    { id: "fields", label: "Fields", qualification: "paired", failed: 1 },
    { id: "runs", label: "Runs", qualification: "paired", failed: 0 },
    { id: "alerts", label: "Alerts", qualification: "paired", failed: 0 },
  ],
  rows: [
    { id: "position", label: "Position", failedSampleCount: 1, missingSampleCount: 0, telemetry: { failToPassCount: 2, passToFailCount: 0 } },
    { id: "active", label: "Active", failedSampleCount: 0, missingSampleCount: 0, telemetry: { failToPassCount: 0, passToFailCount: 0 } },
    { id: "velocity", label: "Velocity", failedSampleCount: 2, missingSampleCount: 0, telemetry: { failToPassCount: 1, passToFailCount: 1 } },
    { id: "heading", label: "Heading", failedSampleCount: 0, missingSampleCount: 0, telemetry: { failToPassCount: 0, passToFailCount: 0 } },
  ],
  pageSize: 2,
  checkpoints: ["initial", "searched", "filtered", "next-page"] as const,
} as const;

export type ControlFocus = "tabs" | "search" | "filter" | "sort" | "prev" | "next";
export type ControlsState = { tab: number; query: string; filter: boolean; page: number; focus: ControlFocus; notice: string };
export const controlsInitialState = (): ControlsState => ({ tab: 0, query: "", filter: false, page: 0, focus: "tabs", notice: "" });
const focusOrder: readonly ControlFocus[] = ["tabs", "search", "filter", "sort", "prev", "next"];
export function controlsRows(state: ControlsState) {
  const query = state.query.trim().toLowerCase();
  return controlsFixture.rows.filter((row) => (!query || row.label.toLowerCase().includes(query)) && (!state.filter || row.failedSampleCount + row.missingSampleCount > 0));
}
export function controlsPage(state: ControlsState) {
  const rows = controlsRows(state), count = Math.max(1, Math.ceil(rows.length / controlsFixture.pageSize)), page = Math.min(state.page, count - 1);
  return { rows: rows.slice(page * controlsFixture.pageSize, page * controlsFixture.pageSize + controlsFixture.pageSize), count, page };
}
export function controlsAction(state: ControlsState, key: string): ControlsState {
  if (key === "tab") return { ...state, focus: focusOrder[(focusOrder.indexOf(state.focus) + 1) % focusOrder.length]!, notice: "" };
  if (state.focus === "tabs" && (key === "left" || key === "right")) return { ...state, tab: (state.tab + (key === "left" ? -1 : 1) + controlsFixture.tabs.length) % controlsFixture.tabs.length, notice: "" };
  if (state.focus === "search") {
    if (key === "backspace") return { ...state, query: state.query.slice(0, -1), page: 0, notice: "" };
    if (key.length === 1) return { ...state, query: state.query + key, page: 0, notice: "" };
  }
  if (state.focus === "filter" && (key === "return" || key === "enter" || key === " ")) return { ...state, filter: !state.filter, page: 0, notice: "" };
  if (state.focus === "sort" && (key === "return" || key === "enter" || key === " ")) return { ...state, notice: "Sort unavailable: changed telemetry is not rendered." };
  const page = controlsPage(state);
  if (state.focus === "next" && (key === "return" || key === "enter" || key === "right")) return page.page >= page.count - 1 ? { ...state, notice: "Already on the last page." } : { ...state, page: page.page + 1, notice: "" };
  if (state.focus === "prev" && (key === "return" || key === "enter" || key === "left")) return page.page === 0 ? { ...state, notice: "Already on the first page." } : { ...state, page: page.page - 1, notice: "" };
  return state;
}
export function controlsCheckpoint(name: typeof controlsFixture.checkpoints[number]): ControlsState {
  let state = controlsInitialState();
  if (name === "searched") state = { ...state, query: "pos", focus: "search" };
  if (name === "filtered") state = { ...state, filter: true, focus: "filter" };
  if (name === "next-page") state = { ...state, page: 1, focus: "next" };
  return state;
}
