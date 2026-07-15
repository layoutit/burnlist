import { useEffect, useMemo } from "react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@layout";
import { useStreamingDiffCards, useStreamingDiffFeeds } from "@hooks";
import { ovenRepoKey, streamingDiffAutoOpenHref, streamingDiffRepositories, streamingDiffSelection } from "@lib";
import { fileKindChip, isTextFileKind } from "@lib";
import type { Project, StreamingDiffCard, StreamingDiffFeed, StreamingDiffFile } from "@lib";
import "../../../../ovens/streaming-diff/renderer/streaming-diff.css";

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value ?? "Unknown activity time";
}

function FeedList({ feeds, error, loading, showRepository }: { feeds: StreamingDiffFeed[]; error: string; loading: boolean; showRepository: boolean }) {
  return (
    <section className="streaming-diff-view">
      <header className="streaming-diff-heading">
        <h1>Streaming Diff</h1>
        <p>Recent feeds are ordered by published activity time, not process liveness.</p>
      </header>
      {error ? <p className="streaming-diff-message is-error">{error}</p> : loading ? <p className="streaming-diff-message">Loading recent feeds.</p> : !feeds.length ? <p className="streaming-diff-message">No recent feeds.</p> : (
        <div className="streaming-diff-feed-list">
          {feeds.map((feed) => (
            <a className="streaming-diff-feed" href={feed.href} key={`${feed.identity.worktreeKey}/${feed.identity.session}`}>
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

function FileDiff({ file }: { file: StreamingDiffFile }) {
  const chip = fileKindChip(file.kind);
  if (chip) {
    return <section className="streaming-diff-file">
      <div className="streaming-diff-file-head"><code>{file.path}</code><Badge variant="outline">{chip}</Badge></div>
      {(file.meta?.reason || file.meta?.bytes !== undefined) && <p className="streaming-diff-file-meta">{file.meta?.reason}{file.meta?.reason && file.meta?.bytes !== undefined ? " · " : ""}{file.meta?.bytes !== undefined ? `${file.meta.bytes} bytes` : ""}</p>}
    </section>;
  }
  return <section className="streaming-diff-file">
    <div className="streaming-diff-file-head"><code>{file.path}</code><Badge variant="secondary">{file.kind}</Badge></div>
    {isTextFileKind(file.kind) && file.diff ? <pre className="streaming-diff-unified">{file.diff}</pre> : <p className="streaming-diff-file-meta">Diff content is unavailable.</p>}
  </section>;
}

function DiffCard({ card }: { card: StreamingDiffCard }) {
  const partial = card.status === "partial";
  return <Card className="streaming-diff-card">
    <CardHeader className="streaming-diff-card-header">
      <div>
        <CardTitle>{card.toolUseId}</CardTitle>
        <CardDescription><time dateTime={card.ts}>{timestamp(card.ts)}</time> · {card.revId}</CardDescription>
      </div>
      <Badge variant={partial ? "destructive" : "default"}>{card.status}</Badge>
    </CardHeader>
    <CardContent className="streaming-diff-card-content">
      {partial && <p className="streaming-diff-partial">{card.partialReason ?? "This revision is partial."}</p>}
      {card.files.length ? card.files.map((file) => <FileDiff file={file} key={file.path} />) : <p className="streaming-diff-file-meta">No file content was captured.</p>}
    </CardContent>
  </Card>;
}

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
