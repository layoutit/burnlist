import { useEffect, useState, type DependencyList } from "react";
import { browserOvenSnapshotClient } from "../../lib/oven-event-client.mjs";
import { createSseTransport } from "./transports";

type PropsConfig<T> = { transport: "props"; data: T };

type SnapshotConfig<T> = {
  transport: "snapshot";
  enabled?: boolean;
  repoKey: string | null;
  ovenId: string;
  subjectId?: string | null;
  query?: string;
  makeUrl: () => string;
  receive: (response: Response, json: unknown) => T;
  fallbackError: string;
  fallbackMs?: number;
  initialData?: T | null;
  events?: Array<{ ovenId?: string; kind: string; phase: string }>;
  deps?: DependencyList;
};

type SseConfig<T> = {
  transport: "sse";
  makeUrl: () => string | null;
  initialData: T;
  applyReset: (data: T) => T;
  applyMessage: (data: T, raw: string) => T;
  invalidError: string;
  disconnectError: string;
  deps?: DependencyList;
};

export type OvenLiveDataConfig<T> = PropsConfig<T> | SnapshotConfig<T> | SseConfig<T>;

type PropsResult<T> = { data: T; error: ""; loading: false; stale: false };
export type SnapshotResult<T> = { data: T | null; error: string; loading: boolean; stale: boolean };
type SseResult<T> = { data: T; error: string };

export function snapshotLiveResult<T>(current: SnapshotResult<T>, snapshot: {
  data: T | null;
  error: string;
  stale?: boolean;
  outcome: "initial" | "loading" | "accepted" | "unchanged" | "rejected" | "missing";
}): SnapshotResult<T> {
  if (snapshot.outcome === "initial") return current;
  if (snapshot.outcome === "loading") return { ...current, error: "", loading: true, stale: snapshot.stale ?? current.data !== null };
  if (snapshot.outcome === "rejected") return { ...current, error: snapshot.error, loading: false, stale: current.data !== null };
  if (snapshot.outcome === "missing") return { data: null, error: snapshot.error, loading: false, stale: false };
  return { data: snapshot.data, error: "", loading: false, stale: false };
}

export function useOvenLiveData<T>(config: PropsConfig<T>): PropsResult<T>;
export function useOvenLiveData<T>(config: SnapshotConfig<T>): SnapshotResult<T>;
export function useOvenLiveData<T>(config: SseConfig<T>): SseResult<T>;
export function useOvenLiveData<T>(config: OvenLiveDataConfig<T>) {
  if (config.transport === "props") {
    return { data: config.data, error: "", loading: false, stale: false };
  }

  if (config.transport === "snapshot") {
    const [state, setState] = useState<SnapshotResult<T>>({
      data: config.initialData ?? null,
      error: "",
      loading: true,
      stale: false,
    });

    useEffect(() => {
      if (config.enabled === false) {
        setState({ data: config.initialData ?? null, error: "", loading: false, stale: false });
        return undefined;
      }
      setState((current) => ({ ...current, error: "", loading: true, stale: current.data !== null }));
      const subscription = browserOvenSnapshotClient.subscribe({
        repoKey: config.repoKey,
        ovenId: config.ovenId,
        subjectId: config.subjectId ?? null,
        query: config.query,
        url: config.makeUrl(),
        receive: config.receive,
        fallbackError: config.fallbackError,
        fallbackMs: config.fallbackMs,
        initialData: config.initialData ?? null,
        events: config.events,
      }, (snapshot) => setState((current) => snapshotLiveResult(current, snapshot)));
      return () => subscription.unsubscribe();
    }, config.deps ?? []);

    return state;
  }

  const [state, setState] = useState<SseResult<T>>({ data: config.initialData, error: "" });

  useEffect(() => {
    const url = config.makeUrl();
    if (url == null) {
      setState({ data: config.initialData, error: "" });
      return undefined;
    }
    setState({ data: config.initialData, error: "" });
    const stop = createSseTransport({ makeUrl: () => url }).start({
      onReset: () => setState((current) => ({ ...current, data: config.applyReset(current.data) })),
      onOpen: () => setState((current) => ({ ...current, error: "" })),
      onMessage: (raw) => setState((current) => {
        try {
          return { ...current, data: config.applyMessage(current.data, raw) };
        } catch {
          return { ...current, error: config.invalidError };
        }
      }),
      onError: () => setState((current) => ({ ...current, error: config.disconnectError })),
    });
    return stop;
  }, config.deps ?? []);

  return state;
}
