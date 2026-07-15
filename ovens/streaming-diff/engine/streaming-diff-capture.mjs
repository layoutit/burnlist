import { randomBytes } from "node:crypto";

import { assertCard } from "./streaming-diff-data-contract.mjs";
import { unifiedLineDiff } from "./streaming-diff-linediff.mjs";

export const STREAMING_DIFF_ABSENT = Symbol("streaming-diff-absent");
// Missing means the pre-hook did not obtain a snapshot; it is deliberately not
// interchangeable with an observed absent file.
export const STREAMING_DIFF_MISSING = Symbol("streaming-diff-missing");
export const STREAMING_DIFF_CAPTURE_LIMITS = Object.freeze({
  maxPaths: 64,
  maxPathLength: 512,
  maxFileBytes: 256 * 1024,
  maxHunkBytes: 96 * 1024,
  maxCardBytes: 512 * 1024,
});
const incompleteFileKinds = new Set(["binary", "denied", "redacted", "truncated", "unavailable"]);
const terminalReasons = new Set(["tool failed", "path hints truncated", "hook adapter mapping was incomplete", "hook payload exceeded byte limit", "hook payload read timed out"]);

export function captureLimits(policy = {}) {
  const limits = {};
  for (const [key, maximum] of Object.entries(STREAMING_DIFF_CAPTURE_LIMITS)) {
    const value = policy[key];
    if (value === undefined) limits[key] = maximum;
    else {
      if (!Number.isSafeInteger(value)) throw new Error(`capture ${key} must be a finite integer`);
      limits[key] = Math.max(1, Math.min(maximum, value));
    }
  }
  return limits;
}

function pathIsSafe(path, maxPathLength) {
  return typeof path === "string" && path.length > 0 && path.length <= maxPathLength
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

function contentOf(value) {
  if (value === STREAMING_DIFF_MISSING) return { missing: true };
  if (value === null || value === undefined || value === STREAMING_DIFF_ABSENT) return { absent: true };
  if (typeof value === "string" || Buffer.isBuffer(value)) return { content: value };
  if (typeof value === "object" && value !== null) {
    if (value.truncated === true) return { truncated: true, bytes: value.bytes };
    if (value.binary === true && Number.isSafeInteger(value.bytes) && value.bytes >= 0) return { binary: true, bytes: value.bytes };
    if (value.content === STREAMING_DIFF_ABSENT) return { absent: true };
    if (typeof value.content === "string" || Buffer.isBuffer(value.content)) return value;
  }
  throw new Error("content reader returned an unsupported value");
}

function bytesOf(value) {
  return Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value, "utf8");
}

export function isBinaryContent(value) {
  if (!Buffer.isBuffer(value)) return false;
  if (value.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(value);
    return false;
  } catch {
    return true;
  }
}

export function redact(value) {
  const text = String(value);
  if (/-----BEGIN\s+(?:[A-Z ]+\s+)?PRIVATE\s+KEY-----/u.test(text)) return { marker: "private-key content", redacted: true };
  let redacted = false;
  // Redact the whole value portion to end-of-line. Never try to preserve quoted
  // structure — a value-shaped sub-match leaves fragments (e.g. an escaped quote)
  // exposed. Over-redaction of a trailing benign token is an accepted trade-off.
  let result = text.replace(/\b((?:proxy-)?authorization)\b(\s*[:=]\s*)((?:bearer|token)\s+)?[^\n]*/giu, (match, header, separator, scheme) => {
    redacted = true;
    return `${header}${separator}${scheme ?? ""}[REDACTED]`;
  });
  result = result.replace(/\b(api[_-]?key|key|secret|token|password|passwd)\b(\s*[:=]\s*)[^\n]*/giu, (match, keyword, separator) => {
    redacted = true;
    return `${keyword}${separator}[REDACTED]`;
  });
  result = result.replace(/\bBearer\s+[^\n]*/giu, () => {
    redacted = true;
    return "Bearer [REDACTED]";
  });
  result = result.replace(/[A-Za-z0-9+/_=-]{32,}/gu, (candidate) => {
    const classes = new Set(candidate.replaceAll(/[^A-Za-z0-9]/gu, "").split("")).size;
    if (classes < 12) return candidate;
    redacted = true;
    return "[REDACTED]";
  });
  return { text: result, redacted };
}

function partialReason(reasons) {
  return [...new Set(reasons)].join("; ").slice(0, 500) || "capture was incomplete";
}

function snapshotValue(snapshot, path) {
  if (snapshot instanceof Map) return snapshot.has(path) ? snapshot.get(path) : STREAMING_DIFF_MISSING;
  return Object.hasOwn(snapshot ?? {}, path) ? snapshot[path] : STREAMING_DIFF_MISSING;
}

function revisionId() {
  return `r-${randomBytes(12).toString("hex")}`;
}

function metadata(path, kind, reason, bytes) {
  return { path, kind, meta: { ...(bytes === undefined ? {} : { bytes }), ...(reason === undefined ? {} : { reason }) } };
}

