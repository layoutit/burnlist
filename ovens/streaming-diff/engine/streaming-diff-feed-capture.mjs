import { randomBytes } from "node:crypto";

import { captureGitCard } from "./streaming-diff-capture-git.mjs";
import { appendCard } from "./streaming-diff-journal.mjs";
import { ensureStreamingDiffFeed } from "./streaming-diff-ensure-feed.mjs";
import { feedIdentity, resolveStreamingDiffIdentity } from "./streaming-diff-feed.mjs";
import { closeActiveWindows, inspectActiveWindowOverlap, markPreSnapshotAttributionUnavailable, markPreSnapshotOverlapped, markPreSnapshotRegistered, registerActiveWindows, removePreSnapshot, streamingDiffToolUseId, takePreSnapshot, writePreSnapshot } from "./streaming-diff-snapshot-store.mjs";

const TERMINAL_REASONS = Object.freeze({
  "adapter-incomplete": "hook adapter mapping was incomplete",
  "path-hints-truncated": "path hints truncated",
  "tool-failed": "tool failed",
  "payload-too-large": "hook payload exceeded byte limit",
  "payload-read-timed-out": "hook payload read timed out",
});

function terminalReason(code) {
  return typeof code === "string" ? TERMINAL_REASONS[code] ?? null : null;
}

function attemptCard(toolUseId, terminalReasonCode) {
  const reason = terminalReason(terminalReasonCode);
  return {
    revId: `r-${randomBytes(12).toString("hex")}`,
    toolUseId,
    ts: new Date().toISOString(),
    status: "partial",
    partialReason: ["attempt in progress / unterminated", reason].filter(Boolean).join("; "),
    files: [],
  };
}

function appendWithRetry(append, feedDir, card, options) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return append(feedDir, card, options);
    } catch (error) {
      if (error?.code !== "ELOCKED" || attempt === 7) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(5 * (attempt + 1), 25));
    }
  }
  throw new Error("streaming diff journal retry unexpectedly exhausted");
}

const ACTIVE_WINDOW_LOCK_REASON = "attribution unavailable: active-window lock timed out";

function activeWindowOperation(operation) {
  try {
    return operation();
  } catch (error) {
    if (error?.code !== "ELOCKED") throw error;
    return { paths: [], attributionUnavailable: true, attributionUnavailableReason: ACTIVE_WINDOW_LOCK_REASON };
  }
}

function markUnattributedOverlap(card, paths, attributionUnavailable, overlapDetected, attributionUnavailableReason) {
  if (!paths.length && !attributionUnavailable && !overlapDetected) return card;
  const reason = attributionUnavailable ? attributionUnavailableReason ?? "attribution unavailable: too many concurrent windows" : "overlapping concurrent edit (unattributed)";
  const overlapped = new Set(attributionUnavailable ? card.files.map((file) => file.path) : paths);
  return {
    ...card,
    status: "partial",
    partialReason: [card.partialReason, reason].filter(Boolean).join("; "),
    files: card.files.map((file) => overlapped.has(file.path)
      ? { path: file.path, kind: "unavailable", meta: { reason } }
      : file),
  };
}

