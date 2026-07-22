import { useEffect, useRef } from "react";
import { parseRoute } from "../../lib/route-model.mjs";
import type { OvenAction, OvenIr, OvenState } from "./oven-reducer";

type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;
export type OvenPoller = { refresh(): void; stop(): void };
export type OvenPayloadAdapter = (raw: unknown) => unknown;

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

export function ovenPollSearch({ ir, state, scenario }: { ir: OvenIr; state: OvenState; scenario?: string }): string {
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

/** Poll coordinator kept outside React so request ordering is independently testable. */
export function createOvenPoller({ id, dispatch, fetchImpl = fetch as FetchLike, search, adapt, generationRef }: { id: string; dispatch: (action: OvenAction) => void; fetchImpl?: FetchLike; search?: string; adapt?: OvenPayloadAdapter; generationRef?: { current: number } }): OvenPoller {
  let stopped = false, inFlight = false, queued = false, etag: string | undefined;
  const generation = generationRef ?? { current: 0 };
  const refresh = () => {
    if (stopped) return;
    if (inFlight) { if (!queued) { queued = true; dispatch({ type: "payloadRequested" }); } return; }
    inFlight = true;
    generation.current += 1;
    dispatch({ type: "payloadRequested" });
    const requestGeneration = generation.current;
    const url = search === undefined ? ovenDataUrl(id) : `/api/oven-data/${encodeURIComponent(id)}${search}`;
    void fetchImpl(url, { cache: "no-store", headers: etag ? { "If-None-Match": etag } : undefined }).then(async (response) => {
      if (response.status === 304) {
        const nextEtag = response.headers.get("etag");
        if (nextEtag) etag = nextEtag;
        if (!stopped && requestGeneration === generation.current) dispatch({ type: "payloadUnchanged", generation: requestGeneration });
        return;
      }
      if (!response.ok) throw new Error(`Oven data request failed (${response.status})`);
      const raw = await response.json();
      const nextEtag = response.headers.get("etag");
      if (nextEtag) etag = nextEtag;
      if (!stopped && requestGeneration === generation.current) dispatch({ type: "payloadAccepted", payload: adapt ? adapt(raw) : raw, generation: requestGeneration });
    }).catch((error: unknown) => { if (!stopped && requestGeneration === generation.current) dispatch({ type: "payloadRejected", error, generation: requestGeneration }); }).finally(() => {
      inFlight = false;
      if (!stopped && queued) { queued = false; refresh(); }
    });
  };
  return { refresh, stop: () => { stopped = true; } };
}

export function useOvenLiveData(id: string | undefined, refreshSeconds: unknown, dispatch: (action: OvenAction) => void, search: string, adapt: OvenPayloadAdapter | undefined = undefined) {
  const dispatchRef = useRef(dispatch);
  const generationRef = useRef(0);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const seconds = Number(refreshSeconds);
    if (!id || !Number.isFinite(seconds) || seconds <= 0) return undefined;
    const poller = createOvenPoller({ id, dispatch: (action) => dispatchRef.current(action), search, adapt, generationRef });
    poller.refresh();
    const timer = setInterval(() => poller.refresh(), seconds * 1000);
    return () => { clearInterval(timer); poller.stop(); };
  }, [id, refreshSeconds, search, adapt]);
}
