import { randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createGitCaptureIo } from "./streaming-diff-capture-git.mjs";
import { captureLimits, isBinaryContent, redact, STREAMING_DIFF_ABSENT, STREAMING_DIFF_CAPTURE_LIMITS, STREAMING_DIFF_MISSING } from "./streaming-diff-capture.mjs";
import { identifierPathComponent, snapshotDirectory, streamingDiffIdentifier } from "./streaming-diff-feed.mjs";
import { containedJoin, withRepoStateLock } from "../../../src/server/repo-state.mjs";

const SNAPSHOT_SCHEMA = 1;
const ACTIVE_WINDOW_SCHEMA = 1;
const ACTIVE_WINDOW_MAX_AGE_MS = 5 * 60_000;
export const STREAMING_DIFF_ACTIVE_WINDOW_MAX_ENTRIES = 128;
export const STREAMING_DIFF_ACTIVE_WINDOW_MAX_BYTES = 64 * 1024;
const ACTIVE_WINDOW_OVERFLOW_REASON = "attribution unavailable: too many concurrent windows";
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

function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeDurableAtomic(path, value) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, value);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function snapshotPath(identity, toolUseId) {
  return join(snapshotDirectory(identity), `${identifierPathComponent(toolUseId)}.json`);
}

function activeWindowPath(identity) {
  return containedJoin(identity.worktreeRoot, "streaming-diff-active-windows.json");
}

function readActiveWindows(path, now) {
  try {
    const stored = JSON.parse(readFileSync(path, "utf8"));
    if (stored?.schemaVersion !== ACTIVE_WINDOW_SCHEMA || !Array.isArray(stored.windows)) return { windows: [], attributionUnavailableUntil: 0 };
    return {
      windows: stored.windows.filter((window) => window && typeof window === "object"
      && typeof window.session === "string" && typeof window.toolUseId === "string" && typeof window.path === "string"
      && Number.isFinite(window.openedAt) && window.openedAt <= now && window.openedAt >= now - ACTIVE_WINDOW_MAX_AGE_MS
      && (!Object.hasOwn(window, "overlappedPaths") || Array.isArray(window.overlappedPaths))),
      attributionUnavailableUntil: Number.isFinite(stored.attributionUnavailableUntil) && stored.attributionUnavailableUntil > now
        ? stored.attributionUnavailableUntil : 0,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { windows: [], attributionUnavailableUntil: 0 };
    return { windows: [], attributionUnavailableUntil: 0 };
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
    .filter((window) => window.openedAt <= now && window.openedAt >= now - ACTIVE_WINDOW_MAX_AGE_MS)
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
export function registerActiveWindows({ identity, toolUseId, hintedPaths = [], openedAt = Date.now() } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  const paths = [...new Set(hintedPaths.filter((path) => typeof path === "string"))];
  return withRepoStateLock(identity.worktreeRoot, () => {
    const path = activeWindowPath(identity);
    const registry = readActiveWindows(path, openedAt);
    const windows = registry.windows;
    let attributionUnavailableUntil = registry.attributionUnavailableUntil;
    for (const hintedPath of paths) {
      if (!windows.some((window) => window.session === identity.session && window.toolUseId === safeId && window.path === hintedPath)) {
        const window = { session: identity.session, toolUseId: safeId, path: hintedPath, openedAt };
        if (activeWindowsFit([...windows, window], attributionUnavailableUntil)) windows.push(window);
        else attributionUnavailableUntil = Math.max(attributionUnavailableUntil, openedAt + ACTIVE_WINDOW_MAX_AGE_MS);
      }
    }
    saveActiveWindows(path, windows, openedAt, attributionUnavailableUntil);
    return { path, openedAt, attributionUnavailable: attributionUnavailableUntil > openedAt };
  });
}

export function closeActiveWindows({ identity, toolUseId, closedAt = Date.now() } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  return withRepoStateLock(identity.worktreeRoot, () => {
    const path = activeWindowPath(identity);
    const registry = readActiveWindows(path, closedAt);
    const windows = registry.windows;
    const mine = windows.filter((window) => window.session === identity.session && window.toolUseId === safeId);
    const unattributed = new Set(mine.flatMap((window) => window.overlappedPaths ?? []));
    for (const window of mine) {
      for (const other of windows) {
        if (other.session === identity.session || other.path !== window.path) continue;
        unattributed.add(window.path);
        const overlaps = new Set(other.overlappedPaths ?? []);
        overlaps.add(other.path);
        other.overlappedPaths = [...overlaps];
      }
    }
    const remaining = windows.filter((window) => window.session !== identity.session || window.toolUseId !== safeId);
    saveActiveWindows(path, remaining, closedAt, registry.attributionUnavailableUntil);
    return { paths: [...unattributed], attributionUnavailable: registry.attributionUnavailableUntil > closedAt };
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
  const record = {
    schemaVersion: SNAPSHOT_SCHEMA,
    toolUseId: safeId,
    hintedPaths: safeHints,
    ...(terminalReasons.has(terminalReason) ? { terminalReason } : {}),
    entries,
  };
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, "utf8") > STREAMING_DIFF_SNAPSHOT_MAX_BYTES) throw new Error(`snapshot exceeds its ${STREAMING_DIFF_SNAPSHOT_MAX_BYTES}-byte limit`);
  return withRepoStateLock(identity.logicalRepoRoot, () => {
    const dir = snapshotDirectory(identity);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeDurableAtomic(snapshotPath(identity, safeId), serialized);
    return { path: snapshotPath(identity, safeId), hintedPaths: record.hintedPaths };
  });
}

// A post hook reads this immutable pre-state before publication. It is deleted
// only after a durable terminal card, so a failed append can safely retry.
export function takePreSnapshot({ identity, toolUseId } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  return withRepoStateLock(identity.logicalRepoRoot, () => {
    const path = snapshotPath(identity, safeId);
    let parsed = null;
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > STREAMING_DIFF_SNAPSHOT_MAX_BYTES) throw new Error(`snapshot exceeds its ${STREAMING_DIFF_SNAPSHOT_MAX_BYTES}-byte limit`);
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return { found: false, hintedPaths: [], preSnapshot: new Map() };
      if (/snapshot exceeds/u.test(error?.message)) throw error;
      parsed = null;
    }
    if (!validStoredSnapshot(parsed, safeId)) return { found: false, hintedPaths: [], preSnapshot: new Map() };
    return {
      found: true,
      hintedPaths: parsed.hintedPaths,
      terminalReason: parsed.terminalReason,
      preSnapshot: new Map(parsed.hintedPaths.map((path) => [path, decode(parsed.entries[path])])),
    };
  });
}

export function removePreSnapshot({ identity, toolUseId } = {}) {
  const safeId = streamingDiffToolUseId(toolUseId);
  return withRepoStateLock(identity.logicalRepoRoot, () => {
    const path = snapshotPath(identity, safeId);
    rmSync(path, { force: true });
    try { fsyncDirectory(dirname(path)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  });
}
