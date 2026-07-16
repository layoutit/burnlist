import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { createGitCaptureIo } from "./streaming-diff-capture-git.mjs";
import { captureLimits, isBinaryContent, redact, STREAMING_DIFF_ABSENT, STREAMING_DIFF_CAPTURE_LIMITS, STREAMING_DIFF_MISSING } from "./streaming-diff-capture.mjs";
import { identifierPathComponent, snapshotDirectory, streamingDiffIdentifier } from "./streaming-diff-feed.mjs";
import { fsyncDirectory, writeDurableAtomic, writeDurableExclusive } from "./streaming-diff-durable-write.mjs";
import { containedJoin, withRepoStateLock } from "../../../src/server/repo-state.mjs";

const SNAPSHOT_SCHEMA = 1;
const ACTIVE_WINDOW_SCHEMA = 1;
const ACTIVE_WINDOW_MAX_AGE_MS = 5 * 60_000;
export const STREAMING_DIFF_ACTIVE_WINDOW_MAX_ENTRIES = 128;
export const STREAMING_DIFF_ACTIVE_WINDOW_MAX_BYTES = 64 * 1024;
const ACTIVE_WINDOW_OVERFLOW_REASON = "attribution unavailable: too many concurrent windows";
const ACTIVE_WINDOW_READ_ERROR_REASON = "attribution unavailable: active-window registry unreadable";
const ACTIVE_WINDOW_EXPIRED_REASON = "attribution unavailable: active window expired before close";
export const STREAMING_DIFF_SNAPSHOT_MAX_BYTES = 512 * 1024;
const terminalReasons = new Set(["tool failed", "path hints truncated", "hook adapter mapping was incomplete", "hook payload exceeded byte limit", "hook payload read timed out"]);

export function streamingDiffToolUseId(value) {
  return streamingDiffIdentifier(value, "tool use id");
}

function safePath(path, limits) {
  return typeof path === "string" && path.length > 0 && path.length <= limits.maxPathLength && Buffer.byteLength(path, "utf8") <= limits.maxPathLength
    && !path.startsWith("/") && !path.includes("\\")
    && !path.split("/").some((part) => !part || part === "." || part === "..");
}

function hardDenied(path) {
  return path.split("/").some((part) => {
    const name = part.toLowerCase();
    return name === ".git" || name.startsWith(".env")
      || /(?:^|[._-])(?:key|keys|cert|certificate|credential|credentials|secret|secrets|password|token)(?:[._-]|$)/u.test(name)
      || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/u.test(name)
      || /\.(?:pem|p12|pfx|key|crt)$/u.test(name);
  });
}

function snapshotPath(identity, toolUseId) {
  return join(snapshotDirectory(identity), `${identifierPathComponent(toolUseId)}.json`);
}

function markerPath(identity, toolUseId, marker) {
  return join(snapshotDirectory(identity), `${identifierPathComponent(toolUseId)}.${marker}`);
}

function createMarker(identity, toolUseId, marker, value = "") {
  mkdirSync(snapshotDirectory(identity), { recursive: true, mode: 0o700 });
  return writeDurableExclusive(markerPath(identity, toolUseId, marker), value);
}

function readUnavailableMarker(identity, toolUseId) {
  try {
    const value = readFileSync(markerPath(identity, toolUseId, "unavailable"), "utf8");
    return { unavailable: true, reason: value.length <= 256 ? value || undefined : undefined };
  } catch (error) {
    return error?.code === "ENOENT" ? { unavailable: false } : { unavailable: true };
  }
}

function activeWindowPath(identity) {
  return containedJoin(identity.worktreeRoot, "streaming-diff-active-windows.json");
}

