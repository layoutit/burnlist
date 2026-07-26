import { useEffect, useState } from "react";
import { mapAgentMonitorLandingFeeds, parseAgentMonitorSnapshot } from "@lib";
import type { AgentMonitorFeed, AgentMonitorPayload } from "@lib";
import { useOvenLiveData } from "@oven";

type FeedState = { feeds: AgentMonitorFeed[]; error: string; loading: boolean };
type Selection = { repoKey: string; worktreeKey: string; session: string } | null;
type Repository = { repoKey: string; label: string };

export function useAgentMonitorFeeds(
  repositories: Repository[],
  discoveryLoading: boolean,
  selected: boolean,
): FeedState {
  const [state, setState] = useState<FeedState>({ feeds: [], error: "", loading: !selected });

  useEffect(() => {
    if (selected) return;
    if (discoveryLoading) {
      setState({ feeds: [], error: "", loading: true });
      return;
    }
    if (!repositories.length) {
      setState({ feeds: [], error: "", loading: false });
      return;
    }
    let cancelled = false;
    setState({ feeds: [], error: "", loading: true });
    void Promise.allSettled(repositories.map(async (repository) => {
      const query = new URLSearchParams({ list: "", repoKey: repository.repoKey });
      const response = await fetch(`/api/oven-data/agent-monitor?${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load recent thread feeds.");
      return { repository, payload };
    })).then((results) => {
      const successful = results
        .filter((result): result is PromiseFulfilledResult<{ repository: Repository; payload: unknown }> => result.status === "fulfilled")
        .map((result) => result.value);
      if (!successful.length) {
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        throw failure?.reason ?? new Error("Could not load recent thread feeds.");
      }
      if (!cancelled) setState({
        feeds: mapAgentMonitorLandingFeeds(successful),
        error: "",
        loading: false,
      });
    }).catch((cause) => {
      if (!cancelled) setState({
        feeds: [],
        error: cause instanceof Error ? cause.message : "Could not load recent thread feeds.",
        loading: false,
      });
    });
    return () => { cancelled = true; };
  }, [discoveryLoading, repositories, selected]);

  return state;
}

export function useAgentMonitorSnapshot(selection: Selection) {
  const query = selection ? new URLSearchParams(selection).toString() : "";
  return useOvenLiveData<AgentMonitorPayload>({
    transport: "snapshot",
    enabled: Boolean(selection),
    repoKey: selection?.repoKey ?? null,
    ovenId: "agent-monitor",
    subjectId: selection?.session ?? null,
    query,
    makeUrl: () => `/api/oven-data/agent-monitor?${query}`,
    receive(response, json) {
      if (!response.ok) {
        const message = json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
          ? String((json as { error: string }).error)
          : "Could not load the selected thread.";
        throw new Error(message);
      }
      const payload = parseAgentMonitorSnapshot(json, selection);
      if (!payload) throw new Error("Received an invalid Agent Monitor snapshot.");
      return payload as AgentMonitorPayload;
    },
    fallbackError: "Could not load the selected thread.",
    deps: [selection?.repoKey, selection?.worktreeKey, selection?.session],
  });
}
