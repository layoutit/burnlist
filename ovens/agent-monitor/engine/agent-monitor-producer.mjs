import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename } from "node:path";

import { AGENT_MONITOR_LIMITS } from "./agent-monitor-data-contract.mjs";
import {
  agentMonitorProducerStatePath,
  commitAgentMonitorSnapshot,
  ensureAgentMonitorFeedRoot,
  loadAgentMonitorFeed,
  publishAgentMonitorInvalidation,
  readAgentMonitorJson,
  resolveAgentMonitorIdentity,
  writeAgentMonitorJson,
} from "./agent-monitor-feed.mjs";
import {
  AGENT_MONITOR_PROJECTION_VERSION,
  agentMonitorSnapshotNeedsRefresh,
  buildAgentMonitorSnapshot,
  coalesceAgentMonitorEvents,
  isVisibleAgentMonitorEvent,
  snapshotMonitorEvents,
} from "./agent-monitor-projection.mjs";
import {
  projectAgentMonitorLines,
  reprojectRecentAgentMonitorEvents,
} from "./agent-monitor-reproject.mjs";
import { discoverAgentSessionSources } from "./agent-monitor-sources.mjs";
import {
  agentMonitorTailPosition,
  agentMonitorThreadMetadata,
  foldCodexTurnOpen,
  priorCodexTurnOpen,
  sameAgentMonitorThreadMetadata,
} from "./agent-monitor-thread-state.mjs";
import { readLoopSessionContext } from "../../../src/loops/events/hook-context.mjs";

export const AGENT_MONITOR_PRODUCER_CONTRACT = "burnlist-agent-monitor-producer@1";
export const AGENT_MONITOR_PRODUCER_LIMITS = Object.freeze({
  days: 14,
  maxChunkBytes: 16 * 1024 * 1024,
  maxCandidateFiles: 4_096,
  maxDirectories: 4_096,
  maxFileBytes: 1024 * 1024 * 1024,
  maxSessions: 128,
  metadataBytes: 512 * 1024,
});

const identityCache = new Map();

export function discoverAgentMonitorSessions({
  repoRoot = process.cwd(),
  logicalRepoRoot,
  nowMs = Date.now(),
  limits = AGENT_MONITOR_PRODUCER_LIMITS,
  ...sourceOptions
} = {}) {
  const root = logicalRepoRoot ? realpathSync(logicalRepoRoot) : ensureAgentMonitorFeedRoot(repoRoot).logicalRepoRoot;
  return discoverAgentSessionSources({ ...sourceOptions, nowMs, limits }).flatMap((file) => {
    try {
      const session = file.provider === "codex" ? file.session : `${file.provider}:${file.session}`;
      const cacheKey = `${file.cwd}\0${session}`;
      let resolved = identityCache.get(cacheKey);
      if (!resolved) {
        resolved = resolveAgentMonitorIdentity({ cwd: file.cwd, session });
        identityCache.set(cacheKey, resolved);
      }
      return resolved.logicalRepoRoot === root
        ? [{
          ...file,
          rawSession: file.providerSession ?? file.session,
          session,
          resolved,
          threadSource: file.provider === "codex" ? file.threadSource ?? "other" : "other",
          topLevel: file.provider === "codex" && file.topLevel === true,
        }]
        : [];
    } catch {
      return [];
    }
  });
}

function priorFeed(value) {
  try { return loadAgentMonitorFeed(value.feedDir); } catch { return null; }
}

function validProducerState(state, candidate, stat) {
  return state?.contract === AGENT_MONITOR_PRODUCER_CONTRACT
    && state.session === candidate.session
    && (state.file === candidate.path || state.file === basename(candidate.path))
    && state.dev === stat.dev
    && state.ino === stat.ino
    && Number.isSafeInteger(state.offset)
    && state.offset >= 0
    && state.offset <= stat.size
    && Number.isSafeInteger(state.line)
    && state.line >= 0;
}

function validManifestCursor(cursor, candidate, stat) {
  return cursor?.file === basename(candidate.path)
    && cursor.dev === stat.dev
    && cursor.ino === stat.ino
    && Number.isSafeInteger(cursor.offset)
    && cursor.offset >= 0
    && cursor.offset <= stat.size
    && Number.isSafeInteger(cursor.line)
    && cursor.line >= 0;
}

