import { useEffect, useRef } from "react";
import {
  browserOvenSnapshotClient,
  OVEN_BROWSER_RECONCILE_MS,
} from "../../lib/oven-event-client.mjs";
import { parseRoute } from "../../lib/route-model.mjs";
import type { OvenAction, OvenIr, OvenState } from "./oven-reducer";

export type OvenPayloadAdapter = (raw: unknown) => unknown;
type SnapshotState = {
  data: unknown;
  error: string;
  generation: number;
  stale?: boolean;
  outcome: "initial" | "loading" | "accepted" | "unchanged" | "rejected" | "missing";
};
type SnapshotSubscription = { unsubscribe(): void; refresh(): void };
type SnapshotClient = {
  subscribe(descriptor: Record<string, unknown>, listener: (state: SnapshotState) => void): SnapshotSubscription;
};

export function scenarioSearch(currentSearch = typeof window === "undefined" ? "" : window.location.search, scenario?: string): string {
  const source = new URLSearchParams(currentSearch), target = new URLSearchParams();
  if (source.has("repoKey")) target.set("repoKey", source.get("repoKey")!);
  const selected = scenario ?? (source.has("scenario") ? source.get("scenario")! : undefined);
  if (selected !== undefined) target.set("scenario", selected);
  const query = target.toString();
  return query ? `?${query}` : "";
}

function browserSearchWithRepoKey() {
  if (typeof window === "undefined") return "";
  const source = new URLSearchParams(window.location.search);
  const { repoKey } = parseRoute({ pathname: window.location.pathname, search: window.location.search });
  if (repoKey) source.set("repoKey", repoKey);
  const query = source.toString();
  return query ? `?${query}` : "";
}

type IrNode = { attributes?: Record<string, unknown>; children?: IrNode[] };

function nodes(items: IrNode[] = []): IrNode[] { return items.flatMap((node) => [node, ...nodes(node.children)]); }
function attributes(ir: OvenIr, id: string): Record<string, unknown> {
  return nodes(ir.root).find((node) => node.attributes?.id === id)?.attributes ?? {};
}

export function ovenSnapshotSearch({ ir, state, scenario }: { ir: OvenIr; state: OvenState; scenario?: string }): string {
  const base = scenarioSearch(browserSearchWithRepoKey(), scenario);
  for (const item of ir.collections) {
    const collection = { ...attributes(ir, item.id), ...item };
    const current = state.collections[item.id];
    if (!current?.serverPage || (collection.paging !== "auto" && collection.paging !== "server")) continue;
    const searchId = typeof collection.searchFrom === "string" ? collection.searchFrom : undefined;
    const filterId = typeof collection.filterFrom === "string" ? collection.filterFrom : undefined;
    const sortId = typeof collection.sortFrom === "string" ? collection.sortFrom : undefined;
    const query = new URLSearchParams(base);
    query.set("search", String(searchId ? state.controls[searchId] ?? "" : ""));
    query.set("filter", filterId && state.controls[filterId] === true ? "failing" : "all");
    query.set("sort", sortId && state.controls[sortId] === true ? "changed" : "default");
    query.set("page", String(current.pageIndex));
    query.set("pageSize", String(current.pageSize));
    return `?${query.toString()}`;
  }
  return base;
}

export function ovenDataUrl(id: string, search = browserSearchWithRepoKey()): string {
  return `/api/oven-data/${encodeURIComponent(id)}${scenarioSearch(search)}`;
}

export function ovenRuntimeSnapshotDescriptor({ id, search, adapt, refreshSeconds }: {
  id: string;
  search: string;
  adapt?: OvenPayloadAdapter;
  refreshSeconds?: unknown;
}) {
  const query = new URLSearchParams(search);
  const requestedFallbackMs = Number(refreshSeconds) * 1_000;
  return {
    repoKey: query.get("repoKey"),
    ovenId: id,
    subjectId: query.get("scenario"),
    query: query.toString(),
    url: `/api/oven-data/${encodeURIComponent(id)}${search}`,
    fallbackMs: Number.isFinite(requestedFallbackMs) && requestedFallbackMs > 0
      ? Math.max(OVEN_BROWSER_RECONCILE_MS, requestedFallbackMs)
      : OVEN_BROWSER_RECONCILE_MS,
    fallbackError: `Could not load Oven ${id}.`,
    receive(response: Response, raw: unknown) {
      if (!response.ok) {
        const message = raw && typeof raw === "object" && typeof (raw as { error?: unknown }).error === "string"
          ? String((raw as { error: string }).error)
          : `Oven data request failed (${response.status})`;
        throw new Error(message);
      }
      return adapt ? adapt(raw) : raw;
    },
  };
}

export function subscribeOvenRuntimeSnapshot({
  client = browserOvenSnapshotClient as SnapshotClient,
  id,
  search,
  dispatch,
  adapt,
  refreshSeconds,
}: {
  client?: SnapshotClient;
  id: string;
  search: string;
  dispatch: (action: OvenAction) => void;
  adapt?: OvenPayloadAdapter;
  refreshSeconds?: unknown;
}) {
  let acceptedForSubscription = false;
  return client.subscribe(ovenRuntimeSnapshotDescriptor({ id, search, adapt, refreshSeconds }), (snapshot) => {
    if (snapshot.outcome === "initial") return;
    if (snapshot.outcome === "loading") {
      dispatch({ type: "payloadRequested", generation: snapshot.generation });
      return;
    }
    if (snapshot.outcome === "accepted") {
      acceptedForSubscription = true;
      dispatch({ type: "payloadAccepted", payload: snapshot.data, generation: snapshot.generation });
      return;
    }
    if (snapshot.outcome === "unchanged") {
      if (!acceptedForSubscription && snapshot.data !== null) {
        acceptedForSubscription = true;
        dispatch({ type: "payloadAccepted", payload: snapshot.data, generation: snapshot.generation });
      } else {
        dispatch({ type: "payloadUnchanged", generation: snapshot.generation });
      }
      return;
    }
    if (snapshot.outcome === "missing") {
      dispatch({ type: "payloadMissing", error: snapshot.error, generation: snapshot.generation });
      return;
    }
    dispatch({ type: "payloadRejected", error: snapshot.error, generation: snapshot.generation });
  });
}

export function useOvenLiveData(
  id: string | undefined,
  refreshSeconds: unknown,
  dispatch: (action: OvenAction) => void,
  search: string,
  adapt: OvenPayloadAdapter | undefined = undefined,
) {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    if (!id) return undefined;
    const subscription = subscribeOvenRuntimeSnapshot({
      id,
      search,
      adapt,
      refreshSeconds,
      dispatch: (action) => dispatchRef.current(action),
    });
    return () => subscription.unsubscribe();
  }, [id, refreshSeconds, search, adapt]);
}
