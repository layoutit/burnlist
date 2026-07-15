import { writeBindingIfAbsent } from "../../../src/server/oven-bindings.mjs";
import {
  STREAMING_DIFF_OVEN_ID,
  ensureFeedDirectory,
  resolveStreamingDiffIdentity,
  streamingDiffBindingPath,
} from "./streaming-diff-feed.mjs";

export function ensureStreamingDiffFeed({ cwd = process.cwd(), session, now = () => new Date().toISOString() } = {}) {
  const identity = resolveStreamingDiffIdentity({ cwd, session });
  ensureFeedDirectory(identity);
  const binding = writeBindingIfAbsent(
    identity.logicalRepoRoot,
    STREAMING_DIFF_OVEN_ID,
    streamingDiffBindingPath(identity),
    now(),
  );
  return { identity, binding };
}
