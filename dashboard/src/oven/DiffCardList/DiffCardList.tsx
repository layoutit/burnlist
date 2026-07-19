import type { StreamingDiffCard } from "@lib";
import { DiffCard } from "../DiffCard";

export function DiffCardList({ cards }: { cards: StreamingDiffCard[] }) {
  return <>
    <div className="streaming-diff-cards">{cards.map((card) => <DiffCard card={card} key={card.revId} />)}</div>
    {!cards.length && <p className="streaming-diff-message">Waiting for diff cards.</p>}
  </>;
}
