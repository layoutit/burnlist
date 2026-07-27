import { useCallback, useEffect, useRef } from "react";
import type { DataClient } from "./data-client";
import type { LandingSnapshot } from "./types";

type SetState<T> = (value: T | ((current: T) => T)) => void;

/** Owns one landing request generation so stale refreshes cannot commit. */
export function useLandingRefresh({
  client,
  setLanding,
  setLoading,
  setError,
}: {
  client: DataClient;
  setLanding: SetState<LandingSnapshot>;
  setLoading: SetState<boolean>;
  setError: SetState<string | null>;
}) {
  const request = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const loadLanding = useCallback(async () => {
    request.current.controller?.abort();
    const controller = new AbortController();
    const generation = request.current.generation + 1;
    request.current = { generation, controller };
    const owns = () => request.current.generation === generation && !controller.signal.aborted;
    setLoading(true);
    setError(null);
    try {
      const landing = await client.landing(controller.signal);
      if (owns()) setLanding(landing);
    } catch (cause) {
      if (owns()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (owns()) setLoading(false);
    }
  }, [client, setError, setLanding, setLoading]);
  useEffect(() => () => request.current.controller?.abort(), []);
  return loadLanding;
}