// This synchronous core deliberately has no filesystem writes. IO is injected as
// inspect(path), readPost(path), listTracked(paths), isIgnored(path), and
// listUntracked(hintedPaths). Ignore rules apply only after tracked status.
export function captureCard({
  hintedPaths,
  preSnapshot = new Map(),
  readPost,
  listTracked = () => [],
  listUntracked = () => [],
  inspect = () => ({ type: "file", contained: true }),
  isIgnored = () => false,
  policy = {},
  toolUseId,
  now = () => new Date().toISOString(),
  revId = revisionId(),
  opaqueReason = null,
} = {}) {
  const limits = captureLimits(policy);
  const reasons = [];
  const files = [];
  if (typeof readPost !== "function") throw new Error("capture requires a post-content reader");
  if (typeof toolUseId !== "string" || !toolUseId.trim()) throw new Error("capture requires a toolUseId");
  if (!Array.isArray(hintedPaths) || hintedPaths.length === 0) reasons.push("missing path hints");
  const safeHints = [...new Set(Array.isArray(hintedPaths) ? hintedPaths : [])];
  if (safeHints.length > limits.maxPaths) reasons.push("path hint limit exceeded");
  const eligible = [];
  for (const path of safeHints.slice(0, limits.maxPaths)) {
    if (!pathIsSafe(path, limits.maxPathLength)) {
      reasons.push("unsafe path hint");
      continue;
    }
    if (hardDenied(path)) {
      files.push({ path, kind: "denied" });
      continue;
    }
    let info;
    try {
      info = inspect(path) ?? {};
    } catch {
      reasons.push(`could not inspect ${path}`);
      continue;
    }
    if (info.type && info.type !== "file") {
      files.push(metadata(path, "denied", "not a regular contained file"));
    } else if (info.contained === false || info.symlinkEscape === true) {
      files.push(metadata(path, "denied", "path escapes the worktree"));
    } else {
      eligible.push(path);
    }
  }
  const readable = [];
  let tracked = new Set();
  try {
    tracked = new Set([...new Set(listTracked(eligible))].filter((path) => eligible.includes(path)));
  } catch {
    reasons.push("tracked eligibility was unavailable");
  }
  for (const path of eligible) {
    try {
      if (tracked.has(path)) readable.push(path);
      else if (isIgnored(path)) files.push({ path, kind: "denied" });
      else readable.push(path);
    } catch {
      reasons.push(`could not determine whether ${path} is ignored`);
    }
  }
  let untracked = new Set();
  try {
    const allowed = new Set(readable);
    untracked = new Set([...new Set(listUntracked(readable))].filter((path) => allowed.has(path)));
  } catch {
    reasons.push("untracked eligibility was unavailable");
  }
  for (const path of readable) {
    let before;
    let after;
    try {
      before = contentOf(snapshotValue(preSnapshot, path));
      after = contentOf(readPost(path));
    } catch {
      reasons.push(`could not read ${path}`);
      continue;
    }
    if (before.missing) {
      files.push(metadata(path, "unavailable", "snapshot unavailable"));
      reasons.push("snapshot unavailable");
      continue;
    }
    if (after.missing) {
      files.push(metadata(path, "unavailable", "post-capture unavailable"));
      reasons.push("post-capture unavailable");
      continue;
    }
    if (before.absent && after.absent) continue;
    if (before.absent && !tracked.has(path) && !untracked.has(path)) {
      reasons.push(`new path ${path} was not eligible untracked content`);
      continue;
    }
    const known = [before, after].filter((entry) => !entry.absent && !entry.truncated && !entry.binary);
    const largest = Math.max(0, ...known.map((entry) => bytesOf(entry.content)), before.bytes ?? 0, after.bytes ?? 0);
    if (before.truncated || after.truncated || largest > limits.maxFileBytes) {
      files.push(metadata(path, "truncated", "file byte limit exceeded", largest));
      reasons.push("file byte limit exceeded");
      continue;
    }
    if (before.binary || after.binary || known.some((entry) => isBinaryContent(entry.content))) {
      files.push(metadata(path, "binary", undefined, largest));
      continue;
    }
    const rawBefore = before.absent ? "" : String(before.content);
    const rawAfter = after.absent ? "" : String(after.content);
    if (rawBefore === rawAfter) continue;
    const safeBefore = before.absent ? { text: "", redacted: false } : redact(before.content);
    const safeAfter = after.absent ? { text: "", redacted: false } : redact(after.content);
    if (safeBefore.marker || safeAfter.marker || (rawBefore !== rawAfter && (safeBefore.redacted || safeAfter.redacted))) {
      files.push({ path, kind: "redacted", meta: { redacted: true, reason: safeBefore.marker ?? safeAfter.marker ?? "secret-looking value" } });
      continue;
    }
    if (safeBefore.text === safeAfter.text) continue;
    let diff;
    try {
      diff = unifiedLineDiff(path, safeBefore.text, safeAfter.text);
    } catch (error) {
      if (error instanceof RangeError) {
        files.push(metadata(path, "truncated", "line diff limit exceeded", largest));
        reasons.push("line diff limit exceeded");
        continue;
      }
      throw error;
    }
    const diffBytes = Buffer.byteLength(diff, "utf8");
    if (diffBytes > limits.maxHunkBytes) {
      files.push(metadata(path, "truncated", "hunk byte limit exceeded", diffBytes));
      reasons.push("hunk byte limit exceeded");
      continue;
    }
    files.push({ path, kind: before.absent ? "added" : after.absent ? "deleted" : "modified", diff });
  }
  for (const reason of typeof opaqueReason === "string" ? opaqueReason.split("; ") : []) {
    if (terminalReasons.has(reason)) reasons.push(reason);
  }
  if (files.some((file) => incompleteFileKinds.has(file.kind))) reasons.push("content withheld/incomplete");
  const card = { revId, toolUseId, ts: now(), status: reasons.length ? "partial" : "captured", ...(reasons.length ? { partialReason: partialReason(reasons) } : {}), files };
  if (Buffer.byteLength(JSON.stringify(card), "utf8") > limits.maxCardBytes) {
    card.status = "partial";
    card.partialReason = "card byte limit exceeded";
    card.files = files.map((file) => metadata(file.path, "truncated", "card byte limit exceeded"));
  }
  return assertCard(card);
}
