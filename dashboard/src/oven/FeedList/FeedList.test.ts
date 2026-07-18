import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedList } from "./FeedList";

const heading = "<section class=\"streaming-diff-view\"><header class=\"streaming-diff-heading\"><h1>Streaming Diff</h1><p>Recent feeds are ordered by published activity time, not process liveness.</p></header>";

test("FeedList preserves the loading state", () => {
  assert.equal(renderToStaticMarkup(createElement(FeedList, { feeds: [], error: "", loading: true, showRepository: false })), `${heading}<p class="streaming-diff-message">Loading recent feeds.</p></section>`);
});

test("FeedList preserves the error state", () => {
  assert.equal(renderToStaticMarkup(createElement(FeedList, { feeds: [], error: "Feed unavailable.", loading: false, showRepository: false })), `${heading}<p class="streaming-diff-message is-error">Feed unavailable.</p></section>`);
});

test("FeedList preserves the empty state", () => {
  assert.equal(renderToStaticMarkup(createElement(FeedList, { feeds: [], error: "", loading: false, showRepository: false })), `${heading}<p class="streaming-diff-message">No recent feeds.</p></section>`);
});

test("FeedList preserves repository details when requested", () => {
  const feed = {
    identity: { logicalRepoKey: "repo-key", worktreeKey: "worktree-1", session: "session-1" },
    updatedAt: "2026-07-18T13:14:15.000Z", href: "/ovens/streaming-diff/view?session=session-1", repoLabel: "Example repository",
  };
  const timestamp = new Date(feed.updatedAt).toLocaleString();
  const markup = renderToStaticMarkup(createElement(FeedList, { feeds: [feed], error: "", loading: false, showRepository: true }));

  assert.equal(markup, `${heading}<div class="streaming-diff-feed-list"><a class="streaming-diff-feed" href="${feed.href}"><span class="streaming-diff-feed-session">session-1</span><span class="streaming-diff-feed-worktree">repository Example repository</span><span class="streaming-diff-feed-worktree">worktree worktree-1</span><time class="streaming-diff-feed-time" dateTime="${feed.updatedAt}">${timestamp}</time></a></div></section>`);
});

test("FeedList omits repository details when not requested", () => {
  const feed = {
    identity: { logicalRepoKey: "repo-key", worktreeKey: "worktree-1", session: "session-1" },
    updatedAt: "2026-07-18T13:14:15.000Z", href: "/ovens/streaming-diff/view?session=session-1", repoLabel: "Example repository",
  };
  const markup = renderToStaticMarkup(createElement(FeedList, { feeds: [feed], error: "", loading: false, showRepository: false }));

  assert.equal(markup, `${heading}<div class="streaming-diff-feed-list"><a class="streaming-diff-feed" href="${feed.href}"><span class="streaming-diff-feed-session">session-1</span><span class="streaming-diff-feed-worktree">worktree worktree-1</span><time class="streaming-diff-feed-time" dateTime="${feed.updatedAt}">${new Date(feed.updatedAt).toLocaleString()}</time></a></div></section>`);
  assert.doesNotMatch(markup, /repository Example repository/u);
});
