import { streamingDiffFeedKey } from "@lib";
import type { StreamingDiffFeed } from "@lib";
import { timestamp } from "../utils/streaming-diff-time";

export function FeedList({ feeds, error, loading, showRepository }: { feeds: StreamingDiffFeed[]; error: string; loading: boolean; showRepository: boolean }) {
  return (
    <section className="streaming-diff-view">
      <header className="streaming-diff-heading">
        <h1>Streaming Diff</h1>
        <p>Recent feeds are ordered by published activity time, not process liveness.</p>
      </header>
      {error ? <p className="streaming-diff-message is-error">{error}</p> : loading ? <p className="streaming-diff-message">Loading recent feeds.</p> : !feeds.length ? <p className="streaming-diff-message">No recent feeds.</p> : (
        <div className="streaming-diff-feed-list">
          {feeds.map((feed) => (
            <a className="streaming-diff-feed" href={feed.href} key={streamingDiffFeedKey(feed)}>
              <span className="streaming-diff-feed-session">{feed.identity.session}</span>
              {showRepository && <span className="streaming-diff-feed-worktree">repository {feed.repoLabel}</span>}
              <span className="streaming-diff-feed-worktree">worktree {feed.identity.worktreeKey}</span>
              <time className="streaming-diff-feed-time" dateTime={feed.updatedAt ?? undefined}>{timestamp(feed.updatedAt)}</time>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
