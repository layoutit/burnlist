import { useCallback, useRef, useState } from "react";
import type { DataClient } from "./data-client";
import {
  agentMonitorFeedKey,
  agentMonitorFeedLabel,
  agentMonitorFeedQuery,
  moveAgentMonitorFeed,
  selectAgentMonitorFeed,
  type AgentMonitorNavigation,
} from "./agent-monitor-navigation";

export function useAgentMonitorNavigation(client: DataClient) {
  const [navigation, setNavigation] = useState<AgentMonitorNavigation | null>(null);
  const retainedFeed = useRef<string | null>(null);

  const clear = useCallback(() => setNavigation(null), []);

  const load = useCallback(async (
    repoKey: string | null,
    token: string | undefined,
    signal: AbortSignal,
  ) => {
    if (!repoKey) throw new Error("Agent Monitor requires a repository identity.");
    if (token) await client.activateAgentMonitor(repoKey, token, signal);
    const feeds = await client.agentMonitorFeeds(repoKey, signal);
    const next = selectAgentMonitorFeed(feeds, retainedFeed.current);
    const query = agentMonitorFeedQuery(next);
    if (!query) throw new Error("Agent Monitor has not observed a session in this repository yet.");
    retainedFeed.current = agentMonitorFeedKey(next.feeds[next.selected]!);
    setNavigation(next);
    return query;
  }, [client]);

  const move = useCallback((direction: -1 | 1, selected: () => void) => {
    if (!navigation) return false;
    const next = moveAgentMonitorFeed(navigation, direction);
    const feed = next.feeds[next.selected];
    if (!feed || next === navigation) return true;
    retainedFeed.current = agentMonitorFeedKey(feed);
    setNavigation(next);
    selected();
    return true;
  }, [navigation]);

  return {
    label: navigation ? agentMonitorFeedLabel(navigation) : null,
    clear,
    load,
    move,
  };
}