function sourcePosition(prior, stored, candidate, stat, limits) {
  const tail = (continuing) => {
    const position = agentMonitorTailPosition(
      candidate.path,
      stat,
      limits.maxChunkBytes,
      limits.maxFileBytes,
    );
    return {
      continuing,
      fastForwarded: position.fastForwarded,
      cursor: {
        file: basename(candidate.path),
        dev: stat.dev,
        ino: stat.ino,
        offset: position.offset,
        line: position.line,
      },
    };
  };
  if (validManifestCursor(prior?.manifest?.cursor, candidate, stat)) {
    if (stat.size - prior.manifest.cursor.offset > limits.maxChunkBytes) return tail(true);
    return { continuing: true, cursor: prior.manifest.cursor };
  }
  if (prior && validProducerState(stored, candidate, stat) && stored.digest === prior.manifest.digest) {
    if (stat.size - stored.offset > limits.maxChunkBytes) return tail(true);
    return {
      continuing: true,
      cursor: {
        file: basename(candidate.path),
        dev: stored.dev,
        ino: stored.ino,
        offset: stored.offset,
        line: stored.line,
      },
    };
  }
  if (stat.size > limits.maxChunkBytes) return tail(false);
  return {
    continuing: false,
    cursor: { file: basename(candidate.path), dev: stat.dev, ino: stat.ino, offset: 0, line: 0 },
  };
}

function manifestSummaryNeedsRefresh(prior) {
  if (prior?.manifest?.summary?.updatedAt !== prior?.snapshot?.monitor?.summary?.updatedAt) return true;
  const thread = prior?.snapshot?.monitor?.thread;
  if (!thread) return false;
  return Object.keys(thread).some((key) => prior.manifest.summary?.[key] !== thread[key]);
}

function loopContext(candidate) {
  try {
    return readLoopSessionContext(candidate.resolved.logicalRepoRoot, {
      provider: candidate.provider,
      session: candidate.rawSession,
    });
  } catch {
    return null;
  }
}

function sameLoop(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function readCompleteChunk(path, offset, limit, maxFileBytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maxFileBytes) {
      throw new Error("Agent session is not a bounded regular file");
    }
    const available = Math.min(Math.max(0, before.size - offset), limit);
    const buffer = Buffer.alloc(available);
    let bytes = 0;
    while (bytes < available) {
      const count = readSync(fd, buffer, bytes, available - bytes, offset + bytes);
      if (count === 0) break;
      bytes += count;
    }
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || after.size < before.size) {
      throw new Error("Agent session changed identity during read");
    }
    const source = buffer.subarray(0, bytes);
    const newline = source.lastIndexOf(0x0a);
    return { before, source: newline < 0 ? Buffer.alloc(0) : source.subarray(0, newline + 1) };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function updateAgentMonitorSession(candidate, {
  now = () => new Date().toISOString(),
  limits = AGENT_MONITOR_PRODUCER_LIMITS,
} = {}) {
  const statePath = agentMonitorProducerStatePath(candidate.resolved);
  const stored = readAgentMonitorJson(statePath);
  const stat = statSync(candidate.path);
  const prior = priorFeed(candidate.resolved);
  const position = sourcePosition(prior, stored, candidate, stat, limits);
  const generatedAt = now();
  const nowMs = Date.parse(generatedAt);
  const loop = loopContext(candidate);
  const retainedTurnOpen = priorCodexTurnOpen(
    prior,
    candidate,
    position.cursor,
    limits,
    position.fastForwarded,
  );
  if (position.continuing && prior
      && prior.snapshot.monitor?.projectionVersion !== AGENT_MONITOR_PROJECTION_VERSION) {
    const replayed = reprojectRecentAgentMonitorEvents({
      cursor: position.cursor,
      generatedAt,
      initialLimit: limits.maxChunkBytes,
      maxEvents: AGENT_MONITOR_LIMITS.maxEvents,
      maxFileBytes: limits.maxFileBytes,
      path: candidate.path,
      provider: candidate.provider,
      session: candidate.session,
    });
    const snapshot = buildAgentMonitorSnapshot({
      activityAt: replayed.activityAt ?? prior.snapshot.monitor.summary.updatedAt,
      events: replayed.events,
      file: basename(candidate.path),
      generatedAt,
      identity: candidate.resolved.identity,
      line: position.cursor.line,
      loop,
      newEvents: [],
      priorCounts: prior.snapshot.monitor.counts,
      thread: agentMonitorThreadMetadata(
        candidate,
        retainedTurnOpen,
        position.cursor.offset >= stat.size,
      ),
      nowMs,
    });
    const manifest = commitAgentMonitorSnapshot(candidate.resolved, snapshot, now, position.cursor);
    writeProducerState(statePath, candidate, position.cursor, manifest);
    return publishResult(candidate, position.cursor, manifest, true);
  }
  const chunk = readCompleteChunk(
    candidate.path,
    position.cursor.offset,
    limits.maxChunkBytes,
    limits.maxFileBytes,
  );
  if (!chunk.source.length) {
    const thread = agentMonitorThreadMetadata(
      candidate,
      retainedTurnOpen,
      position.cursor.offset >= stat.size,
    );
    if (!position.continuing || !prior
        || (!agentMonitorSnapshotNeedsRefresh(prior.snapshot, nowMs)
          && !manifestSummaryNeedsRefresh(prior)
          && sameLoop(prior.snapshot.monitor?.loop, loop)
          && sameAgentMonitorThreadMetadata(prior.snapshot.monitor?.thread, thread))) {
      return {
        changed: false,
        identity: candidate.resolved.identity,
        line: position.cursor.line,
        offset: position.cursor.offset,
      };
    }
    const snapshot = buildAgentMonitorSnapshot({
      activityAt: prior.snapshot.monitor.summary.updatedAt,
      events: snapshotMonitorEvents(prior.snapshot) ?? [],
      file: basename(candidate.path),
      generatedAt,
      identity: candidate.resolved.identity,
      line: position.cursor.line,
      loop,
      newEvents: [],
      priorCounts: prior.snapshot.monitor.counts,
      thread,
      nowMs,
    });
    const manifest = commitAgentMonitorSnapshot(candidate.resolved, snapshot, now, position.cursor);
    writeProducerState(statePath, candidate, position.cursor, manifest);
    return publishResult(candidate, position.cursor, manifest, true);
  }

  const parsedEvents = projectAgentMonitorLines(
    chunk.source,
    position.cursor.line + 1,
    candidate.session,
    generatedAt,
    candidate.provider,
  );
  const retained = position.continuing && !position.fastForwarded
    ? snapshotMonitorEvents(prior.snapshot) ?? []
    : [];
  const visibleEvents = coalesceAgentMonitorEvents([...retained].reverse().concat(parsedEvents))
    .filter(isVisibleAgentMonitorEvent)
    .reverse();
  const nextCursor = {
    file: basename(candidate.path),
    dev: chunk.before.dev,
    ino: chunk.before.ino,
    offset: position.cursor.offset + chunk.source.length,
    line: position.cursor.line + parsedEvents.length,
  };
  const turnOpen = candidate.provider === "codex"
    ? foldCodexTurnOpen(parsedEvents, retainedTurnOpen)
    : null;
  const snapshot = buildAgentMonitorSnapshot({
    activityAt: parsedEvents.at(-1)?.time ?? prior?.snapshot?.monitor?.summary?.updatedAt,
    events: visibleEvents,
    file: basename(candidate.path),
    generatedAt,
    identity: candidate.resolved.identity,
    line: nextCursor.line,
    loop,
    newEvents: parsedEvents,
    priorCounts: position.continuing ? prior.snapshot.monitor.counts : {},
    thread: agentMonitorThreadMetadata(candidate, turnOpen, nextCursor.offset >= chunk.before.size),
    nowMs,
  });
  const manifest = commitAgentMonitorSnapshot(candidate.resolved, snapshot, now, nextCursor);
  writeProducerState(statePath, candidate, nextCursor, manifest);
  return publishResult(candidate, nextCursor, manifest);
}

