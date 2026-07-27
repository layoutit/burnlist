import { opendirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { OVEN_DATA_INPUT, registerOvenHandler } from "../../../src/ovens/oven-registry.mjs";
import { readOvenJsonSnapshot, serveOvenJsonSnapshot } from "../../../src/server/oven-json-handler.mjs";
import { containedJoin } from "../../../src/server/repo-state.mjs";
import {
  AGENT_MONITOR_DATA_CONTRACT,
  AGENT_MONITOR_LIMITS,
  AGENT_MONITOR_OVEN_ID,
  assertAgentMonitorSnapshot,
} from "./agent-monitor-data-contract.mjs";
import {
  AGENT_MONITOR_FEED_VERSION,
  agentMonitorFeedDir,
  agentMonitorSessionPath,
  isAgentMonitorSessionPath,
  loadAgentMonitorFeed,
  readAgentMonitorManifest,
  verifiedAgentMonitorFeedRoot,
} from "./agent-monitor-feed.mjs";
import {
  buildAgentMonitorSnapshot,
  snapshotMonitorEvents,
} from "./agent-monitor-projection.mjs";
import { codexRolloutSession } from "./agent-monitor-sources.mjs";

const keyPattern = /^[a-f0-9]{12}$/u;
const recentMs = 14 * 86_400_000;

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status, agentMonitorPublic: true });
}

function queryValue(url, name) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw httpError(`${name} must be supplied at most once`);
  return values[0] ?? null;
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function rootInfo(ctx) {
  if (!ctx.binding?.repoRoot || !ctx.bindingPath) {
    throw httpError("Agent Monitor requires a repository-scoped feed binding", 404);
  }
  return {
    root: verifiedAgentMonitorFeedRoot(ctx.binding.repoRoot, ctx.bindingPath),
    repoRoot: ctx.binding.repoRoot,
  };
}

