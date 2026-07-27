import { useEffect } from "react";
import type { DataClient } from "./data-client";

export function useAgentMonitorLease({
  active,
  client,
  repoKey,
  token,
}: {
  active: boolean;
  client: DataClient;
  repoKey: string | null | undefined;
  token: string | undefined;
}) {
  useEffect(() => {
    if (!active || !repoKey || !token) return;
    const controller = new AbortController();
    const renew = () => { void client.activateAgentMonitor(repoKey, token, controller.signal).catch(() => {}); };
    renew();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        renew();
        if (!controller.signal.aborted) schedule();
      }, 15_000);
    };
    schedule();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, client, repoKey, token]);
}