function writeProducerState(statePath, candidate, cursor, manifest) {
  writeAgentMonitorJson(statePath, {
    contract: AGENT_MONITOR_PRODUCER_CONTRACT,
    session: candidate.session,
    provider: candidate.provider,
    file: candidate.path,
    dev: cursor.dev,
    ino: cursor.ino,
    offset: cursor.offset,
    line: cursor.line,
    threadSource: candidate.threadSource,
    topLevel: candidate.topLevel,
    turnOpen: manifest.summary?.turnOpen ?? null,
    caughtUp: manifest.summary?.caughtUp ?? false,
    updatedAt: manifest.updatedAt,
    digest: manifest.digest,
  });
}

function publishResult(candidate, cursor, manifest, reprojected = false) {
  const publication = publishAgentMonitorInvalidation(candidate.resolved.logicalRepoRoot, manifest);
  return {
    changed: true,
    reprojected,
    identity: candidate.resolved.identity,
    line: cursor.line,
    offset: cursor.offset,
    manifest,
    publication,
  };
}

export function runAgentMonitorOnce(options = {}) {
  const prepared = options.preparedRoot
    ? { logicalRepoRoot: realpathSync(options.preparedRoot) }
    : ensureAgentMonitorFeedRoot(options.repoRoot ?? process.cwd());
  const sessions = discoverAgentMonitorSessions({ ...options, logicalRepoRoot: prepared.logicalRepoRoot });
  const feeds = [];
  const errors = [];
  for (const session of sessions) {
    try { feeds.push(updateAgentMonitorSession(session, options)); } catch (error) {
      errors.push({ session: session.session, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    repoRoot: prepared.logicalRepoRoot,
    scanned: sessions.length,
    changed: feeds.filter((feed) => feed.changed).length,
    feeds,
    errors,
  };
}
