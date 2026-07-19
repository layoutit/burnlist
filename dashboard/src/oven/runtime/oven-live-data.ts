import { useEffect, useRef } from "react";
import type { OvenAction } from "./oven-reducer";

type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;
export type OvenPoller = { refresh(): void; stop(): void };

export function ovenDataUrl(id: string, search = typeof window === "undefined" ? "" : window.location.search): string {
  const source = new URLSearchParams(search), target = new URLSearchParams();
  for (const key of ["repoKey", "scenario"]) if (source.has(key)) target.set(key, source.get(key)!);
  const query = target.toString();
  return `/api/oven-data/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

/** Poll coordinator kept outside React so request ordering is independently testable. */
export function createOvenPoller({ id, dispatch, fetchImpl = fetch as FetchLike, search }: { id: string; dispatch: (action: OvenAction) => void; fetchImpl?: FetchLike; search?: string }): OvenPoller {
  let stopped = false, inFlight = false, queued = false, generation = 0, etag: string | undefined;
  const refresh = () => {
    if (stopped) return;
    if (inFlight) { queued = true; dispatch({ type: "payloadRequested" }); return; }
    inFlight = true;
    generation += 1;
    dispatch({ type: "payloadRequested" });
    const requestGeneration = generation;
    void fetchImpl(ovenDataUrl(id, search), { cache: "no-store", headers: etag ? { "If-None-Match": etag } : undefined }).then(async (response) => {
      if (!response.ok) throw new Error(`Oven data request failed (${response.status})`);
      const payload = await response.json();
      const nextEtag = response.headers.get("etag");
      if (nextEtag) etag = nextEtag;
      if (!stopped && requestGeneration === generation) dispatch({ type: "payloadAccepted", payload, generation: requestGeneration });
    }).catch((error: unknown) => { if (!stopped && requestGeneration === generation) dispatch({ type: "payloadRejected", error, generation: requestGeneration }); }).finally(() => {
      inFlight = false;
      if (!stopped && queued) { queued = false; refresh(); }
    });
  };
  return { refresh, stop: () => { stopped = true; } };
}

export function useOvenLiveData(id: string | undefined, refreshSeconds: unknown, dispatch: (action: OvenAction) => void) {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const seconds = Number(refreshSeconds);
    if (!id || !Number.isFinite(seconds) || seconds <= 0) return undefined;
    const poller = createOvenPoller({ id, dispatch: (action) => dispatchRef.current(action) });
    poller.refresh();
    const timer = setInterval(() => poller.refresh(), seconds * 1000);
    return () => { clearInterval(timer); poller.stop(); };
  }, [id, refreshSeconds]);
}
