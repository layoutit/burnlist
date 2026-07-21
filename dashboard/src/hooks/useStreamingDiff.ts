import { useEffect, useState } from "react";
import { applyStreamingDiffUpdate, mapStreamingDiffLandingFeeds } from "@lib";
import type { StreamingDiffCard, StreamingDiffFeed } from "@lib";
import { useOvenLiveData } from "@oven";
import { applyStreamingDiffCardMessage } from "./streaming-diff-transport.mjs";

type FeedState = { feeds: StreamingDiffFeed[]; error: string; loading: boolean };
type CardState = { cards: StreamingDiffCard[]; error: string };
type Selection = { repoKey: string; worktreeKey: string; session: string } | null;
type Repository = { repoKey: string; label: string };

export function useStreamingDiffFeeds(repositories: Repository[], discoveryLoading: boolean, selected: boolean): FeedState {
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
      const params = new URLSearchParams({ list: "", repoKey: repository.repoKey });
      const response = await fetch(`/api/oven-data/streaming-diff?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load recent feeds.");
      return { repository, payload };
    })).then((results) => {
      const successful = results.filter((result): result is PromiseFulfilledResult<{ repository: Repository; payload: unknown }> => result.status === "fulfilled").map((result) => result.value);
      if (!successful.length) {
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        throw failure?.reason ?? new Error("Could not load recent feeds.");
      }
      if (!cancelled) setState({ feeds: mapStreamingDiffLandingFeeds(successful), error: "", loading: false });
    }).catch((cause) => {
      if (!cancelled) setState({ feeds: [], error: cause instanceof Error ? cause.message : "Could not load recent feeds.", loading: false });
    });
    return () => { cancelled = true; };
  }, [discoveryLoading, repositories, selected]);

  return state;
}

export function useStreamingDiffCards(selection: Selection): CardState {
  const { data, error } = useOvenLiveData<StreamingDiffCard[]>({
    transport: "sse",
    makeUrl: () => selection ? `/api/oven-data/streaming-diff?${new URLSearchParams(selection)}` : null,
    initialData: [],
    applyReset: (cards) => applyStreamingDiffUpdate(cards, { type: "reset" }),
    applyMessage: applyStreamingDiffCardMessage,
    invalidError: "Received an invalid Streaming Diff card.",
    disconnectError: "The stream disconnected; reconnecting.",
    deps: [selection?.repoKey, selection?.session, selection?.worktreeKey],
  });

  return { cards: data, error };
}
