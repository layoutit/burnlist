import { opendirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { registerOvenHandler } from "../../../src/ovens/oven-registry.mjs";
import { containedJoin } from "../../../src/server/repo-state.mjs";
import { STREAMING_DIFF_FEED_VERSION, STREAMING_DIFF_OVEN_ID, identifierPathComponent, streamingDiffIdentifier } from "./streaming-diff-feed.mjs";
import { readJournal, readManifestPure, resolveReconnect } from "./streaming-diff-journal.mjs";

export const STREAMING_DIFF_SSE_DEFAULTS = Object.freeze({
  pollMs: 300, heartbeatMs: 15_000, maxGlobalSubscribers: 128, maxSubscribersPerFeed: 32,
});
// Listing reads at most this many session directories and manifest bytes; cards
// are deliberately never read until a specific feed is selected.
export const STREAMING_DIFF_LIST_LIMITS = Object.freeze({ maxFeedDirs: 128, maxBytes: 256 * 1024 });
const KEY_PATTERN = /^[a-f0-9]{12}$/u;
const SESSION_PATH_PATTERN = /^[a-f0-9]{32}$/u;
const SSE_WIRE_PREFIX = `${STREAMING_DIFF_FEED_VERSION}:`;
const subscribers = new Map();
let subscriberTotal = 0;

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status, streamingDiffPublic: true });
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function queryValue(url, name) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw httpError(`${name} must be supplied at most once`);
  return values[0] ?? null;
}

function listRepoKey(ctx) {
  const repoKey = queryValue(ctx.url, "repoKey");
  if (!KEY_PATTERN.test(repoKey ?? "")) {
    throw httpError("Streaming Diff list requires a lowercase 12-character hexadecimal repoKey");
  }
  return repoKey;
}

function feedRoot(ctx) {
  if (!ctx.binding?.repoRoot || !ctx.bindingPath) throw httpError("Streaming Diff requires a repository-scoped feed binding", 404);
  const expected = containedJoin(ctx.binding.repoRoot, "streaming-diff", STREAMING_DIFF_FEED_VERSION);
  let root;
  try {
    root = realpathSync(ctx.bindingPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw httpError("configured Streaming Diff feed root is missing", 404);
    throw error;
  }
  const canonicalExpected = realpathSync(expected);
  if (root !== canonicalExpected) {
    throw httpError("configured Streaming Diff feed root escapes its repository");
  }
  return { root, repoRoot: ctx.binding.repoRoot };
}

function verifyFeed(ctx, rootInfo, feed) {
  if (realpathSync(ctx.bindingPath) !== rootInfo.root) throw httpError("configured Streaming Diff feed root changed during read");
  let resolved;
  try {
    resolved = realpathSync(feed.path);
  } catch (error) {
    if (error?.code === "ENOENT") throw httpError("Streaming Diff session feed is not available", 404);
    throw error;
  }
  if (!isWithin(rootInfo.root, resolved)) throw httpError("Streaming Diff session feed escapes its feed root");
  const journal = (ctx.readJournal ?? readJournal)(resolved);
  if (!journal.manifest) throw httpError("Streaming Diff session feed has no published manifest", 404);
  const identity = journal.manifest.identity;
  if (identity.logicalRepoKey !== feed.repoKey || identity.worktreeKey !== feed.worktreeKey || identity.session !== feed.session) {
    throw httpError("Streaming Diff session identity does not match its feed path");
  }
  return { ...feed, path: resolved, identity, journal };
}

function selectedFeed(ctx, rootInfo) {
  if (ctx.url.searchParams.has("list")) return null;
  const repoKey = queryValue(ctx.url, "repoKey");
  const worktreeKey = queryValue(ctx.url, "worktreeKey");
  const session = queryValue(ctx.url, "session");
  if (!session) return null;
  if (!KEY_PATTERN.test(repoKey ?? "") || !KEY_PATTERN.test(worktreeKey ?? "")) {
    throw httpError("repoKey and worktreeKey must be lowercase 12-character hexadecimal keys");
  }
  const safeSession = streamingDiffIdentifier(session, "session");
  const path = containedJoin(rootInfo.repoRoot, "streaming-diff", STREAMING_DIFF_FEED_VERSION, repoKey, worktreeKey, identifierPathComponent(safeSession));
  return verifyFeed(ctx, rootInfo, { path, repoKey, worktreeKey, session: safeSession });
}

function safeUpdatedAt(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now + 5 * 60_000 ? value : null;
}

function directoryEntries(path, limit, visit) {
  let directory;
  try {
    directory = opendirSync(path);
    for (let count = 0; count < limit; count += 1) {
      const entry = directory.readSync();
      if (!entry) return false;
      if (visit(entry) === false) return true;
    }
    return directory.readSync() !== null;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  } finally {
    directory?.closeSync();
  }
}

function recentFeeds(root, repoKey, maxBytes, manifestReader = readManifestPure) {
  const feeds = [];
  let bytes = 0;
  let remaining = STREAMING_DIFF_LIST_LIMITS.maxFeedDirs;
  let truncated = false;
  const repoPath = join(root, repoKey);
  const keep = (entry) => {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    if (bytes + entryBytes > maxBytes) {
      truncated = true;
      return false;
    }
    bytes += entryBytes;
    feeds.push(entry);
    return true;
  };
  try {
    truncated ||= directoryEntries(repoPath, STREAMING_DIFF_LIST_LIMITS.maxFeedDirs, (worktree) => {
      if (!worktree.isDirectory() || !KEY_PATTERN.test(worktree.name) || remaining <= 0) return remaining > 0;
      const worktreePath = join(repoPath, worktree.name);
      const more = directoryEntries(worktreePath, remaining, (session) => {
        if (!session.isDirectory() || !SESSION_PATH_PATTERN.test(session.name)) return true;
        remaining -= 1;
        try {
          const resolved = realpathSync(join(worktreePath, session.name));
          if (!isWithin(root, resolved)) return true;
          const manifest = manifestReader(resolved);
          if (!manifest || manifest.identity.logicalRepoKey !== repoKey || manifest.identity.worktreeKey !== worktree.name
            || identifierPathComponent(manifest.identity.session) !== session.name) return true;
          return keep({ identity: manifest.identity, updatedAt: safeUpdatedAt(manifest.updatedAt) });
        } catch {
          return true;
        }
      });
      if (more || remaining === 0) truncated = true;
      return !truncated;
    });
  } catch {
    // Incomplete, stale, or adversarial directories are not feeds.
  }
  return {
    feeds: feeds.sort((left, right) => (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0)),
    truncated,
  };
}

function bounded(value, maxBytes) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) throw httpError(`Streaming Diff response exceeds its ${maxBytes}-byte limit`, 413);
  return value;
}