export function captureStreamingDiff({ cwd = process.cwd(), session, toolUseId: rawToolUseId, phase, hintedPaths = [], terminalReason: terminalReasonCode, policy, append = appendCard, activeWindows } = {}) {
  if (phase !== "pre" && phase !== "post") throw new Error("streaming diff capture phase must be pre or post");
  const identity = resolveStreamingDiffIdentity({ cwd, session });
  const safeToolUseId = streamingDiffToolUseId(rawToolUseId);
  const journalOptions = { identity: feedIdentity(identity) };
  const windows = activeWindows ?? { closeActiveWindows, inspectActiveWindowOverlap, registerActiveWindows };
  if (phase === "pre") {
    ensureStreamingDiffFeed({ cwd, session });
    const marker = appendWithRetry(append, identity.feedDir, attemptCard(safeToolUseId, terminalReasonCode), { ...journalOptions, dedupeToolUseId: true });
    const snapshot = writePreSnapshot({ identity, toolUseId: safeToolUseId, hintedPaths, terminalReason: terminalReason(terminalReasonCode), policy });
    const activeWindow = activeWindowOperation(() => {
      const registered = windows.registerActiveWindows({ identity, toolUseId: safeToolUseId, hintedPaths: snapshot.hintedPaths });
      if (registered.attributionUnavailable) return registered;
      const inspected = windows.inspectActiveWindowOverlap({ identity, toolUseId: safeToolUseId });
      return {
        ...registered,
        paths: inspected.paths ?? [],
        attributionUnavailable: inspected.attributionUnavailable,
        attributionUnavailableReason: inspected.attributionUnavailableReason,
      };
    });
    if (activeWindow.attributionUnavailable) {
      markPreSnapshotAttributionUnavailable({ identity, toolUseId: safeToolUseId, reason: activeWindow.attributionUnavailableReason });
    } else {
      markPreSnapshotRegistered({ identity, toolUseId: safeToolUseId, overlapped: activeWindow.paths.length > 0 });
    }
    return { phase, identity, marker, snapshot, activeWindow };
  }
  const snapshot = takePreSnapshot({ identity, toolUseId: safeToolUseId });
  const paths = snapshot.found ? snapshot.hintedPaths : hintedPaths;
  let card = captureGitCard({
    worktreeRoot: identity.worktreeRoot,
    hintedPaths: paths,
    preSnapshot: snapshot.preSnapshot,
    toolUseId: safeToolUseId,
    policy,
    opaqueReason: [snapshot.terminalReason, terminalReason(terminalReasonCode)].find(Boolean),
  });
  const inspected = activeWindowOperation(() => windows.inspectActiveWindowOverlap({ identity, toolUseId: safeToolUseId }));
  const closed = activeWindowOperation(() => windows.closeActiveWindows({ identity, toolUseId: safeToolUseId }));
  const overlap = {
    paths: [...new Set([...(inspected.paths ?? []), ...(closed.paths ?? [])])],
    attributionUnavailable: inspected.attributionUnavailable || closed.attributionUnavailable,
    attributionUnavailableReason: inspected.attributionUnavailableReason ?? closed.attributionUnavailableReason,
  };
  const liveOverlap = overlap.paths.length > 0 || overlap.attributionUnavailable;
  if (overlap.paths.length) markPreSnapshotOverlapped({ identity, toolUseId: safeToolUseId });
  if (overlap.attributionUnavailable) {
    activeWindowOperation(() => markPreSnapshotAttributionUnavailable({ identity, toolUseId: safeToolUseId, reason: overlap.attributionUnavailableReason }));
  }
  const durableOverlap = snapshot.overlapped || liveOverlap;
  const attributionUnavailable = snapshot.registered === false || snapshot.attributionUnavailable || overlap.attributionUnavailable;
  card = markUnattributedOverlap(
    card,
    overlap.paths.length ? overlap.paths : durableOverlap ? card.files.map((file) => file.path) : [],
    attributionUnavailable,
    durableOverlap,
    overlap.attributionUnavailableReason ?? snapshot.attributionUnavailableReason
      ?? (snapshot.registered === false && !overlap.attributionUnavailable ? ACTIVE_WINDOW_LOCK_REASON : undefined),
  );
  // A direct post invocation remains safe and useful: it establishes the
  // immutable binding/feed before the journal's first manifest append.
  ensureStreamingDiffFeed({ cwd, session });
  try {
    const appended = appendWithRetry(append, identity.feedDir, card, journalOptions);
    try {
      removePreSnapshot({ identity, toolUseId: safeToolUseId });
      return { phase, identity, snapshot, ...appended };
    } catch (cleanupError) {
      return { phase, identity, snapshot, ...appended, cleanupError };
    }
  } catch (error) {
    return { phase, identity, snapshot, card, error };
  }
}
