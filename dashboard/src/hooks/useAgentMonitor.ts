import { useEffect, useState } from "react";
import { mapAgentMonitorLandingFeeds, parseAgentMonitorSnapshot } from "@lib";
import type { AgentMonitorFeed, AgentMonitorPayload } from "@lib";
import { useOvenLiveData } from "@oven";

type FeedState = { feeds: AgentMonitorFeed[]; error: string; loading: boolean };
type ActivationState = { error: string; loading: boolean };
type Selection = { repoKey: string; worktreeKey: string; session: string } | null;
type Repository = { repoKey: string; label: string };

export function useAgentMonitorActivation(repositories: Repository[]): ActivationState {
  const keys = repositories.map((repository) => repository.repoKey).join(",");
  const [state, setState] = useState<ActivationState>({ error: "", loading: Boolean(keys) });

  useEffect(() => {
    if (!keys) {
      setState({ error: "", loading: false });
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const repoKeys = keys.split(",");
    void (async () => {
      const inventory = await fetch("/api/ovens", {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const payload = await inventory.json();
      const token = typeof payload?.writeToken === "string" ? payload.writeToken : "";
      if (!inventory.ok || !token) throw new Error(payload?.error ?? "Agent Monitor activation is unavailable.");
      const activate = async () => {
        const responses = await Promise.all(repoKeys.map((repoKey) => fetch(
          `/api/service/agent-monitor/activate?${new URLSearchParams({ repoKey })}`,
          { method: "POST", headers: { "x-burnlist-token": token }, signal: controller.signal },
        )));
        const rejected = responses.find((response) => !response.ok);
        if (rejected) {
          const failure = await rejected.json().catch(() => null);
          throw new Error(failure?.error ?? "Could not activate Agent Monitor.");
        }
      };
      await activate();
      if (!controller.signal.aborted) {
        setState({ error: "", loading: false });
        const renew = () => {
          timer = setTimeout(() => {
            void activate().catch(() => {}).finally(() => {
              if (!controller.signal.aborted) renew();
            });
          }, 15_000);
        };
        renew();
      }
    })().catch((cause) => {
      if (!controller.signal.aborted) setState({
        error: cause instanceof Error ? cause.message : "Could not activate Agent Monitor.",
        loading: false,
      });
    });
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [keys]);

  return state;
}

export function useAgentMonitorFeeds(
  repositories: Repository[],
  discoveryLoading: boolean,
  selected: boolean,
): FeedState {
  const [state, setState] = useState<FeedState>({ feeds: [], error: "", loading: !selected });
  const repositoryKey = repositories
    .map((repository) => `${repository.repoKey}\0${repository.label}`)
    .join("\0");

  useEffect(() => {
    if (selected) return;
    if (discoveryLoading) {
      setState((current) => ({ ...current, error: "", loading: true }));
      return;
    }
    if (!repositories.length) {
      setState({ feeds: [], error: "", loading: false });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, error: "", loading: true }));
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
  }, [discoveryLoading, repositoryKey, selected]);

  return state;
}

export function useAgentMonitorSnapshot(selection: Selection, aggregate = false) {
  const query = selection ? new URLSearchParams({
    ...(aggregate ? { aggregate: "" } : {}),
    repoKey: selection.repoKey,
    worktreeKey: selection.worktreeKey,
    session: selection.session,
  }).toString() : "";
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
