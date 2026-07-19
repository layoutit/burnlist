import { useEffect, useMemo } from "react";
import { useStreamingDiffCards, useStreamingDiffFeeds } from "@hooks";
import { FeedList } from "@oven";
import { ovenRepoKey, streamingDiffAutoOpenHref, streamingDiffRepositories, streamingDiffSelection } from "@lib";
import type { Project, StreamingDiffCard } from "@lib";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import streamingDiffIr from "../../../../ovens/streaming-diff/streaming-diff.ir.json";
import "./streaming-diff.css";

export function SelectedFeed({ backHref, cards, error, session }: { backHref: string; cards: StreamingDiffCard[]; error: string; session: string }) {
  const payload = { identity: { session }, backHref, cards };
  return <>{error && <p className="streaming-diff-message is-error">{error}</p>}<OvenRuntime ir={streamingDiffIr} payload={payload} /></>;
}

export function StreamingDiff({ projects, projectsLoading }: { projects: Project[]; projectsLoading: boolean }) {
  const selection = streamingDiffSelection();
  const repoKey = ovenRepoKey();
  const repositories = useMemo(() => repoKey ? [{ repoKey, label: repoKey }] : streamingDiffRepositories(projects), [projects, repoKey]);
  const feeds = useStreamingDiffFeeds(repositories, projectsLoading, Boolean(selection));
  const cards = useStreamingDiffCards(selection);
  const autoOpenHref = streamingDiffAutoOpenHref(feeds.feeds);

  useEffect(() => {
    if (autoOpenHref) window.location.replace(autoOpenHref);
  }, [autoOpenHref]);

  return selection ? <SelectedFeed backHref={`/ovens/streaming-diff/view?repoKey=${encodeURIComponent(selection.repoKey)}`} cards={cards.cards} error={cards.error} session={selection.session} /> : <FeedList {...feeds} showRepository={!repoKey && repositories.length > 1} />;
}
