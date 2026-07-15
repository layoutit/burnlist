import assert from "node:assert/strict";
import test from "node:test";
import { applyStreamingDiffUpdate, fileKindChip, groupStreamingDiffCard, mapStreamingDiffFeeds, mapStreamingDiffLandingFeeds, streamingDiffAutoOpenHref, streamingDiffRepositories } from "./streaming-diff.mjs";

const first = { revId: "r-first", toolUseId: "tool-first", ts: "2026-07-15T10:00:00.000Z", status: "captured", files: [] };
const second = { revId: "r-second", toolUseId: "tool-second", ts: "2026-07-15T10:01:00.000Z", status: "partial", partialReason: "bounded", files: [] };

test("recent feed mapping sorts published activity and creates session deep links", () => {
  const feeds = mapStreamingDiffFeeds({
    feeds: [
      { identity: { logicalRepoKey: "aaaaaaaaaaaa", worktreeKey: "111111111111", session: "older session" }, updatedAt: "2026-07-15T10:00:00.000Z" },
      { identity: { logicalRepoKey: "aaaaaaaaaaaa", worktreeKey: "222222222222", session: "newer" }, updatedAt: "2026-07-15T10:01:00.000Z" },
    ],
  });

  assert.deepEqual(feeds.map((feed) => feed.identity.session), ["newer", "older session"]);
  assert.equal(feeds[1].href, "/ovens/streaming-diff/view?repoKey=aaaaaaaaaaaa&worktreeKey=111111111111&session=older+session");
});

test("landing derives repositories and aggregates their feeds by recent activity", () => {
  const repositories = streamingDiffRepositories([
    { repoKey: "aaaaaaaaaaaa", displayName: "alpha" },
    { repoKey: "bbbbbbbbbbbb", displayName: "beta" },
    { repoKey: "aaaaaaaaaaaa", displayName: "duplicate" },
    { repoKey: null, displayName: "Ungrouped" },
  ]);
  const feeds = mapStreamingDiffLandingFeeds([
    { repository: repositories[0], payload: { feeds: [{ identity: { logicalRepoKey: "aaaaaaaaaaaa", worktreeKey: "111111111111", session: "alpha-feed" }, updatedAt: "2026-07-15T10:00:00.000Z" }] } },
    { repository: repositories[1], payload: { feeds: [{ identity: { logicalRepoKey: "bbbbbbbbbbbb", worktreeKey: "222222222222", session: "beta-feed" }, updatedAt: "2026-07-15T10:01:00.000Z" }] } },
  ]);

  assert.deepEqual(repositories, [{ repoKey: "aaaaaaaaaaaa", label: "alpha" }, { repoKey: "bbbbbbbbbbbb", label: "beta" }]);
  assert.deepEqual(feeds.map((feed) => [feed.repoLabel, feed.identity.session]), [["beta", "beta-feed"], ["alpha", "alpha-feed"]]);
  assert.equal(streamingDiffAutoOpenHref(feeds), null);
  assert.equal(streamingDiffAutoOpenHref([feeds[0]]), feeds[0].href);
});

test("revision grouping replaces a repeated revision without changing manifest order", () => {
  const replacement = { ...first, status: "partial", partialReason: "replayed" };
  const cards = groupStreamingDiffCard(groupStreamingDiffCard([], first), second);
  assert.deepEqual(groupStreamingDiffCard(cards, replacement), [replacement, second]);
});

test("a terminal card supersedes its same-tool pre-hook attempt even with a new revision", () => {
  const attempt = { ...first, status: "partial", partialReason: "attempt in progress", files: [] };
  const terminal = { ...first, revId: "r-terminal", status: "captured", files: [{ path: "done.txt", kind: "modified", diff: "" }] };
  const cards = groupStreamingDiffCard(groupStreamingDiffCard([], attempt), second);

  assert.deepEqual(groupStreamingDiffCard(cards, terminal), [terminal, second]);
  assert.equal(groupStreamingDiffCard(cards, terminal).filter((card) => card.toolUseId === first.toolUseId).length, 1);
});

test("a reset clears retained cards before the server replays them", () => {
  assert.deepEqual(applyStreamingDiffUpdate([first, second], { type: "reset" }), []);
  assert.deepEqual(applyStreamingDiffUpdate([], { type: "card", card: first }), [first]);
});

test("only metadata-only file kinds get compact chips", () => {
  assert.equal(fileKindChip("modified"), null);
  assert.equal(fileKindChip("binary"), "binary");
  assert.equal(fileKindChip("redacted"), "redacted");
  assert.equal(fileKindChip("unavailable"), "unavailable");
});
