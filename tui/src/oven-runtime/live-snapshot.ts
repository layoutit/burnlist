export type LiveOutcome = "initial" | "loading" | "accepted" | "unchanged" | "rejected" | "missing";
export type LiveSnapshot<T> = Readonly<{ data: T | null; error: string; loading: boolean; stale: boolean; outcome: LiveOutcome }>;

export function initialLiveSnapshot<T>(data: T | null = null): LiveSnapshot<T> {
  return { data, error: "", loading: false, stale: false, outcome: "initial" };
}

/** Mirrors the console snapshot client: retain only transiently stale canonical data. */
export function reduceLiveSnapshot<T>(current: LiveSnapshot<T>, outcome: LiveOutcome, value?: T | null, error = ""): LiveSnapshot<T> {
  if (outcome === "initial") return current;
  if (outcome === "loading") return { ...current, error: "", loading: true, stale: current.data !== null, outcome };
  if (outcome === "missing") return { data: null, error, loading: false, stale: false, outcome };
  if (outcome === "rejected") return { ...current, error, loading: false, stale: current.data !== null, outcome };
  return { data: value ?? current.data, error: "", loading: false, stale: false, outcome };
}

export function isMissingSnapshotStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/** Console-equivalent server collection request: the retained control/page state is authoritative. */
export function terminalServerQuery(ir: TerminalOvenIR, state: TerminalRuntimeState | null): Record<string, string | number> {
  if (!state) return {};
  for (const collection of collectionDescriptors(ir)) {
    const current = state.collections[collection.id];
    if (!current?.serverPage || (collection.paging !== "server" && collection.paging !== "auto")) continue;
    const search = typeof collection.searchFrom === "string" ? state.controls[collection.searchFrom] ?? "" : "";
    const filter = typeof collection.filterFrom === "string" && state.controls[collection.filterFrom] === true ? "failing" : "all";
    const sort = typeof collection.sortFrom === "string" && state.controls[collection.sortFrom] === true ? "changed" : "default";
    return { search: String(search), filter, sort, page: current.pageIndex, pageSize: current.pageSize };
  }
  return {};
}
import { collectionDescriptors } from "./ir-descriptor";
import type { TerminalRuntimeState } from "./state-runtime";
import type { TerminalOvenIR } from "./terminal-contract";
