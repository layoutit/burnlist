import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

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

export const AGENT_MONITOR_PRODUCER_CONTRACT = "burnlist-agent-monitor-producer@1";
export const AGENT_MONITOR_PRODUCER_LIMITS = Object.freeze({
  days: 14,
  maxChunkBytes: 16 * 1024 * 1024,
  maxCandidateFiles: 4_096,
  maxDirectories: 4_096,
  maxFileBytes: 128 * 1024 * 1024,
  maxSessions: 128,
  metadataBytes: 512 * 1024,
});

const metadataCache = new Map();
const identityCache = new Map();

function directories(path, pattern) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => join(path, entry.name))
      .sort().reverse();
  } catch {
    return [];
  }
}

function sessionFiles(root, nowMs, limits) {
  const candidates = [];
  let directoryCount = 0;
  const recentAfter = nowMs - limits.days * 86_400_000;
  const days = directories(root, /^\d{4}$/u).flatMap((year) => directories(year, /^\d{2}$/u))
    .flatMap((month) => directories(month, /^\d{2}$/u));
  for (const directory of days) {
    directoryCount += 1;
    if (directoryCount > limits.maxDirectories || candidates.length >= limits.maxCandidateFiles) break;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(directory, entry.name);
      try {
        const stat = statSync(path);
        if (stat.isFile() && stat.size > 0 && stat.size <= limits.maxFileBytes && stat.mtimeMs >= recentAfter) {
          candidates.push({ path, mtimeMs: stat.mtimeMs, size: stat.size });
        }
      } catch { /* A disappearing rollout is not a discoverable session. */ }
      if (candidates.length >= limits.maxCandidateFiles) break;
    }
  }
  return candidates
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limits.maxSessions);
}

function readPrefix(path, limit) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    const buffer = Buffer.alloc(Math.min(stat.size, limit));
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytes).toString("utf8");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function sessionMetadata(path, limits) {
  let stat;
  try { stat = statSync(path); } catch { return null; }
  const cached = metadataCache.get(path);
  if (cached?.dev === stat.dev && cached?.ino === stat.ino
      && cached?.size === stat.size && cached?.mtimeMs === stat.mtimeMs) return cached.value;
  let value = null;
  try {
    for (const line of readPrefix(path, limits.metadataBytes).split("\n")) {
      if (!line.includes('"type":"session_meta"')) continue;
      const record = JSON.parse(line);
      const session = record?.payload?.session_id ?? record?.payload?.id;
      const cwd = record?.payload?.cwd;
      if (typeof session === "string" && typeof cwd === "string") {
        value = { session, cwd: resolve(cwd) };
        break;
      }
    }
  } catch { /* Invalid or incomplete metadata does not identify a feed. */ }
  metadataCache.set(path, { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, value });
  return value;
}

export function discoverAgentMonitorSessions({
  repoRoot = process.cwd(),
  logicalRepoRoot,
  sessionRoot = join(homedir(), ".codex", "sessions"),
  nowMs = Date.now(),
  limits = AGENT_MONITOR_PRODUCER_LIMITS,
} = {}) {
  const root = logicalRepoRoot ? realpathSync(logicalRepoRoot) : ensureAgentMonitorFeedRoot(repoRoot).logicalRepoRoot;
  return sessionFiles(sessionRoot, nowMs, limits).flatMap((file) => {
    const metadata = sessionMetadata(file.path, limits);
    if (!metadata) return [];
    try {
      const cacheKey = `${metadata.cwd}\0${metadata.session}`;
      let resolved = identityCache.get(cacheKey);
      if (!resolved) {
        resolved = resolveAgentMonitorIdentity({ cwd: metadata.cwd, session: metadata.session });
        identityCache.set(cacheKey, resolved);
      }
      return resolved.logicalRepoRoot === root ? [{ ...file, ...metadata, resolved }] : [];
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

function sourcePosition(prior, stored, candidate, stat) {
  if (validManifestCursor(prior?.manifest?.cursor, candidate, stat)) {
    return { continuing: true, cursor: prior.manifest.cursor };
  }
  if (prior && validProducerState(stored, candidate, stat) && stored.digest === prior.manifest.digest) {
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
  return {
    continuing: false,
    cursor: { file: basename(candidate.path), dev: stat.dev, ino: stat.ino, offset: 0, line: 0 },
  };
}

function manifestSummaryNeedsRefresh(prior) {
  return prior?.manifest?.summary?.updatedAt !== prior?.snapshot?.monitor?.summary?.updatedAt;
}

function readCompleteChunk(path, offset, limit, maxFileBytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maxFileBytes) {
      throw new Error("Codex session is not a bounded regular file");
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
      throw new Error("Codex session changed identity during read");
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
  const position = sourcePosition(prior, stored, candidate, stat);
  const generatedAt = now();
  const nowMs = Date.parse(generatedAt);
  if (position.continuing && prior
      && prior.snapshot.monitor?.projectionVersion !== AGENT_MONITOR_PROJECTION_VERSION) {
    const replayed = reprojectRecentAgentMonitorEvents({
      cursor: position.cursor,
      generatedAt,
      initialLimit: limits.maxChunkBytes,
      maxEvents: AGENT_MONITOR_LIMITS.maxEvents,
      maxFileBytes: limits.maxFileBytes,
      path: candidate.path,
      session: candidate.session,
    });
    const snapshot = buildAgentMonitorSnapshot({
      activityAt: replayed.activityAt ?? prior.snapshot.monitor.summary.updatedAt,
      events: replayed.events,
      file: basename(candidate.path),
      generatedAt,
      identity: candidate.resolved.identity,
      line: position.cursor.line,
      newEvents: [],
      priorCounts: prior.snapshot.monitor.counts,
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
    if (!position.continuing || !prior
        || (!agentMonitorSnapshotNeedsRefresh(prior.snapshot, nowMs) && !manifestSummaryNeedsRefresh(prior))) {
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
      newEvents: [],
      priorCounts: prior.snapshot.monitor.counts,
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
  );
  const retained = position.continuing ? snapshotMonitorEvents(prior.snapshot) ?? [] : [];
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
  const snapshot = buildAgentMonitorSnapshot({
    activityAt: parsedEvents.at(-1)?.time ?? prior?.snapshot?.monitor?.summary?.updatedAt,
    events: visibleEvents,
    file: basename(candidate.path),
    generatedAt,
    identity: candidate.resolved.identity,
    line: nextCursor.line,
    newEvents: parsedEvents,
    priorCounts: position.continuing ? prior.snapshot.monitor.counts : {},
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
    file: candidate.path,
    dev: cursor.dev,
    ino: cursor.ino,
    offset: cursor.offset,
    line: cursor.line,
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
