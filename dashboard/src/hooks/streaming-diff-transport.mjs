import { applyStreamingDiffUpdate, parseStreamingDiffCard } from "../lib/streaming-diff.mjs";

export function applyStreamingDiffCardMessage(cards, raw) {
  const card = parseStreamingDiffCard(JSON.parse(raw));
  if (!card) throw new Error("invalid card");
  return applyStreamingDiffUpdate(cards, { type: "card", card });
}
