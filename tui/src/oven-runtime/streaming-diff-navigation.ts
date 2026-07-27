// The console's routes are browser URLs. This module keeps the same selection
// semantics while expressing the terminal equivalent as explicit focus actions.
// @ts-expect-error Canonical console navigation helpers are JavaScript.
import { streamingDiffAutoOpenHref, streamingDiffFeedKey } from "../../../dashboard/src/lib/streaming-diff.mjs";

export type StreamingFeed = Readonly<{
  identity: Readonly<{ logicalRepoKey: string; worktreeKey: string; session: string }>;
  updatedAt: string | null;
  href: string;
  repoLabel?: string;
}>;
export type StreamingDiffNavigation = Readonly<{
  page: "feeds" | "session";
  feeds: readonly StreamingFeed[];
  selectedFeed: number;
  selectedCard: number;
  selectedFile: number;
  expandedFile: string | null;
  session: StreamingFeed | null;
  feedStatus: "ready" | "loading" | "error" | "empty";
  sessionError: string;
  restoreFocus: "oven-list" | "streaming-feeds";
}>;
export type StreamingDiffAction =
  | Readonly<{ type: "feedsLoaded"; feeds: readonly StreamingFeed[] }>
  | Readonly<{ type: "feedsFailed"; message: string }>
  | Readonly<{ type: "feedMoved"; direction: -1 | 1 }>
  | Readonly<{ type: "feedOpened" }>
  | Readonly<{ type: "cardMoved"; direction: -1 | 1; cardCount: number }>
  | Readonly<{ type: "cardsAccepted"; cardCount: number; previousCount: number }>
  | Readonly<{ type: "fileMoved"; direction: -1 | 1; fileCount: number }>
  | Readonly<{ type: "fileToggled"; key: string }>
  | Readonly<{ type: "sessionFailed"; message: string }>
  | Readonly<{ type: "refresh" }>
  | Readonly<{ type: "back" }>;

const clamp = (value: number, length: number) => Math.max(0, Math.min(value, Math.max(0, length - 1)));
const scoped = (feeds: readonly StreamingFeed[], repoKey?: string | null) => repoKey ? feeds.filter((feed) => feed.identity.logicalRepoKey === repoKey) : [...feeds];

export function initStreamingDiffNavigation(restoreFocus: StreamingDiffNavigation["restoreFocus"] = "oven-list"): StreamingDiffNavigation {
  return { page: "feeds", feeds: [], selectedFeed: 0, selectedCard: 0, selectedFile: 0, expandedFile: null, session: null, feedStatus: "loading", sessionError: "", restoreFocus };
}

/** Applies the console's list/one-feed routing rule without exposing URLs to the terminal UI. */
export function reduceStreamingDiffNavigation(state: StreamingDiffNavigation, action: StreamingDiffAction, repoKey?: string | null): StreamingDiffNavigation {
  if (action.type === "feedsLoaded") {
    const feeds = scoped(action.feeds, repoKey);
    const autoHref = streamingDiffAutoOpenHref(feeds);
    const session = autoHref ? feeds.find((feed) => feed.href === autoHref) ?? null : null;
    return { ...state, feeds, selectedFeed: clamp(state.selectedFeed, feeds.length), feedStatus: feeds.length ? "ready" : "empty", page: session ? "session" : "feeds", session, sessionError: "", selectedFile: 0, expandedFile: null };
  }
  if (action.type === "feedsFailed") return { ...state, feeds: [], feedStatus: "error", session: null, sessionError: action.message };
  if (action.type === "refresh") return state.page === "feeds" ? { ...state, feedStatus: "loading", sessionError: "" } : { ...state, sessionError: "" };
  if (action.type === "feedMoved" && state.page === "feeds") return { ...state, selectedFeed: clamp(state.selectedFeed + action.direction, state.feeds.length) };
  if (action.type === "feedOpened" && state.page === "feeds") {
    const session = state.feeds[state.selectedFeed] ?? null;
    return session ? { ...state, page: "session", session, selectedFile: 0, expandedFile: null, sessionError: "" } : state;
  }
  if (action.type === "cardMoved" && state.page === "session") return { ...state, selectedCard: clamp(state.selectedCard + action.direction, action.cardCount), selectedFile: 0, expandedFile: null };
  if (action.type === "cardsAccepted" && state.page === "session") return { ...state, selectedCard: state.selectedCard >= Math.max(0, action.previousCount - 1) ? Math.max(0, action.cardCount - 1) : clamp(state.selectedCard, action.cardCount), selectedFile: 0, expandedFile: null };
  if (action.type === "fileMoved" && state.page === "session") return { ...state, selectedFile: clamp(state.selectedFile + action.direction, action.fileCount) };
  if (action.type === "fileToggled" && state.page === "session") return { ...state, expandedFile: state.expandedFile === action.key ? null : action.key };
  if (action.type === "sessionFailed" && state.page === "session") return { ...state, sessionError: action.message };
  if (action.type === "back" && state.page === "session") return { ...state, page: "feeds", session: null, sessionError: "", selectedFile: 0, expandedFile: null, restoreFocus: "streaming-feeds" };
  return state;
}

/** Stable action labels are the cross-surface oracle consumed by correspondence tests. */
export function normalizeStreamingDiffTrace(state: StreamingDiffNavigation): readonly string[] {
  const selected = state.feeds[state.selectedFeed];
  return [
    `page:${state.page}`,
    `feeds:${state.feedStatus}:${state.feeds.map(streamingDiffFeedKey).join(",")}`,
    `selected:${selected ? streamingDiffFeedKey(selected) : ""}`,
    `session:${state.session ? streamingDiffFeedKey(state.session) : ""}`,
    `file:${state.selectedFile}:${state.expandedFile ?? ""}`,
    `error:${state.sessionError}`,
    `back-focus:${state.restoreFocus}`,
  ];
}