function listRepoKey(ctx) {
  const value = queryValue(ctx.url, "repoKey");
  if (!keyPattern.test(value ?? "")) {
    throw httpError("Agent Monitor list requires a lowercase 12-character hexadecimal repoKey");
  }
  return value;
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

function recentFeeds(root, repoKey, nowMs = Date.now()) {
  const feeds = [];
  let remaining = AGENT_MONITOR_LIMITS.maxFeeds;
  let truncated = false;
  const repoPath = join(root, repoKey);
  truncated ||= directoryEntries(repoPath, AGENT_MONITOR_LIMITS.maxFeeds, (worktree) => {
    if (!worktree.isDirectory() || !keyPattern.test(worktree.name) || remaining <= 0) return remaining > 0;
    const worktreePath = join(repoPath, worktree.name);
    const more = directoryEntries(worktreePath, remaining, (session) => {
      if (!session.isDirectory() || !isAgentMonitorSessionPath(session.name)) return true;
      remaining -= 1;
      try {
        const path = realpathSync(join(worktreePath, session.name));
        if (!isWithin(root, path)) return true;
        const manifest = readAgentMonitorManifest(path);
        if (manifest.identity.logicalRepoKey !== repoKey
          || manifest.identity.worktreeKey !== worktree.name
          || agentMonitorSessionPath(manifest.identity.session) !== session.name) return true;
        const rolloutSession = codexRolloutSession(manifest.cursor?.file);
        if (rolloutSession && !manifest.identity.session.includes(":")
          && rolloutSession !== manifest.identity.session) return true;
        const activityAt = manifest.summary?.updatedAt ?? manifest.updatedAt;
        const updated = Date.parse(activityAt);
        if (!Number.isFinite(updated) || updated > nowMs + 300_000 || nowMs - updated > recentMs) return true;
        feeds.push({
          identity: manifest.identity,
          updatedAt: activityAt,
          summary: manifest.summary ?? null,
        });
      } catch { /* Invalid directories are not feeds. */ }
      return true;
    });
    if (more || remaining === 0) truncated = true;
    return remaining > 0;
  });
  return {
    feeds: feeds.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    truncated,
  };
}

function sessionLabel(session) {
  return session.length > 12 ? `…${session.slice(-8)}` : session;
}

export function aggregateAgentMonitorFeeds(root, repoKey, nowMs = Date.now()) {
  const listing = recentFeeds(root.root, repoKey, nowMs);
  const events = [];
  const counts = { commands: 0, diffs: 0, failures: 0, reasoning: 0 };
  let lines = 0;
  for (const feed of listing.feeds) {
    try {
      const loaded = loadAgentMonitorFeed(agentMonitorFeedDir({
        repoRoot: root.repoRoot,
        logicalRepoKey: repoKey,
        worktreeKey: feed.identity.worktreeKey,
        session: feed.identity.session,
      }));
      lines += loaded.snapshot.monitor.counts.lines;
      for (const name of Object.keys(counts)) counts[name] += loaded.snapshot.monitor.counts[name];
      const label = sessionLabel(feed.identity.session);
      for (const event of snapshotMonitorEvents(loaded.snapshot) ?? []) {
        events.push({
          ...event,
          id: `${feed.identity.worktreeKey}:${event.id}`.slice(0, 240),
          detail: `${label} · ${event.detail}`.slice(0, 400),
        });
      }
    } catch { /* A malformed individual feed must not erase the aggregate view. */ }
  }
  events.sort((left, right) =>
    (Date.parse(right.time) - Date.parse(left.time)) || (right.line - left.line));
  const generatedAt = new Date(nowMs).toISOString();
  return buildAgentMonitorSnapshot({
    activityAt: events[0]?.time,
    events,
    file: "recent-sessions",
    generatedAt,
    identity: { logicalRepoKey: repoKey, worktreeKey: repoKey, session: "all" },
    line: lines,
    maxEvents: AGENT_MONITOR_LIMITS.maxEvents,
    newEvents: [],
    priorCounts: counts,
    nowMs,
  });
}

function selectedFeed(ctx, root) {
  const repoKey = queryValue(ctx.url, "repoKey");
  const worktreeKey = queryValue(ctx.url, "worktreeKey");
  const session = queryValue(ctx.url, "session");
  if (!repoKey || !worktreeKey || !session) {
    throw httpError("Agent Monitor selection requires repoKey, worktreeKey, and session");
  }
  if (!keyPattern.test(repoKey) || !keyPattern.test(worktreeKey)) {
    throw httpError("Agent Monitor repository and worktree keys are invalid");
  }
  let path;
  try {
    path = realpathSync(agentMonitorFeedDir({
      repoRoot: root.repoRoot,
      logicalRepoKey: repoKey,
      worktreeKey,
      session,
    }));
  } catch (error) {
    if (error?.code === "ENOENT") throw httpError("Agent Monitor session feed is not available", 404);
    throw error;
  }
  if (!isWithin(root.root, path)) throw httpError("Agent Monitor session feed escapes its repository");
  const manifest = readAgentMonitorManifest(path);
  const identity = manifest.identity;
  if (identity.logicalRepoKey !== repoKey || identity.worktreeKey !== worktreeKey || identity.session !== session) {
    throw httpError("Agent Monitor session identity does not match its feed path");
  }
  return { path, manifest };
}

export const agentMonitorHandler = Object.freeze({
  id: AGENT_MONITOR_OVEN_ID,
  inputContract: AGENT_MONITOR_DATA_CONTRACT,
  dataInput: OVEN_DATA_INPUT.producerManaged,

  serveData(ctx) {
    try {
      const root = rootInfo(ctx);
      if (ctx.url.searchParams.has("list")) {
        return { ovenId: AGENT_MONITOR_OVEN_ID, ...recentFeeds(root.root, listRepoKey(ctx)) };
      }
      if (ctx.url.searchParams.has("aggregate")) {
        const payload = aggregateAgentMonitorFeeds(root, listRepoKey(ctx));
        assertAgentMonitorSnapshot(payload);
        return { ovenId: AGENT_MONITOR_OVEN_ID, payload, updatedAt: payload.generatedAt };
      }
      const feed = selectedFeed(ctx, root);
      const snapshotPath = containedJoin(
        root.repoRoot,
        AGENT_MONITOR_OVEN_ID,
        AGENT_MONITOR_FEED_VERSION,
        feed.manifest.identity.logicalRepoKey,
        feed.manifest.identity.worktreeKey,
        agentMonitorSessionPath(feed.manifest.identity.session),
        feed.manifest.snapshot,
      );
      const snapshot = readOvenJsonSnapshot(ctx, {
        ovenId: `${AGENT_MONITOR_OVEN_ID}:${feed.manifest.identity.session}`,
        path: snapshotPath,
        label: "Agent Monitor canonical snapshot",
        freshnessKey: feed.manifest.digest,
        validate(payload, source) {
          assertAgentMonitorSnapshot(payload);
          if (source.sourceDigest !== feed.manifest.digest
            || JSON.stringify(payload.identity) !== JSON.stringify(feed.manifest.identity)) {
            throw httpError("Agent Monitor snapshot does not match its manifest");
          }
        },
      });
      serveOvenJsonSnapshot(ctx, snapshot, {
        ovenId: AGENT_MONITOR_OVEN_ID,
        identity: feed.manifest.identity,
        updatedAt: feed.manifest.updatedAt,
      });
      return undefined;
    } catch (error) {
      if (error?.agentMonitorPublic) throw error;
      throw httpError("Agent Monitor feed is unavailable", Number.isInteger(error?.status) ? error.status : 422);
    }
  },
});

registerOvenHandler(AGENT_MONITOR_OVEN_ID, agentMonitorHandler);