function boundedList(value, maxBytes) {
  while (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes && value.feeds.length) {
    value.feeds.pop();
    value.truncated = true;
  }
  return bounded(value, maxBytes);
}

function wantsSse(req) {
  return String(req.headers.accept ?? "").split(",").some((value) => value.trim().startsWith("text/event-stream"));
}

function cursor(feed, revId) {
  return `${SSE_WIRE_PREFIX}${feed.identity.logicalRepoKey}:${feed.identity.worktreeKey}:${identifierPathComponent(feed.identity.session)}:${feed.journal.manifest.generation}:${revId}`;
}

function reconnectSince(ctx, feed) {
  const since = queryValue(ctx.url, "since");
  const header = ctx.req.headers["last-event-id"];
  const lastEventId = Array.isArray(header) ? header[0] : header;
  if (since && lastEventId && since !== lastEventId) throw httpError("since and Last-Event-ID must match when both are supplied");
  const value = since ?? lastEventId ?? null;
  if (value === null) return null;
  const prefix = cursor(feed, "");
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

function reserveSubscriber(path, options) {
  if (subscriberTotal >= options.maxGlobalSubscribers || (subscribers.get(path) ?? 0) >= options.maxSubscribersPerFeed) return false;
  subscriberTotal += 1;
  subscribers.set(path, (subscribers.get(path) ?? 0) + 1);
  return true;
}

function releaseSubscriber(path) {
  const count = subscribers.get(path) ?? 0;
  if (count > 1) subscribers.set(path, count - 1);
  else subscribers.delete(path);
  subscriberTotal = Math.max(0, subscriberTotal - 1);
}

function sseWrite(res, state, text) {
  if (state.pending) return false;
  const accepted = res.write(text);
  if (!accepted) {
    state.pending = true;
    state.drain = () => { state.pending = false; state.drain = null; };
    res.once("drain", state.drain);
  }
  return true;
}

function startSse(ctx, feed) {
  const options = { ...STREAMING_DIFF_SSE_DEFAULTS, ...(ctx.sseOptions ?? {}) };
  const timers = ctx.timers ?? { setInterval, clearInterval };
  const since = reconnectSince(ctx, feed);
  const reconnect = (lastId) => {
    if (ctx.reconnectFeed) return { result: ctx.reconnectFeed(feed.path, lastId), feed };
    const current = verifyFeed(ctx, ctx.rootInfo, feed);
    const reconnectId = current.journal.manifest.generation === feed.journal.manifest.generation ? lastId : "";
    const result = !current.journal.manifest || current.journal.race
      ? { type: "reset", cards: current.journal.cards }
      : resolveReconnect(current.journal.manifest, current.journal.cards, reconnectId);
    return { result, feed: current };
  };
  // The only fallible initial read happens before writeHead, allowing the
  // route to return a normal JSON error rather than double-sending headers.
  const initial = reconnect(since);
  if (!reserveSubscriber(feed.path, options)) throw httpError("Streaming Diff subscriber limit reached", 503);
  const res = ctx.res;
  const state = { closed: false, pending: false, drain: null, poll: null, heartbeat: null, lastId: since, feed: initial.feed };
  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.poll !== null) timers.clearInterval(state.poll);
    if (state.heartbeat !== null) timers.clearInterval(state.heartbeat);
    if (state.drain) res.removeListener("drain", state.drain);
    res.removeListener("close", cleanup);
    res.removeListener("error", cleanup);
    res.removeListener("finish", cleanup);
    releaseSubscriber(feed.path);
  };
  const endStream = () => {
    cleanup();
    if (!res.writableEnded) res.end?.();
  };
  const closeSlow = () => {
    cleanup();
    res.destroy?.();
  };
  const event = (card) => {
    const payload = JSON.stringify(card);
    if (Buffer.byteLength(payload, "utf8") > ctx.maxOvenDataBytes) return closeSlow();
    if (!sseWrite(res, state, `id: ${cursor(state.feed, card.revId)}\ndata: ${payload}\n\n`)) closeSlow();
    else state.lastId = card.revId;
  };
  const publish = ({ result, feed: current }) => {
    if (state.closed) return;
    state.feed = current;
    if (result.type === "reset" && !sseWrite(res, state, "event: reset\ndata: {\"type\":\"reset\"}\n\n")) return closeSlow();
    for (const card of result.cards) {
      if (state.closed) return;
      event(card);
    }
  };
  const poll = () => {
    try {
      publish(reconnect(state.lastId));
    } catch {
      endStream();
    }
  };
  try {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
    res.flushHeaders?.();
    res.on("close", cleanup);
    res.on("error", cleanup);
    res.on("finish", cleanup);
    publish(initial);
    if (!state.closed) {
      state.poll = timers.setInterval(poll, options.pollMs);
      state.heartbeat = timers.setInterval(() => {
        try {
          if (!sseWrite(res, state, ": heartbeat\n\n")) closeSlow();
        } catch {
          endStream();
        }
      }, options.heartbeatMs);
    }
  } catch {
    // Once writeHead succeeds, never rethrow into the JSON route catch.
    endStream();
  }
}

