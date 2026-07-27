import { expect, test } from "bun:test";
// @ts-expect-error Canonical console helpers intentionally remain JavaScript.
import { streamingDiffAutoOpenHref, streamingDiffFeedHref, streamingDiffFeedKey } from "../../../dashboard/src/lib/streaming-diff.mjs";
import { initStreamingDiffNavigation, normalizeStreamingDiffTrace, reduceStreamingDiffNavigation, type StreamingFeed } from "./streaming-diff-navigation";
import { streamingDiffModel } from "./components/streaming-diff-components";
// @ts-expect-error Production compiler intentionally remains JavaScript.
import { compileOven } from "../../../src/ovens/dsl/oven-compile.mjs";
import { readFileSync } from "node:fs";
import { afterEach, mock } from "bun:test";
import { createDataClient } from "../data-client";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function feed(repo: string, worktree: string, session: string, updatedAt: string): StreamingFeed {
  const identity = { logicalRepoKey: repo, worktreeKey: worktree, session };
  return { identity, updatedAt, href: streamingDiffFeedHref(identity), repoLabel: repo };
}

const first = feed("repo-a", "main", "run-a", "2026-07-24T10:00:00Z");
const second = feed("repo-a", "feature", "run-b", "2026-07-24T11:00:00Z");
const other = feed("repo-b", "main", "outside", "2026-07-24T12:00:00Z");

test("Streaming Diff terminal actions follow console feed selection, filtering, and auto-open rules", () => {
  expect(streamingDiffAutoOpenHref([first, second])).toBeNull();
  let state = reduceStreamingDiffNavigation(initStreamingDiffNavigation(), { type: "feedsLoaded", feeds: [first, second, other] }, "repo-a");
  expect(normalizeStreamingDiffTrace(state)).toEqual([
    "page:feeds", `feeds:ready:${streamingDiffFeedKey(first)},${streamingDiffFeedKey(second)}`,
    `selected:${streamingDiffFeedKey(first)}`, "session:", "file:0:", "error:", "back-focus:oven-list",
  ]);
  state = reduceStreamingDiffNavigation(state, { type: "feedMoved", direction: 1 }, "repo-a");
  state = reduceStreamingDiffNavigation(state, { type: "feedOpened" }, "repo-a");
  expect(state.session?.href).toBe(second.href);
  expect(state.page).toBe("session");
  expect(state.feeds.every((entry) => entry.identity.logicalRepoKey === "repo-a")).toBe(true);

  const automatic = reduceStreamingDiffNavigation(initStreamingDiffNavigation(), { type: "feedsLoaded", feeds: [first] }, "repo-a");
  expect(automatic.page).toBe("session");
  expect(automatic.session?.href).toBe(streamingDiffAutoOpenHref([first]));
});

test("Streaming Diff terminal trace preserves card hooks, failures, and terminal back/focus restoration", () => {
  let state = reduceStreamingDiffNavigation(initStreamingDiffNavigation(), { type: "feedsLoaded", feeds: [first] });
  state = reduceStreamingDiffNavigation(state, { type: "fileMoved", direction: 1, fileCount: 3 });
  state = reduceStreamingDiffNavigation(state, { type: "fileToggled", key: "r1:src/app.ts" });
  state = reduceStreamingDiffNavigation(state, { type: "sessionFailed", message: "stream disconnected" });
  expect(normalizeStreamingDiffTrace(state)).toContain("file:1:r1:src/app.ts");
  expect(normalizeStreamingDiffTrace(state)).toContain("error:stream disconnected");
  state = reduceStreamingDiffNavigation(state, { type: "refresh" });
  expect(state.sessionError).toBe("");
  state = reduceStreamingDiffNavigation(state, { type: "back" });
  expect(normalizeStreamingDiffTrace(state)).toContain("page:feeds");
  expect(normalizeStreamingDiffTrace(state)).toContain("back-focus:streaming-feeds");
  state = reduceStreamingDiffNavigation(state, { type: "feedsFailed", message: "Feed unavailable." });
  expect(normalizeStreamingDiffTrace(state)).toContain("feeds:error:");
});

