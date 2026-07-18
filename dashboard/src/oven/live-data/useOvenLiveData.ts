import { useEffect, useRef, useState, type DependencyList } from "react";
import { createPollTransport, createSseTransport } from "./transports.js";

type PropsConfig<T> = { transport: "props"; data: T };

type PollConfig<T> = {
  transport: "poll";
  makeUrl: () => string;
  intervalMs: number;
  receive: (response: Response, json: unknown) => T;
  fallbackError: string;
  initialData?: T | null;
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

export type OvenLiveDataConfig<T> = PropsConfig<T> | PollConfig<T> | SseConfig<T>;

type PropsResult<T> = { data: T; error: ""; loading: false };
type PollResult<T> = { data: T | null; error: string; loading: boolean };
type SseResult<T> = { data: T; error: string };

export function useOvenLiveData<T>(config: PropsConfig<T>): PropsResult<T>;
export function useOvenLiveData<T>(config: PollConfig<T>): PollResult<T>;
export function useOvenLiveData<T>(config: SseConfig<T>): SseResult<T>;
export function useOvenLiveData<T>(config: OvenLiveDataConfig<T>) {
  if (config.transport === "props") {
    return { data: config.data, error: "", loading: false };
  }

  if (config.transport === "poll") {
    const [state, setState] = useState<PollResult<T>>({
      data: config.initialData ?? null,
      error: "",
      loading: true,
    });
    const inFlightRef = useRef(false);

    useEffect(() => {
      const stop = createPollTransport({
        makeUrl: config.makeUrl,
        intervalMs: config.intervalMs,
        receive: config.receive,
        fallbackError: config.fallbackError,
        inFlightRef,
      }).start({
        onData: (data) => setState((current) => ({ ...current, data, error: "" })),
        onError: (error) => setState((current) => ({ ...current, error })),
        onSettled: () => setState((current) => ({ ...current, loading: false })),
      });
      return stop;
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
