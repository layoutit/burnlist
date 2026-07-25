import { useEffect } from "react";
import type { createDataClient } from "./data-client";
import type { OvenDataSnapshot, OvenPackageDetail } from "./types";
import type { JsonValue } from "./oven-runtime/terminal-contract";
import { reduceStreamingDiffNavigation, type StreamingDiffNavigation } from "./oven-runtime/streaming-diff-navigation";
import { observeStreamingDiffCards } from "./oven-runtime/streaming-diff-stream";

type Client = ReturnType<typeof createDataClient>;
export function useStreamingDiffSession({ client, active, navigation, ovenDetail, nonce, accept, setData, setNavigation }: { client: Client; active: boolean; navigation: StreamingDiffNavigation | null; ovenDetail: OvenPackageDetail | null; nonce: number; accept(detail: OvenPackageDetail, payload: JsonValue, scope: string): void; setData(value: OvenDataSnapshot | ((current: OvenDataSnapshot | null) => OvenDataSnapshot | null)): void; setNavigation(value: (current: StreamingDiffNavigation | null) => StreamingDiffNavigation | null): void }) {
  useEffect(() => {
    const session = navigation?.page === "session" ? navigation.session : null;
    if (!active || !session) return undefined;
    let stopped = false, stop: (() => void) | undefined; const controller = new AbortController();
    const identity = session.identity;
    void client.streamingSession(identity.logicalRepoKey, identity.worktreeKey, identity.session, controller.signal).then((snapshot) => {
      if (stopped) return;
      setNavigation((current) => current ? reduceStreamingDiffNavigation(current, { type: "cardsAccepted", cardCount: ((snapshot.payload as { cards?: unknown[] }).cards ?? []).length, previousCount: 0 }) : current);
      setData(snapshot); if (ovenDetail) accept(ovenDetail, snapshot.payload as JsonValue, JSON.stringify([session.href, nonce]));
      const cards = (snapshot.payload as { cards?: unknown[] }).cards ?? [];
      stop = observeStreamingDiffCards({ base: client.base, selection: { repoKey: identity.logicalRepoKey, worktreeKey: identity.worktreeKey, session: identity.session }, cards, onCards: (next) => { setNavigation((current) => current ? reduceStreamingDiffNavigation(current, { type: "cardsAccepted", cardCount: next.length, previousCount: cards.length }) : current); cards.splice(0, cards.length, ...next); setData((current) => { const currentIdentity = (current?.payload as { identity?: typeof identity } | undefined)?.identity; return current && currentIdentity?.logicalRepoKey === identity.logicalRepoKey && currentIdentity.worktreeKey === identity.worktreeKey && currentIdentity.session === identity.session ? { ...current, payload: { ...(current.payload as Record<string, unknown>), cards: next } } : current; }); }, onError: (message) => setNavigation((current) => current ? reduceStreamingDiffNavigation(current, { type: "sessionFailed", message }) : current) });
    }).catch((cause) => !stopped && setNavigation((current) => current ? reduceStreamingDiffNavigation(current, { type: "sessionFailed", message: String(cause) }) : current));
    return () => { stopped = true; controller.abort(); stop?.(); };
  }, [client, active, navigation?.page, navigation?.session?.href, nonce, ovenDetail, accept, setData, setNavigation]);
}
