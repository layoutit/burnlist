import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { relative } from "node:path";

import { gitProbe, resolveUmbrella } from "../../../src/cli/umbrella.mjs";
import { repoKey } from "../../../src/server/registry.mjs";
import { containedJoin, repoStateDir, withRepoStateLock } from "../../../src/server/repo-state.mjs";

export const STREAMING_DIFF_OVEN_ID = "streaming-diff";
export const STREAMING_DIFF_FEED_VERSION = "v2";
const MAX_IDENTIFIER_BYTES = 200;

function loneSurrogate(value) {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

export function streamingDiffIdentifier(value, label) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > MAX_IDENTIFIER_BYTES
    || /[\u0000-\u001F\u007F-\u009F]/u.test(value) || loneSurrogate(value)) {
    throw new Error(`streaming diff ${label} must be a non-empty, well-formed identifier of at most ${MAX_IDENTIFIER_BYTES} UTF-8 bytes without control characters`);
  }
  return value;
}

export function identifierPathComponent(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export function sessionId(value) {
  return streamingDiffIdentifier(value, "session");
}

function worktreeRoot(cwd) {
  const topLevel = gitProbe(cwd, ["rev-parse", "--show-toplevel"]);
  if (!topLevel) throw new Error(`streaming diff requires a Git worktree: ${cwd}`);
  return realpathSync(topLevel);
}

export function resolveStreamingDiffIdentity({ cwd = process.cwd(), session } = {}) {
  const logicalRepoRoot = realpathSync(resolveUmbrella(cwd));
  const root = worktreeRoot(cwd);
  const safeSession = sessionId(session);
  const logicalRepoKey = repoKey(logicalRepoRoot);
  const worktreeKey = repoKey(root);
  const feedRoot = containedJoin(logicalRepoRoot, "streaming-diff", STREAMING_DIFF_FEED_VERSION);
  const sessionPath = identifierPathComponent(safeSession);
  const feedDir = containedJoin(logicalRepoRoot, "streaming-diff", STREAMING_DIFF_FEED_VERSION, logicalRepoKey, worktreeKey, sessionPath);
  return {
    logicalRepoRoot,
    logicalRepoKey,
    worktreeRoot: root,
    worktreeKey,
    session: safeSession,
    sessionPath,
    feedRoot,
    feedDir,
  };
}

export function feedIdentity(identity) {
  return {
    logicalRepoKey: identity.logicalRepoKey,
    worktreeKey: identity.worktreeKey,
    session: identity.session,
  };
}

export function streamingDiffBindingPath(identity) {
  const path = relative(identity.logicalRepoRoot, identity.feedRoot);
  if (!path || path.startsWith("..")) throw new Error("streaming diff feed root is not contained in the logical repository");
  return path;
}

export function ensureFeedDirectory(identity) {
  return withRepoStateLock(identity.logicalRepoRoot, () => {
    // containedJoin has already checked every path component and nearest real
    // parent. Directory creation is safe to repeat and never exposes a file.
    mkdirSync(identity.feedDir, { recursive: true });
    return identity.feedDir;
  });
}

export function snapshotDirectory(identity) {
  return containedJoin(
    identity.logicalRepoRoot,
    "streaming-diff",
    STREAMING_DIFF_FEED_VERSION,
    identity.logicalRepoKey,
    identity.worktreeKey,
    identity.sessionPath ?? identifierPathComponent(identity.session),
    "snapshots",
  );
}

export function streamingDiffStateDir(identity) {
  return repoStateDir(identity.logicalRepoRoot);
}