function readActiveWindows(path, now) {
  try {
    const stored = JSON.parse(readFileSync(path, "utf8"));
    if (stored?.schemaVersion !== ACTIVE_WINDOW_SCHEMA || !Array.isArray(stored.windows)) {
      return { windows: [], attributionUnavailableUntil: 0, unavailable: true, attributionUnavailableReason: ACTIVE_WINDOW_READ_ERROR_REASON };
    }
    const validWindow = (window) => window && typeof window === "object"
      && typeof window.session === "string" && typeof window.toolUseId === "string" && typeof window.path === "string"
      && Number.isFinite(window.openedAt)
      && (!Object.hasOwn(window, "overlappedPaths") || Array.isArray(window.overlappedPaths));
    if (!stored.windows.every(validWindow)) {
      return { windows: [], attributionUnavailableUntil: 0, unavailable: true, attributionUnavailableReason: ACTIVE_WINDOW_READ_ERROR_REASON };
    }
    return {
      windows: stored.windows.filter((window) => window.openedAt >= now - ACTIVE_WINDOW_MAX_AGE_MS),
      attributionUnavailableUntil: Number.isFinite(stored.attributionUnavailableUntil) && stored.attributionUnavailableUntil > now
        ? stored.attributionUnavailableUntil : 0,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { windows: [], attributionUnavailableUntil: 0 };
    return { windows: [], attributionUnavailableUntil: 0, unavailable: true, attributionUnavailableReason: ACTIVE_WINDOW_READ_ERROR_REASON };
  }
}

function activeWindowsPayload(windows, attributionUnavailableUntil = 0) {
  return {
    schemaVersion: ACTIVE_WINDOW_SCHEMA,
    windows,
    ...(attributionUnavailableUntil ? { attributionUnavailableUntil } : {}),
  };
}

function pruneActiveWindows(windows, now) {
  return windows
    .filter((window) => window.openedAt >= now - ACTIVE_WINDOW_MAX_AGE_MS)
    .sort((left, right) => left.openedAt - right.openedAt);
}

function activeWindowsFit(windows, attributionUnavailableUntil) {
  return windows.length <= STREAMING_DIFF_ACTIVE_WINDOW_MAX_ENTRIES
    && Buffer.byteLength(JSON.stringify(activeWindowsPayload(windows, attributionUnavailableUntil || Number.MAX_SAFE_INTEGER)), "utf8") <= STREAMING_DIFF_ACTIVE_WINDOW_MAX_BYTES;
}

function saveActiveWindows(path, windows, now, attributionUnavailableUntil = 0) {
  const pruned = pruneActiveWindows(windows, now);
  const unavailableUntil = attributionUnavailableUntil > now ? attributionUnavailableUntil : 0;
  if (!activeWindowsFit(pruned, unavailableUntil)) throw new Error(ACTIVE_WINDOW_OVERFLOW_REASON);
  if (pruned.length || unavailableUntil) writeDurableAtomic(path, JSON.stringify(activeWindowsPayload(pruned, unavailableUntil)));
  else {
    rmSync(path, { force: true });
    try { fsyncDirectory(dirname(path)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

// The registry deliberately lives under each physical worktree. Sessions from
// separate worktrees are isolated and can therefore be attributed normally.
export function registerActiveWindows({ identity, toolUseId, hintedPaths = [], openedAt } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  const paths = [...new Set(hintedPaths.filter((path) => typeof path === "string"))];
  return withRepoStateLock(identity.worktreeRoot, () => {
    const now = Number.isFinite(openedAt) ? openedAt : Date.now();
    const path = activeWindowPath(identity);
    const registry = readActiveWindows(path, now);
    if (registry.unavailable) {
      return { path, openedAt: now, attributionUnavailable: true, attributionUnavailableReason: registry.attributionUnavailableReason };
    }
    const windows = registry.windows;
    let attributionUnavailableUntil = registry.attributionUnavailableUntil;
    for (const hintedPath of paths) {
      if (!windows.some((window) => window.session === identity.session && window.toolUseId === safeId && window.path === hintedPath)) {
        const window = { session: identity.session, toolUseId: safeId, path: hintedPath, openedAt: now };
        if (activeWindowsFit([...windows, window], attributionUnavailableUntil)) windows.push(window);
        else attributionUnavailableUntil = Math.max(attributionUnavailableUntil, now + ACTIVE_WINDOW_MAX_AGE_MS);
      }
    }
    saveActiveWindows(path, windows, now, attributionUnavailableUntil);
    return { path, openedAt: now, attributionUnavailable: attributionUnavailableUntil > now };
  });
}

function activeWindowOverlap(windows, identity, toolUseId) {
  const mine = windows.filter((window) => window.session === identity.session && window.toolUseId === toolUseId);
  const paths = new Set(mine.flatMap((window) => window.overlappedPaths ?? []));
  for (const window of mine) {
    for (const other of windows) {
      if ((other.session === identity.session && other.toolUseId === toolUseId) || other.path !== window.path) continue;
      paths.add(window.path);
    }
  }
  return { mine, paths };
}

export function inspectActiveWindowOverlap({ identity, toolUseId, inspectedAt } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  return withRepoStateLock(identity.worktreeRoot, () => {
    const now = Number.isFinite(inspectedAt) ? inspectedAt : Date.now();
    const registry = readActiveWindows(activeWindowPath(identity), now);
    if (registry.unavailable) {
      return { paths: [], attributionUnavailable: true, attributionUnavailableReason: registry.attributionUnavailableReason };
    }
    const overlap = activeWindowOverlap(registry.windows, identity, safeId);
    return { paths: [...overlap.paths], attributionUnavailable: registry.attributionUnavailableUntil > now };
  });
}

export function closeActiveWindows({ identity, toolUseId, closedAt } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  return withRepoStateLock(identity.worktreeRoot, () => {
    const now = Number.isFinite(closedAt) ? closedAt : Date.now();
    const path = activeWindowPath(identity);
    const registry = readActiveWindows(path, now);
    if (registry.unavailable) {
      return { paths: [], closed: false, attributionUnavailable: true, attributionUnavailableReason: registry.attributionUnavailableReason };
    }
    const windows = registry.windows;
    const overlap = activeWindowOverlap(windows, identity, safeId);
    const peers = new Map();
    for (const window of overlap.mine) {
      for (const other of windows) {
        if ((other.session === identity.session && other.toolUseId === safeId) || other.path !== window.path) continue;
        const overlaps = new Set(other.overlappedPaths ?? []);
        overlaps.add(other.path);
        other.overlappedPaths = [...overlaps];
        peers.set(`${other.session}\u0000${other.toolUseId}`, other);
      }
    }
    const remaining = windows.filter((window) => window.session !== identity.session || window.toolUseId !== safeId);
    for (const peer of peers.values()) {
      const peerIdentity = { ...identity, session: peer.session, sessionPath: identifierPathComponent(peer.session) };
      if (peerIdentity.logicalRepoRoot === identity.worktreeRoot) markPreSnapshotOverlappedLocked(peerIdentity, peer.toolUseId);
      else markPreSnapshotOverlapped({ identity: peerIdentity, toolUseId: peer.toolUseId });
    }
    try {
      saveActiveWindows(path, remaining, now, registry.attributionUnavailableUntil);
      const closed = overlap.mine.length > 0;
      const registryUnavailable = registry.attributionUnavailableUntil > now;
      return {
        paths: [...overlap.paths],
        closed,
        attributionUnavailable: registryUnavailable,
        ...(registryUnavailable
          ? { attributionUnavailableReason: ACTIVE_WINDOW_OVERFLOW_REASON }
          : !closed ? { attributionUnavailableReason: ACTIVE_WINDOW_EXPIRED_REASON } : {}),
      };
    } catch (error) {
      if (error?.message !== ACTIVE_WINDOW_OVERFLOW_REASON) throw error;
      const withoutNewOverlapMarks = registry.windows
        .filter((window) => window.session !== identity.session || window.toolUseId !== safeId)
        .map(({ overlappedPaths, ...window }) => window);
      saveActiveWindows(path, withoutNewOverlapMarks, now, now + ACTIVE_WINDOW_MAX_AGE_MS);
      return { paths: [...overlap.paths], closed: overlap.mine.length > 0, attributionUnavailable: true, attributionUnavailableReason: ACTIVE_WINDOW_OVERFLOW_REASON };
    }
  });
}

function encode(value) {
  if (value === STREAMING_DIFF_ABSENT) return { kind: "absent" };
  if (value === STREAMING_DIFF_MISSING) return { kind: "missing" };
  if (value?.truncated === true) return { kind: "truncated", bytes: value.bytes };
  if (Buffer.isBuffer(value)) {
    if (isBinaryContent(value)) return { kind: "binary", bytes: value.length };
    const redacted = redact(value.toString("utf8"));
    return redacted.redacted || redacted.marker ? { kind: "missing" } : { kind: "text", text: redacted.text };
  }
  if (typeof value === "string") {
    const redacted = redact(value);
    return redacted.redacted || redacted.marker ? { kind: "missing" } : { kind: "text", text: redacted.text };
  }
  return { kind: "missing" };
}

function decode(entry) {
  if (!entry || typeof entry !== "object") return STREAMING_DIFF_MISSING;
  if (entry.kind === "absent") return STREAMING_DIFF_ABSENT;
  if (entry.kind === "missing") return STREAMING_DIFF_MISSING;
  if (entry.kind === "binary" && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0) return { binary: true, bytes: entry.bytes };
  if (entry.kind === "text" && typeof entry.text === "string") return entry.text;
  if (entry.kind === "truncated" && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0) return { truncated: true, bytes: entry.bytes };
  return STREAMING_DIFF_MISSING;
}

function validStoredSnapshot(value, toolUseId) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.schemaVersion === SNAPSHOT_SCHEMA && value.toolUseId === toolUseId
    && Array.isArray(value.hintedPaths) && value.hintedPaths.every((path) => typeof path === "string")
    && (!Object.hasOwn(value, "terminalReason") || typeof value.terminalReason === "string")
    && value.entries && typeof value.entries === "object" && !Array.isArray(value.entries);
}

export function writePreSnapshot({ identity, toolUseId, hintedPaths = [], terminalReason, policy = {} } = {}) {
  const limits = captureLimits(policy);
  const safeId = streamingDiffToolUseId(toolUseId);
  const unique = [...new Set(Array.isArray(hintedPaths) ? hintedPaths : [])].slice(0, limits.maxPaths);
  const entries = {};
  const io = createGitCaptureIo(identity.worktreeRoot, limits);
  const safeHints = unique.filter((path) => safePath(path, limits));
  const candidates = safeHints.filter((path) => !hardDenied(path));
  let tracked = new Set();
  try {
    tracked = new Set(io.listTracked(candidates));
  } catch {
    // Without a trustworthy tracked classification, fail closed rather than
    // accidentally retaining an ignored path in the local snapshot.
    candidates.length = 0;
  }
  for (const path of candidates) {
    try {
      const info = io.inspect(path);
      if (info.type && info.type !== "file" || info.contained === false || info.symlinkEscape === true || (!tracked.has(path) && io.isIgnored(path))) continue;
      entries[path] = encode(io.readPost(path));
    } catch {
      entries[path] = { kind: "missing" };
    }
  }
  const path = snapshotPath(identity, safeId);
  if (existsSync(path)) {
    const existing = takePreSnapshot({ identity, toolUseId: safeId });
    return { path, hintedPaths: existing.found ? existing.hintedPaths : safeHints };
  }
  const record = {
    schemaVersion: SNAPSHOT_SCHEMA,
    toolUseId: safeId,
    hintedPaths: safeHints,
    ...(terminalReasons.has(terminalReason) ? { terminalReason } : {}),
    entries,
  };
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, "utf8") > STREAMING_DIFF_SNAPSHOT_MAX_BYTES) throw new Error(`snapshot exceeds its ${STREAMING_DIFF_SNAPSHOT_MAX_BYTES}-byte limit`);
  const dir = snapshotDirectory(identity);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!writeDurableExclusive(path, serialized)) {
    const existing = takePreSnapshot({ identity, toolUseId: safeId });
    return { path, hintedPaths: existing.found ? existing.hintedPaths : record.hintedPaths };
  }
  return { path, hintedPaths: record.hintedPaths };
}

// A post hook reads this immutable pre-state before publication. It is deleted
// only after a durable terminal card, so a failed append can safely retry.
export function takePreSnapshot({ identity, toolUseId } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  const path = snapshotPath(identity, safeId);
  let parsed = null;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > STREAMING_DIFF_SNAPSHOT_MAX_BYTES) throw new Error(`snapshot exceeds its ${STREAMING_DIFF_SNAPSHOT_MAX_BYTES}-byte limit`);
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch { return unavailableSnapshot(); }
  if (!validStoredSnapshot(parsed, safeId)) return unavailableSnapshot();
  const unavailable = readUnavailableMarker(identity, safeId);
  return {
    found: true,
    hintedPaths: parsed.hintedPaths,
    registered: existsSync(markerPath(identity, safeId, "registered")),
    overlapped: existsSync(markerPath(identity, safeId, "overlapped")),
    attributionUnavailable: unavailable.unavailable,
    attributionUnavailableReason: unavailable.reason,
    terminalReason: parsed.terminalReason,
    preSnapshot: new Map(parsed.hintedPaths.map((path) => [path, decode(parsed.entries[path])])),
  };
}