test("current card defaults to latest, follows latest append, and preserves an older inspection", () => {
  let state = reduceStreamingDiffNavigation(initStreamingDiffNavigation(), { type: "feedsLoaded", feeds: [first] });
  state = reduceStreamingDiffNavigation(state, { type: "cardsAccepted", previousCount: 0, cardCount: 3 }); expect(state.selectedCard).toBe(2);
  state = reduceStreamingDiffNavigation(state, { type: "cardsAccepted", previousCount: 3, cardCount: 4 }); expect(state.selectedCard).toBe(3);
  state = reduceStreamingDiffNavigation(state, { type: "cardMoved", direction: -1, cardCount: 4 });
  state = reduceStreamingDiffNavigation(state, { type: "cardsAccepted", previousCount: 4, cardCount: 5 }); expect(state.selectedCard).toBe(2);
  state = reduceStreamingDiffNavigation(state, { type: "cardsAccepted", previousCount: 5, cardCount: 1 }); expect(state.selectedCard).toBe(0);
});

test("Streaming Diff model keeps partial, redacted, binary, and unavailable file states terminal-safe", () => {
  const source = readFileSync(new URL("../../../ovens/streaming-diff/streaming-diff.oven", import.meta.url), "utf8");
  const compiled = compileOven(source, { file: "streaming-diff.oven" });
  if (!compiled.ok) throw new Error("fixture did not compile");
  const model = streamingDiffModel(compiled.ir.root[1], {
    identity: { session: "run-a" }, cards: [{ toolUseId: "tool", revId: "r1", ts: "now", status: "partial", files: [
      { path: "partial.ts", kind: "modified", diff: "+safe" },
      { path: "secrets.env", kind: "redacted", diff: "SECRET", meta: { reason: "redacted", redacted: true } },
      { path: "asset.png", kind: "binary", diff: "BINARY", meta: { bytes: 12 } },
      { path: "gone.ts", kind: "unavailable", meta: { reason: "not captured" } },
    ] }],
  }, 0, 0, "r1:partial.ts");
  expect(model.cards[0]?.status).toBe("partial");
  expect(model.cards[0]?.files.map((file) => file.diff)).toEqual(["+safe", undefined, undefined, undefined]);
  expect(model.cards[0]?.files.map((file) => file.reason)).toEqual([undefined, "redacted", undefined, "not captured"]);
});

test("production client scopes list and session transport to the selected repository/worktree/session", async () => {
  const requests: string[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input); requests.push(url);
    if (url.includes("list=")) return Response.json({ feeds: [{ identity: first.identity, updatedAt: first.updatedAt }, { identity: other.identity, updatedAt: other.updatedAt }] });
    if (url.includes("session=run-b")) return Response.json({ identity: second.identity, cards: [{ toolUseId: "distinct-b", revId: "rev-b", ts: "now", status: "captured", files: [{ path: "two.ts", kind: "modified", diff: "+two" }] }] });
    return Response.json({ error: "wrong session" }, { status: 404 });
  }) as unknown as typeof fetch;
  const client = createDataClient("http://127.0.0.1:4815");
  const feeds = await client.streamingFeeds("repo-a");
  expect(feeds).toHaveLength(1);
  expect(feeds[0]?.identity.session).toBe("run-a");
  const snapshot = await client.streamingSession("repo-a", "feature", "run-b");
  expect((snapshot.payload as { identity: { session: string }; cards: Array<{ toolUseId: string }> }).identity.session).toBe("run-b");
  expect((snapshot.payload as { cards: Array<{ toolUseId: string }> }).cards[0]?.toolUseId).toBe("distinct-b");
  expect(requests[0]).toContain("repoKey=repo-a");
  expect(requests[1]).toContain("repoKey=repo-a"); expect(requests[1]).toContain("worktreeKey=feature"); expect(requests[1]).toContain("session=run-b");
});
