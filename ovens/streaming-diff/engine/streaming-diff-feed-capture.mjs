import { randomBytes } from "node:crypto";

import { captureGitCard } from "./streaming-diff-capture-git.mjs";
import { appendCard } from "./streaming-diff-journal.mjs";
import { ensureStreamingDiffFeed } from "./streaming-diff-ensure-feed.mjs";
import { feedIdentity, resolveStreamingDiffIdentity } from "./streaming-diff-feed.mjs";
import { removePreSnapshot, streamingDiffToolUseId, takePreSnapshot, writePreSnapshot } from "./streaming-diff-snapshot-store.mjs";

function attemptCard(toolUseId, terminalReason) {
  return {
    revId: `r-${randomBytes(12).toString("hex")}`,
    toolUseId,
    ts: new Date().toISOString(),
    status: "partial",
    partialReason: ["attempt in progress / unterminated", terminalReason].filter(Boolean).join("; ").slice(0, 500),
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

export function captureStreamingDiff({ cwd = process.cwd(), session, toolUseId: rawToolUseId, phase, hintedPaths = [], terminalReason, policy, append = appendCard } = {}) {
  if (phase !== "pre" && phase !== "post") throw new Error("streaming diff capture phase must be pre or post");
  const identity = resolveStreamingDiffIdentity({ cwd, session });
  const safeToolUseId = streamingDiffToolUseId(rawToolUseId);
  const journalOptions = { identity: feedIdentity(identity) };
  if (phase === "pre") {
    ensureStreamingDiffFeed({ cwd, session });
    const marker = appendWithRetry(append, identity.feedDir, attemptCard(safeToolUseId, terminalReason), { ...journalOptions, dedupeToolUseId: true });
    const snapshot = writePreSnapshot({ identity, toolUseId: safeToolUseId, hintedPaths, terminalReason, policy });
    return { phase, identity, marker, snapshot };
  }
  const snapshot = takePreSnapshot({ identity, toolUseId: safeToolUseId });
  const paths = snapshot.found ? snapshot.hintedPaths : hintedPaths;
  const card = captureGitCard({
    worktreeRoot: identity.worktreeRoot,
    hintedPaths: paths,
    preSnapshot: snapshot.preSnapshot,
    toolUseId: safeToolUseId,
    policy,
    opaqueReason: [snapshot.terminalReason, terminalReason].filter(Boolean).join("; ") || undefined,
  });
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
