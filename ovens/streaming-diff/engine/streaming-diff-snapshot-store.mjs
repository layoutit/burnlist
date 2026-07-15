import { randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createGitCaptureIo } from "./streaming-diff-capture-git.mjs";
import { redact, STREAMING_DIFF_ABSENT, STREAMING_DIFF_CAPTURE_LIMITS, STREAMING_DIFF_MISSING } from "./streaming-diff-capture.mjs";
import { identifierPathComponent, snapshotDirectory, streamingDiffIdentifier } from "./streaming-diff-feed.mjs";
import { withRepoStateLock } from "../../../src/server/repo-state.mjs";

const SNAPSHOT_SCHEMA = 1;
export const STREAMING_DIFF_SNAPSHOT_MAX_BYTES = 512 * 1024;

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
    return name.startsWith(".env")
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

function encode(value) {
  if (value === STREAMING_DIFF_ABSENT) return { kind: "absent" };
  if (value === STREAMING_DIFF_MISSING) return { kind: "missing" };
  if (value?.truncated === true) return { kind: "truncated", bytes: value.bytes };
  if (Buffer.isBuffer(value)) {
    if (value.includes(0)) return { kind: "missing" };
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
  const limits = { ...STREAMING_DIFF_CAPTURE_LIMITS, ...policy };
  const safeId = streamingDiffToolUseId(toolUseId);
  const unique = [...new Set(Array.isArray(hintedPaths) ? hintedPaths : [])].slice(0, limits.maxPaths);
  const entries = {};
  const io = createGitCaptureIo(identity.worktreeRoot, limits);
  const candidates = unique.filter((path) => safePath(path, limits) && !hardDenied(path));
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
    hintedPaths: Object.keys(entries),
    ...(typeof terminalReason === "string" && terminalReason ? { terminalReason: terminalReason.slice(0, 500) } : {}),
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