export const streamingDiffHandler = Object.freeze({
  id: STREAMING_DIFF_OVEN_ID,

  serveData(ctx) {
    try {
      const root = feedRoot(ctx);
      if (ctx.url.searchParams.has("list")) {
        const repoKey = listRepoKey(ctx);
        const limit = Math.min(ctx.maxOvenDataBytes, STREAMING_DIFF_LIST_LIMITS.maxBytes);
        return boundedList({ ovenId: STREAMING_DIFF_OVEN_ID, ...recentFeeds(root.root, repoKey, limit, ctx.readManifest) }, ctx.maxOvenDataBytes);
      }
      const feed = selectedFeed(ctx, root);
      if (!feed) return bounded({ ovenId: STREAMING_DIFF_OVEN_ID, feeds: [] }, ctx.maxOvenDataBytes);
      if (!wantsSse(ctx.req)) return bounded({ ovenId: STREAMING_DIFF_OVEN_ID, identity: feed.identity, updatedAt: feed.journal.manifest.updatedAt, cards: feed.journal.cards, reset: feed.journal.race }, ctx.maxOvenDataBytes);
      startSse({ ...ctx, rootInfo: root }, feed);
      return undefined;
    } catch (error) {
      if (error?.streamingDiffPublic) throw error;
      throw httpError("Streaming Diff feed is unavailable", Number.isInteger(error?.status) ? error.status : 422);
    }
  },
});

registerOvenHandler(STREAMING_DIFF_OVEN_ID, streamingDiffHandler);
