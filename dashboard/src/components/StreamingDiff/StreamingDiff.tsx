import { useEffect, useMemo } from "react";
import { useStreamingDiffCards, useStreamingDiffFeeds } from "@hooks";
import { DiffCard, FeedList } from "@oven";
import { ovenRepoKey, streamingDiffAutoOpenHref, streamingDiffRepositories, streamingDiffSelection } from "@lib";
import type { Project, StreamingDiffCard } from "@lib";
import "./streaming-diff.css";

function SelectedFeed({ cards, error, session }: { cards: StreamingDiffCard[]; error: string; session: string }) {
  return <section className="streaming-diff-view">
    <header className="streaming-diff-heading">
      <a className="streaming-diff-back" href={`/ovens/streaming-diff/view?repoKey=${encodeURIComponent(ovenRepoKey() ?? "")}`}>Recent feeds</a>
      <h1>Streaming Diff</h1>
      <p>Session {session}</p>
    </header>
    {error && <p className="streaming-diff-message is-error">{error}</p>}
    <div className="streaming-diff-cards">{cards.map((card) => <DiffCard card={card} key={card.revId} />)}</div>
    {!cards.length && <p className="streaming-diff-message">Waiting for diff cards.</p>}
  </section>;
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

  return selection ? <SelectedFeed cards={cards.cards} error={cards.error} session={selection.session} /> : <FeedList {...feeds} showRepository={!repoKey && repositories.length > 1} />;
}
