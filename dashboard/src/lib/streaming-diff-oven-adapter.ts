import { parseStreamingDiffCard } from "./streaming-diff.mjs";
import type { StreamingDiffCard, StreamingDiffIdentity } from "./types";

export type StreamingDiffSnapshot = {
  identity: StreamingDiffIdentity;
  updatedAt: string;
  cards: unknown[];
};

export type StreamingDiffOvenPayload = {
  identity: StreamingDiffIdentity;
  updatedAt: string;
  cards: StreamingDiffCard[];
  backHref: string;
};

/** Produces the pointer-addressable, read-only payload consumed by streaming-diff.oven. */
export function adaptStreamingDiff(snapshot: StreamingDiffSnapshot): StreamingDiffOvenPayload {
  const { identity, updatedAt } = snapshot;
  return {
    identity,
    updatedAt,
    cards: snapshot.cards.map(parseStreamingDiffCard).filter((card): card is StreamingDiffCard => card !== null),
    backHref: `/ovens/streaming-diff/view?repoKey=${encodeURIComponent(identity.logicalRepoKey)}`,
  };
}
