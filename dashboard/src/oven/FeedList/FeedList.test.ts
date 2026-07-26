import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedList } from "./FeedList";

const heading = "<section class=\"session-feed-view\"><header class=\"session-feed-heading\"><h1>Streaming Diff</h1><p>Recent feeds are ordered by published activity time, not process liveness.</p></header>";

test("FeedList preserves the loading state", () => {
  assert.equal(renderToStaticMarkup(createElement(FeedList, { feeds: [], error: "", loading: true, showRepository: false })), `${heading}<p class="session-feed-message">Loading recent feeds.</p></section>`);
});

test("FeedList preserves the error state", () => {
  assert.equal(renderToStaticMarkup(createElement(FeedList, { feeds: [], error: "Feed unavailable.", loading: false, showRepository: false })), `${heading}<p class="session-feed-message is-error">Feed unavailable.</p></section>`);
});

test("FeedList preserves the empty state", () => {
  assert.equal(renderToStaticMarkup(createElement(FeedList, { feeds: [], error: "", loading: false, showRepository: false })), `${heading}<p class="session-feed-message">No recent feeds.</p></section>`);
});

test("FeedList preserves repository details when requested", () => {
  const feed = {
    identity: { logicalRepoKey: "repo-key", worktreeKey: "worktree-1", session: "session-1" },
    updatedAt: "2026-07-18T13:14:15.000Z", href: "/r/repo-key/o/streaming-diff?worktreeKey=worktree-1&session=session-1", repoLabel: "Example repository",
  };
  const timestamp = new Date(feed.updatedAt).toLocaleString();
  const markup = renderToStaticMarkup(createElement(FeedList, { feeds: [feed], error: "", loading: false, showRepository: true }));

  assert.equal(markup, `${heading}<div class="session-feed-list"><a class="session-feed" href="${feed.href.replace("&", "&amp;")}"><span class="session-feed-session">session-1</span><span class="session-feed-worktree">repository Example repository</span><span class="session-feed-worktree">worktree worktree-1</span><time class="session-feed-time" dateTime="${feed.updatedAt}">${timestamp}</time></a></div></section>`);
});

test("FeedList omits repository details when not requested", () => {
  const feed = {
    identity: { logicalRepoKey: "repo-key", worktreeKey: "worktree-1", session: "session-1" },
    updatedAt: "2026-07-18T13:14:15.000Z", href: "/r/repo-key/o/streaming-diff?worktreeKey=worktree-1&session=session-1", repoLabel: "Example repository",
  };
  const markup = renderToStaticMarkup(createElement(FeedList, { feeds: [feed], error: "", loading: false, showRepository: false }));

  assert.equal(markup, `${heading}<div class="session-feed-list"><a class="session-feed" href="${feed.href.replace("&", "&amp;")}"><span class="session-feed-session">session-1</span><span class="session-feed-worktree">worktree worktree-1</span><time class="session-feed-time" dateTime="${feed.updatedAt}">${new Date(feed.updatedAt).toLocaleString()}</time></a></div></section>`);
  assert.doesNotMatch(markup, /repository Example repository/u);
});

test("FeedList accepts Agent Monitor copy without a renderer fork", () => {
  const markup = renderToStaticMarkup(createElement(FeedList, {
    feeds: [],
    error: "",
    loading: false,
    showRepository: false,
    title: "Agent Monitor",
    description: "Exact Codex sessions.",
    emptyText: "No threads.",
  }));
  assert.equal(markup, "<section class=\"session-feed-view\"><header class=\"session-feed-heading\"><h1>Agent Monitor</h1><p>Exact Codex sessions.</p></header><p class=\"session-feed-message\">No threads.</p></section>");
});

test("FeedList renders Agent Monitor state summaries without exposing full session ids", () => {
  const feed = {
    identity: { logicalRepoKey: "repo-key", worktreeKey: "worktree-1", session: "session-private" },
    updatedAt: "2026-07-18T13:14:15.000Z",
    href: "/agent-monitor",
    title: "Live · COMMAND · line 42",
    detail: "Thread …private · 42 events",
    state: "Live" as const,
  };
  const markup = renderToStaticMarkup(createElement(FeedList, {
    feeds: [feed],
    error: "",
    loading: false,
    showRepository: false,
    title: "Agent Monitor",
  }));
  assert.match(markup, /data-state="Live"/u);
  assert.match(markup, /Live · COMMAND · line 42/u);
  assert.match(markup, /Thread …private · 42 events/u);
  assert.doesNotMatch(markup, />session-private</u);
});