function unavailableSnapshot() {
  return {
    found: false,
    hintedPaths: [],
    registered: false,
    attributionUnavailable: true,
    attributionUnavailableReason: "attribution unavailable: pre-snapshot unreadable",
    preSnapshot: new Map(),
  };
}

function markPreSnapshotOverlappedLocked(identity, safeId) {
  const found = existsSync(snapshotPath(identity, safeId));
  if (found) createMarker(identity, safeId, "overlapped");
  return { found, overlapped: found };
}

export function markPreSnapshotOverlapped({ identity, toolUseId } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  return markPreSnapshotOverlappedLocked(identity, safeId);
}

export function markPreSnapshotAttributionUnavailable({ identity, toolUseId, reason } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  const found = existsSync(snapshotPath(identity, safeId));
  if (found) createMarker(identity, safeId, "unavailable", typeof reason === "string" ? reason.slice(0, 256) : "");
  return { found, attributionUnavailable: found };
}

export function markPreSnapshotRegistered({ identity, toolUseId } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  const found = existsSync(snapshotPath(identity, safeId));
  if (found) createMarker(identity, safeId, "registered");
  return { found, registered: found, overlapped: found && existsSync(markerPath(identity, safeId, "overlapped")) };
}

export function removePreSnapshot({ identity, toolUseId } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  const path = snapshotPath(identity, safeId);
  for (const marker of ["registered", "overlapped", "unavailable"]) rmSync(markerPath(identity, safeId, marker), { force: true });
  rmSync(path, { force: true });
  try { fsyncDirectory(dirname(path)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
