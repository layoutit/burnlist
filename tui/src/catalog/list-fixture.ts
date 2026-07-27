export type ListColumn = Readonly<{ id: string; label: string; width?: number; minWidth?: number }>;
export type ListRow = Readonly<{ id: string; cells: Readonly<Record<string, string>>; tone?: "good" | "warn" | "bad"; latest?: boolean; current?: boolean; detail?: string }>;

export const listFixture = Object.freeze({
  id: "shared-lists",
  title: "Tables and lists",
  detail: "log, ledger, feed, and fields",
  columns: [
    { id: "state", label: "STATE", width: 9 },
    { id: "id", label: "ID", width: 9 },
    { id: "item", label: "ITEM", minWidth: 12 },
    { id: "updated", label: "UPDATED", width: 10 },
  ] as const satisfies readonly ListColumn[],
  rows: Array.from({ length: 28 }, (_, index) => {
    const number = index + 1;
    const current = number === 5;
    const latest = number === 28;
    return {
      id: `B${number}`,
      cells: {
        state: current ? "ACTIVE" : number % 9 === 0 ? "BLOCKED" : number % 3 === 0 ? "WARN" : "DONE",
        id: `B${number}`,
        item: number === 5 ? "Inspect the current burning item with a bounded title" : number === 28 ? "Latest event remains visible above the footer" : `Representative ${number % 4 === 0 ? "field change from the shared streaming feed" : "checklist ledger entry"}`,
        updated: latest ? "LATEST" : `${Math.max(1, 29 - number)}m ago`,
      },
      tone: number % 9 === 0 ? "bad" : number % 3 === 0 ? "warn" : "good",
      current,
      latest,
      detail: number === 5 ? "Expanded detail is shared by log rows, checklist entries, feeds, and field records." : undefined,
    };
  }) as readonly ListRow[],
});

export const listFixtureStates = ["current", "expanded", "latest"] as const;
export type ListFixtureState = typeof listFixtureStates[number];

/** Shared semantic rows for the native Storybook preview and terminal component. */
export function listPreviewRows(width: number, state: ListFixtureState) {
  const selectedId = state === "latest" ? "B28" : "B5";
  return { selectedId, expandedId: state === "expanded" ? "B5" : undefined, width, rows: listFixture.rows };
}
