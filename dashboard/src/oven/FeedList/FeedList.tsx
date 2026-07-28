import { timestamp } from "../utils/streaming-diff-time";
import "./feed-list.css";

type SessionFeed = {
  identity: { logicalRepoKey: string; worktreeKey: string; session: string };
  updatedAt: string | null;
  href: string;
  repoLabel?: string;
  title?: string;
  detail?: string;
  state?: "Live" | "Idle" | null;
};

function feedKey(feed: SessionFeed) {
  return `${feed.identity.logicalRepoKey}/${feed.identity.worktreeKey}/${feed.identity.session}`;
}

export function FeedList({
  feeds,
  error,
  loading,
  showRepository,
  title = "Streaming Diff",
  description = "Recent feeds are ordered by published activity time, not process liveness.",
  loadingText = "Loading recent feeds.",
  emptyText = "No recent feeds.",
}: {
  feeds: SessionFeed[];
  error: string;
  loading: boolean;
  showRepository: boolean;
  title?: string;
  description?: string;
  loadingText?: string;
  emptyText?: string;
}) {
  return (
    <section className="session-feed-view">
      <header className="session-feed-heading">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {error ? <p className="session-feed-message is-error">{error}</p> : loading ? <p className="session-feed-message">{loadingText}</p> : !feeds.length ? <p className="session-feed-message">{emptyText}</p> : (
        <div className="session-feed-list">
          {feeds.map((feed) => (
            <a className="session-feed" data-state={feed.state ?? undefined} href={feed.href} key={feedKey(feed)}>
              <span className="session-feed-session">{feed.title ?? feed.identity.session}</span>
              {feed.detail && <span className="session-feed-detail">{feed.detail}</span>}
              {showRepository && <span className="session-feed-worktree">repository {feed.repoLabel}</span>}
              <span className="session-feed-worktree">worktree {feed.identity.worktreeKey}</span>
              <time className="session-feed-time" dateTime={feed.updatedAt ?? undefined}>{timestamp(feed.updatedAt)}</time>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
